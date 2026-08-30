import React, {forwardRef, useEffect, useRef, useState} from 'react';

import Mousetrap from 'mousetrap';
import type {MousetrapInstance} from 'mousetrap';
import stylis from 'stylis';

import type {HyperState, HyperProps, HyperDispatch} from '../../typings/hyper';
import {sendSessionData} from '../actions/sessions';
import * as uiActions from '../actions/ui';
import {getRegisteredKeys, getCommandHandler, shouldPreventDefault} from '../command-registry';
import type Terms from '../components/terms';
import {preloadLargeDictionary} from '../skk/dictionary';
import {isSkkInterceptableKey, SkkEngine} from '../skk/engine';
import {connect} from '../utils/plugins';

import {HeaderContainer} from './header';
import NotificationsContainer from './notifications';
import TermsContainer from './terms';

const isMac = /Mac/.test(navigator.userAgent);

const Hyper = forwardRef<HTMLDivElement, HyperProps>((props, ref) => {
  const mousetrap = useRef<MousetrapInstance | null>(null);
  const terms = useRef<Terms | null>(null);
  const skkEngine = useRef(new SkkEngine());
  const activeSessionRef = useRef(props.activeSession);
  const sendSessionDataRef = useRef(props.sendSessionData);
  // 画面右下に表示するSKKモードインジケーター。null(英字入力)の場合は非表示。
  // skkEngineの状態はrefで保持しているためReactの再レンダリングをトリガーしない。
  // インジケーター表示のためだけに、変化しうるタイミングでこのstateを都度同期する。
  const [skkIndicator, setSkkIndicator] = useState<string | null>(null);
  // ローカルで画面表示しているpreedit(未確定文字列・▽読み・▼候補)の表示幅(桁数)。
  // PTYには送っていない、xterm.js上の見た目だけの表示なので、erase時はこの桁数分だけ
  // バックスペースで消す。ひらがな・漢字等の全角文字は2桁として数える。
  const preeditWidth = useRef(0);

  useEffect(() => {
    activeSessionRef.current = props.activeSession;
  }, [props.activeSession]);

  useEffect(() => {
    sendSessionDataRef.current = props.sendSessionData;
  }, [props.sendSessionData]);

  /**
   * 端末上での表示幅(桁数)を計算する。全角(ひらがな・カタカナ・CJK統合漢字・全角記号)は2、
   * それ以外(ASCIIのローマ字バッファ等)は1として数える簡易実装。
   */
  const displayWidth = (str: string): number => {
    let width = 0;
    for (const ch of str) {
      const code = ch.codePointAt(0) ?? 0;
      const isFullWidth =
        (code >= 0x3000 && code <= 0x303f) ||
        (code >= 0x3040 && code <= 0x30ff) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xff00 && code <= 0xffef);
      width += isFullWidth ? 2 : 1;
    }
    return width;
  };

  /**
   * 現在ローカルに描画しているpreeditを消去するだけの操作(新しい内容は描画しない)。
   * PTYへの確定送出(非同期)と同じkeydownイベント内で新しいpreeditも同期的に描画すると、
   * PTYエコーが返ってくるタイミングとローカル描画の順序が競合し、確定文字列が消えたり
   * 表示順序が崩れたりする。確定が発生したキー入力では、これだけを呼び、新しいpreeditの
   * 描画は次のキー入力まで持ち越す。
   */
  const erasePreeditDisplay = () => {
    const term = terms.current?.getActiveTerm()?.term;
    if (term && preeditWidth.current > 0) {
      term.write('\b \b'.repeat(preeditWidth.current));
    }
    preeditWidth.current = 0;
  };

  /**
   * 現在のエンジンの表示状態(getDisplay())にあわせて、xterm.js上のpreedit表示を同期する。
   * PTYへは一切送出しない、ローカル描画のみの操作。
   * このキー入力でPTYへの確定送出が発生していない場合にのみ呼ぶこと
   * (確定が発生した場合はerasePreeditDisplayのみを使う。理由は上記コメント参照)。
   */
  const syncPreeditDisplay = () => {
    erasePreeditDisplay();
    const term = terms.current?.getActiveTerm()?.term;
    if (!term) {
      return;
    }
    const nextDisplay = skkEngine.current.getDisplay();
    if (nextDisplay) {
      term.write(nextDisplay);
    }
    preeditWidth.current = displayWidth(nextDisplay);
  };

  const commitToTerminal = (text: string) => {
    if (text && activeSessionRef.current) {
      sendSessionDataRef.current(activeSessionRef.current, text);
    }
  };

  /**
   * skkEngineの現在のモード・サブモードにあわせて、画面右下のインジケーター表示を同期する。
   * skkEngineの状態はrefで保持しているため、変化しうる操作の後は都度これを呼ぶ必要がある。
   */
  const updateSkkIndicator = () => {
    if (skkEngine.current.getMode() !== 'kana') {
      setSkkIndicator(null);
      return;
    }
    switch (skkEngine.current.getSubMode()) {
      case 'henkan-reading':
        setSkkIndicator('▽');
        break;
      case 'henkan-select':
        setSkkIndicator('▼');
        break;
      default:
        setSkkIndicator(skkEngine.current.getScript() === 'katakana' ? 'ア' : 'あ');
    }
  };

  // かな入力モードでの母音・子音・句読点・長音符の確定、▽漢字変換モード(読み入力・辞書引き・
  // ▼候補選択)、およびpreedit(未確定文字列・読み・候補)のローカル表示に対応。
  // fcitx5のcomposition機構を一切経由させないよう、windowのcaptureフェーズで
  // xterm.jsのtextareaに到達する前にイベントを奪う。
  const handleSkkKeydown = (e: KeyboardEvent) => {
    // 修飾キー単体のkeydown(Control/Shift/Alt/Metaを押した瞬間、まだ他のキーと組み合わさっていない状態)は
    // SKKの状態に一切影響させず素通りさせる。これを除外しないと、例えばEscでのキャンセルを意図して
    // Ctrlキーを押した瞬間に「未対応キー」として変換状態がリセットされてしまう。
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') {
      return;
    }

    // SKKモードのトグル(fcitx5非経由の独自バインド。既存キーマップと衝突しないctrl+jを使用)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'j') {
      const newMode = skkEngine.current.toggleMode();
      if (newMode === 'kana') {
        // SKKモードが初めてkanaに切り替わったタイミングで、大規模辞書(SKK-JISYO.L)の
        // 非同期読み込みを開始する(2回目以降の呼び出しはpreloadLargeDictionary内部で無視される)。
        preloadLargeDictionary();
      }
      syncPreeditDisplay();
      updateSkkIndicator();
      (e as any).catched = true;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (skkEngine.current.getMode() !== 'kana') {
      return;
    }

    const subMode = skkEngine.current.getSubMode();

    // 変換キャンセル(Escape)。directモード中は何もせず素通しする。
    if (subMode !== 'direct' && e.key === 'Escape') {
      skkEngine.current.cancel();
      syncPreeditDisplay();
      updateSkkIndicator();
      (e as any).catched = true;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // スペースキー: henkan-reading中は変換実行、henkan-select中は次候補へ。
    // directモード中は通常のスペース入力として素通しする。
    if (e.key === ' ' && subMode !== 'direct' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const committed = skkEngine.current.space();
      (e as any).catched = true;
      e.preventDefault();
      e.stopPropagation();
      if (committed) {
        erasePreeditDisplay();
        commitToTerminal(committed);
      } else {
        syncPreeditDisplay();
      }
      updateSkkIndicator();
      return;
    }

    // Enterキー: henkan-select/henkan-reading中は確定処理。directモード中は通常のEnterとして素通しする。
    if (e.key === 'Enter' && subMode !== 'direct' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const committed = skkEngine.current.confirm();
      (e as any).catched = true;
      e.preventDefault();
      e.stopPropagation();
      erasePreeditDisplay();
      commitToTerminal(committed);
      updateSkkIndicator();
      return;
    }

    // 修飾キーなしの、かな入力対象キー(アルファベット・句読点・長音符)のみを対象とする。
    // 大文字は▽漢字変換モードの開始(direct中)、または読みへの追加(henkan-reading中)として扱う。
    if (!e.ctrlKey && !e.altKey && !e.metaKey && isSkkInterceptableKey(e.key)) {
      const isUpper = e.key.length === 1 && e.key !== e.key.toLowerCase();
      const committed = isUpper
        ? skkEngine.current.inputUpper(e.key.toLowerCase())
        : skkEngine.current.input(e.key.toLowerCase());
      (e as any).catched = true;
      e.preventDefault();
      e.stopPropagation();
      if (committed) {
        erasePreeditDisplay();
        commitToTerminal(committed);
      } else {
        syncPreeditDisplay();
      }
      updateSkkIndicator();
      return;
    }

    // バックスペース: 未確定バッファ・読み・候補選択いずれかがある間は、まだ端末に確定送出して
    // いない分の編集としてエンジン側で処理し、端末側の削除処理には渡さない。
    if (e.key === 'Backspace' && (skkEngine.current.hasPendingBuffer() || subMode !== 'direct')) {
      skkEngine.current.backspace();
      syncPreeditDisplay();
      updateSkkIndicator();
      (e as any).catched = true;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // それ以外のキー(矢印キー・数字等)はSKKの対象外なので、通常通り素通しする。
    // ただし、変換途中の状態(henkan-reading/henkan-select)を放置したままpreedit表示だけ消すと、
    // PTYには何も送出されないまま画面から変換結果が消える描画バグになる。まず可能な範囲で
    // 確定してからPTYへ送出し、その後にこのキー自体も素通しされて続けて入力される形にする。
    if (subMode !== 'direct') {
      const committed = skkEngine.current.confirm();
      if (committed) {
        erasePreeditDisplay();
        commitToTerminal(committed);
      } else {
        // 送り仮名のローマ字入力中等、確定しようがない状態は破棄する
        skkEngine.current.reset();
        syncPreeditDisplay();
      }
      updateSkkIndicator();
    } else if (skkEngine.current.hasPendingBuffer()) {
      skkEngine.current.reset();
      syncPreeditDisplay();
      updateSkkIndicator();
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleSkkKeydown, true);
    return () => {
      window.removeEventListener('keydown', handleSkkKeydown, true);
    };
  }, []);

  useEffect(() => {
    void attachKeyListeners();
  }, [props.lastConfigUpdate]);
  useEffect(() => {
    handleFocusActive(props.activeSession);
  }, [props.activeSession]);

  const handleFocusActive = (uid?: string | null) => {
    const term = uid && terms.current?.getTermByUid(uid);
    if (term) {
      term.focus();
    }
  };

  const handleSelectAll = () => {
    const term = terms.current?.getActiveTerm();
    if (term) {
      term.selectAll();
    }
  };

  const attachKeyListeners = async () => {
    if (!mousetrap.current) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      mousetrap.current = new (Mousetrap as any)(window, true);
      mousetrap.current!.stopCallback = () => {
        // All events should be intercepted even if focus is in an input/textarea
        return false;
      };
    } else {
      mousetrap.current.reset();
    }

    const keys = await getRegisteredKeys();
    Object.keys(keys).forEach((commandKeys) => {
      mousetrap.current?.bind(
        commandKeys,
        (e) => {
          const command = keys[commandKeys];
          // We should tell xterm to ignore this event.
          (e as any).catched = true;
          props.execCommand(command, getCommandHandler(command), e);
          shouldPreventDefault(command) && e.preventDefault();
        },
        'keydown'
      );
    });
  };

  useEffect(() => {
    void attachKeyListeners();
    window.rpc.on('term selectAll', handleSelectAll);
  }, []);

  const onTermsRef = (_terms: Terms | null) => {
    terms.current = _terms;
    window.focusActiveTerm = (uid?: string) => {
      if (uid) {
        handleFocusActive(uid);
      } else {
        terms.current?.getActiveTerm()?.focus();
      }
    };
  };

  useEffect(() => {
    return () => {
      mousetrap.current?.reset();
    };
  }, []);

  const {isMac: isMac_, customCSS, uiFontFamily, borderColor, maximized, fullScreen} = props;
  const borderWidth = isMac_ ? '' : `${maximized ? '0' : '1'}px`;
  stylis.set({prefix: false});
  return (
    <div id="hyper" ref={ref}>
      <div
        style={{fontFamily: uiFontFamily, borderColor, borderWidth}}
        className={`hyper_main ${isMac_ && 'hyper_mainRounded'} ${fullScreen ? 'fullScreen' : ''}`}
      >
        <HeaderContainer />
        <TermsContainer ref_={onTermsRef} />
        {props.customInnerChildren}
        {skkIndicator && <div className="skk_indicator">{skkIndicator}</div>}
      </div>

      <NotificationsContainer />

      {props.customChildren}

      <style jsx>
        {`
          .hyper_main {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border: 1px solid #333;
          }

          .hyper_mainRounded {
            border-radius: 10.5px;
            overflow: hidden;
          }

          .skk_indicator {
            position: absolute;
            right: 10px;
            bottom: 10px;
            min-width: 20px;
            padding: 2px 8px;
            border-radius: 4px;
            background: rgba(0, 0, 0, 0.65);
            color: #fff;
            font-family: monospace;
            font-size: 14px;
            text-align: center;
            pointer-events: none;
            z-index: 100;
          }
        `}
      </style>

      {/*
        Add custom CSS to Hyper.
        We add a scope to the customCSS so that it can get around the weighting applied by styled-jsx
      */}
      <style dangerouslySetInnerHTML={{__html: stylis('#hyper', customCSS)}} />
    </div>
  );
});

Hyper.displayName = 'Hyper';

const mapStateToProps = (state: HyperState) => {
  return {
    isMac,
    customCSS: state.ui.css,
    uiFontFamily: state.ui.uiFontFamily,
    borderColor: state.ui.borderColor,
    activeSession: state.sessions.activeUid,
    backgroundColor: state.ui.backgroundColor,
    maximized: state.ui.maximized,
    fullScreen: state.ui.fullScreen,
    lastConfigUpdate: state.ui._lastUpdate
  };
};

const mapDispatchToProps = (dispatch: HyperDispatch) => {
  return {
    execCommand: (command: string, fn: (e: any, dispatch: HyperDispatch) => void, e: any) => {
      dispatch(uiActions.execCommand(command, fn, e));
    },
    sendSessionData: (uid: string, data: string) => {
      dispatch(sendSessionData(uid, data));
    }
  };
};

const HyperContainer = connect(mapStateToProps, mapDispatchToProps, null, {forwardRef: true})(Hyper, 'Hyper');

export default HyperContainer;

export type HyperConnectedProps = ReturnType<typeof mapStateToProps> & ReturnType<typeof mapDispatchToProps>;
