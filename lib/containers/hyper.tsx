import React, {forwardRef, useEffect, useRef} from 'react';

import Mousetrap from 'mousetrap';
import type {MousetrapInstance} from 'mousetrap';
import stylis from 'stylis';

import type {HyperState, HyperProps, HyperDispatch} from '../../typings/hyper';
import {sendSessionData} from '../actions/sessions';
import * as uiActions from '../actions/ui';
import {getRegisteredKeys, getCommandHandler, shouldPreventDefault} from '../command-registry';
import type Terms from '../components/terms';
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

  useEffect(() => {
    activeSessionRef.current = props.activeSession;
  }, [props.activeSession]);

  useEffect(() => {
    sendSessionDataRef.current = props.sendSessionData;
  }, [props.sendSessionData]);

  // PoCスコープ: かな入力モードでの母音・子音の確定のみを対象とする。
  // ▽漢字変換モード(辞書引き・候補選択)やpreedit表示は対象外。
  // fcitx5のcomposition機構を一切経由させないよう、windowのcaptureフェーズで
  // xterm.jsのtextareaに到達する前にイベントを奪う。
  const handleSkkKeydown = (e: KeyboardEvent) => {
    // SKKモードのトグル(fcitx5非経由の独自バインド。既存キーマップと衝突しないctrl+jを使用)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'j') {
      skkEngine.current.toggleMode();
      (e as any).catched = true;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (skkEngine.current.getMode() !== 'kana') {
      return;
    }

    // 修飾キーなしの、かな入力対象キー(アルファベット・句読点・長音符)のみを対象とする
    if (!e.ctrlKey && !e.altKey && !e.metaKey && isSkkInterceptableKey(e.key)) {
      const committed = skkEngine.current.input(e.key.toLowerCase());
      (e as any).catched = true;
      e.preventDefault();
      e.stopPropagation();
      if (committed && activeSessionRef.current) {
        sendSessionDataRef.current(activeSessionRef.current, committed);
      }
      return;
    }

    // 未確定バッファがある状態でのバックスペースは、まだ何も端末に送出していないため
    // バッファの末尾を消すだけに留め、端末側の削除処理には渡さない
    if (e.key === 'Backspace' && skkEngine.current.hasPendingBuffer()) {
      skkEngine.current.backspace();
      (e as any).catched = true;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // それ以外のキー(space, enter, 句読点, 矢印キー等)はPoCの対象外。
    // 素通りさせつつ、宙に浮いた未確定バッファがあればリセットする。
    if (skkEngine.current.hasPendingBuffer()) {
      skkEngine.current.reset();
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
