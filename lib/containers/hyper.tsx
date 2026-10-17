import { join } from "path";
import { pathToFileURL } from "url";

import React, {
    forwardRef,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";

import { app } from "@electron/remote";
import Color from "color";
import Mousetrap from "mousetrap";
import type { MousetrapInstance } from "mousetrap";
import stylis from "stylis";

import type {
    HyperState,
    HyperProps,
    HyperDispatch,
} from "../../typings/hyper";
import { sendSessionData } from "../actions/sessions";
import * as uiActions from "../actions/ui";
import {
    getRegisteredKeys,
    getCommandHandler,
    shouldPreventDefault,
} from "../command-registry";
import type Terms from "../components/terms";
import {
    preloadLargeDictionary,
    setUserDictionaryPath,
} from "../skk/dictionary";
import {
    CANDIDATE_PAGE_LABELS,
    CANDIDATE_PAGE_SIZE,
    isSkkInterceptableKey,
    SkkEngine,
} from "../skk/engine";
import { connect } from "../utils/plugins";

import { HeaderContainer } from "./header";
import NotificationsContainer from "./notifications";
import TermsContainer from "./terms";

const isMac = /Mac/.test(navigator.userAgent);

// 辞書登録中の1つ分の入力状態。
type RegistrationFrame = {
    reading: string;
    text: string;
    // textの中でのカーソル位置(先頭からの文字数。サロゲートペアは1文字として数える)
    cursor: number;
    engine: SkkEngine;
};

// カーソル位置に文字列を挿入し、カーソルを挿入した文字列の後ろへ進める。
const insertAtCursor = (frame: RegistrationFrame, inserted: string) => {
    if (!inserted) {
        return;
    }
    const insertedChars = Array.from(inserted);
    const chars = Array.from(frame.text);
    chars.splice(frame.cursor, 0, ...insertedChars);
    frame.text = chars.join("");
    frame.cursor += insertedChars.length;
};

// カーソルの直前の1文字を削除する。
const deleteBeforeCursor = (frame: RegistrationFrame) => {
    if (frame.cursor === 0) {
        return;
    }
    const chars = Array.from(frame.text);
    chars.splice(frame.cursor - 1, 1);
    frame.text = chars.join("");
    frame.cursor -= 1;
};

// カーソルの直後の1文字を削除する。カーソル位置は変わらない。
const deleteAtCursor = (frame: RegistrationFrame) => {
    const chars = Array.from(frame.text);
    if (frame.cursor >= chars.length) {
        return;
    }
    chars.splice(frame.cursor, 1);
    frame.text = chars.join("");
};

// ユーザ辞書の保存先を、Hyperの設定ファイル(hyper.json)と同じuserDataディレクトリに設定する
try {
    setUserDictionaryPath(
        join(app.getPath("userData"), "skk-user-dictionary.json"),
    );
} catch (error) {
    console.error("ユーザ辞書の保存先を設定できませんでした", error);
}

const Hyper = forwardRef<HTMLDivElement, HyperProps>((props, ref) => {
    const mousetrap = useRef<MousetrapInstance | null>(null);
    const terms = useRef<Terms | null>(null);
    const skkEngine = useRef(new SkkEngine(undefined, undefined, true));
    const activeSessionRef = useRef(props.activeSession);
    const sendSessionDataRef = useRef(props.sendSessionData);
    // 画面右下に表示するSKKモードインジケーター。null(英字入力)の場合は非表示。
    // skkEngineの状態はrefで保持しているためReactの再レンダリングをトリガーしない。
    // インジケーター表示のためだけに、変化しうるタイミングでこのstateを都度同期する。
    const [skkIndicator, setSkkIndicator] = useState<string | null>(null);
    // ローカル表示するpreedit(未確定文字列・▽読み・▼候補)。xterm.jsのバッファには書き込まず、
    // カーソル位置に重ねるDOMオーバーレイとして描画する。バッファに触れないため、
    // alternate screenを使うTUIアプリ(tmux/lazygit等)の再描画と競合しない。
    const [preedit, setPreedit] = useState<{
        text: string;
        top: number;
        left: number;
        cellWidth: number;
        cellHeight: number;
        fontFamily: string;
        fontSize: number;
        color: string | undefined;
        background: string | undefined;
    } | null>(null);
    // アクティブなxtermの書き込み完了イベント(onWriteParsed)の購読。
    // PTYエコーが反映されてカーソルが動いた後にオーバーレイ位置を再計算するために使う。
    const preeditListener = useRef<{
        term: unknown;
        dispose: () => void;
    } | null>(null);
    // 辞書登録の入れ子(登録中にさらに辞書登録が必要になる場合)を、スタックで管理する。
    // 末尾が現在の登録で、各登録は専用のエンジンを持つ(登録中の入力でも漢字変換を使えるように、
    // メインのエンジンとは別にする)。keydownハンドラは初回レンダリング時のクロージャが
    // 残り続けるため、同期的に読み書きできるようrefで持つ。
    const registrationStack = useRef<RegistrationFrame[]>([]);
    // 登録バーの表示用。depthは入れ子の深さ。
    const [registrationView, setRegistrationView] = useState<{
        reading: string;
        // カーソルより前と後ろの文字列。変換中の文字(pending)は、その間に表示する。
        before: string;
        after: string;
        pending: string;
        depth: number;
    } | null>(null);
    // かな漢字変換の候補一覧ポップアップ(▼候補が複数ある場合のみ表示)。
    // カーソル位置に追従させるため、現在のページの候補+選択キーラベルに加えて
    // 画面上のピクセル座標も保持する。
    const [candidatePopup, setCandidatePopup] = useState<{
        pageItems: { label: string; candidate: string; selected: boolean }[];
        top: number;
        left: number;
        // 辞書登録中の候補ポップアップかどうか。trueの場合、端末のカーソル位置ではなく、
        // 登録バーの近く(popupAnchor)に表示する。
        inRegistration: boolean;
    } | null>(null);
    // 辞書登録中の候補ポップアップの表示位置。登録バーのレイアウトが確定してから計算する。
    const [popupAnchor, setPopupAnchor] = useState<{
        left: number;
        bottom: number;
    } | null>(null);
    const registrationBarRef = useRef<HTMLDivElement>(null);
    const registrationPendingRef = useRef<HTMLSpanElement>(null);

    /**
     * xterm.js上のカーソル位置(セル座標)を、画面上のピクセル座標に変換する。
     * xterm.jsは公開APIとしてカーソルのピクセル位置を提供していないため、
     * 内部実装(_core._renderService)に依存する。xterm.jsのバージョンアップ時は
     * この部分の互換性を要確認。
     * 基準は、paddingを含まない.xterm-screenの矩形にする(term.elementだと
     * paddingの分だけセル位置がずれ、オーバーレイが本来の文字位置に重ならないため)。
     */
    const getCursorCellRect = () => {
        const term = terms.current?.getActiveTerm()?.term;
        if (!term?.element) {
            return null;
        }
        const core = (term as any)._core;
        const cell = core?._renderService?.dimensions?.css?.cell;
        if (!cell) {
            return null;
        }
        const screen =
            term.element.querySelector(".xterm-screen") ?? term.element;
        const rect = screen.getBoundingClientRect();
        const { cursorX, cursorY } = term.buffer.active;
        return {
            top: rect.top + cursorY * cell.height,
            left: rect.left + cursorX * cell.width,
            cellWidth: cell.width as number,
            cellHeight: cell.height as number,
            minLeft: rect.left,
            maxRight: rect.right,
        };
    };

    // 候補ポップアップ用。カーソル行の1行下の位置を返す。
    const getCursorPixelPosition = (): { top: number; left: number } | null => {
        const cell = getCursorCellRect();
        if (!cell) {
            return null;
        }
        return { top: cell.top + cell.cellHeight, left: cell.left };
    };

    useEffect(() => {
        activeSessionRef.current = props.activeSession;
    }, [props.activeSession]);

    useEffect(() => {
        sendSessionDataRef.current = props.sendSessionData;
    }, [props.sendSessionData]);

    // 辞書登録中の候補ポップアップを、登録バーの変換中の文字の真上に置く。
    // 登録バーはstate更新のあとに描画されるため、DOMの位置は描画後でないと測れない。
    useLayoutEffect(() => {
        const bar = registrationBarRef.current;
        if (!candidatePopup?.inRegistration || !bar) {
            setPopupAnchor(null);
            return;
        }
        const barRect = bar.getBoundingClientRect();
        const pendingRect =
            registrationPendingRef.current?.getBoundingClientRect();
        const next = {
            left: pendingRect?.left ?? barRect.left,
            bottom: window.innerHeight - barRect.top + 4,
        };
        setPopupAnchor((prev) =>
            prev && prev.left === next.left && prev.bottom === next.bottom
                ? prev
                : next,
        );
    }, [candidatePopup, registrationView]);

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
     * 確定が発生したキー入力で呼ぶ。オーバーレイをいったん消すだけで、新しい内容は描画しない。
     * 確定文字列のPTYエコーが反映される前はカーソル位置が古いままなので、ここで再描画すると
     * 誤った位置に表示される。新しい内容(確定後に残ったバッファ等)は、エコー反映後に
     * onWriteParsed経由のsyncPreeditDisplayで表示される。
     */
    const erasePreeditDisplay = () => {
        ensurePreeditListener();
        setPreedit(null);
    };

    /**
     * 現在のエンジンの表示状態(getDisplay())にあわせて、カーソル位置のオーバーレイを同期する。
     * PTYへは一切送出せず、xterm.jsのバッファにも書き込まない。
     * 全角文字は1文字ずつセル幅の整数倍(2セル)の枠に収めて描画し、フォントの字幅に
     * 依存せずセルと位置を揃える。行末ではみ出す場合は、画面内に収まる位置まで左へずらす。
     */
    const syncPreeditDisplay = () => {
        ensurePreeditListener();
        // 辞書登録中は、読みを登録バーに表示するので、カーソル位置のpreeditは出さない
        if (registrationStack.current.length > 0) {
            setPreedit(null);
            return;
        }
        const term = terms.current?.getActiveTerm()?.term;
        const text = skkEngine.current.getDisplay();
        const cell = text ? getCursorCellRect() : null;
        if (!term || !text || !cell) {
            setPreedit(null);
            return;
        }
        const textWidth = displayWidth(text) * cell.cellWidth;
        const next = {
            text,
            top: cell.top,
            left: Math.max(
                cell.minLeft,
                Math.min(cell.left, cell.maxRight - textWidth),
            ),
            cellWidth: cell.cellWidth,
            cellHeight: cell.cellHeight,
            fontFamily: term.options.fontFamily ?? "monospace",
            fontSize: term.options.fontSize ?? 14,
            color: term.options.theme?.foreground,
            background: term.options.theme?.background,
        };
        // 端末の出力が流れ続けている間に、同じ内容で毎回再レンダリングしないよう、
        // 表示に影響する値が変わっていなければ前回のstateを維持する。
        setPreedit((prev) =>
            prev &&
            prev.text === next.text &&
            prev.top === next.top &&
            prev.left === next.left &&
            prev.cellWidth === next.cellWidth &&
            prev.cellHeight === next.cellHeight
                ? prev
                : next,
        );
    };

    /**
     * アクティブなxtermの書き込み完了(onWriteParsed)を購読し、完了のたびにオーバーレイを再同期する。
     * 確定文字列のPTYエコーでカーソルが動いた後に、正しい位置へ追従させるために使う。
     * アクティブなターミナルが切り替わった場合は、購読を張り替える。
     */
    const ensurePreeditListener = () => {
        const term = terms.current?.getActiveTerm()?.term;
        if (!term || preeditListener.current?.term === term) {
            return;
        }
        preeditListener.current?.dispose();
        const disposable = term.onWriteParsed(() => syncPreeditDisplay());
        preeditListener.current = {
            term,
            dispose: () => disposable.dispose(),
        };
    };

    const commitToTerminal = (text: string) => {
        if (text && activeSessionRef.current) {
            sendSessionDataRef.current(activeSessionRef.current, text);
        }
    };

    /**
     * skkEngineの現在のモード・サブモードにあわせて、画面右下のインジケーター表示、
     * および候補選択(▼)中の候補一覧ポップアップの表示を同期する。
     * skkEngineの状態はrefで保持しているため、変化しうる操作の後は都度これを呼ぶ必要がある。
     */
    const updateSkkOverlays = () => {
        // 辞書登録中は、登録用エンジンの状態をインジケーター・候補ポップアップに反映する
        const stack = registrationStack.current;
        const engine =
            stack.length > 0 ? stack[stack.length - 1].engine : skkEngine.current;
        if (engine.getMode() !== "kana") {
            setSkkIndicator(null);
            setCandidatePopup(null);
            return;
        }
        switch (engine.getSubMode()) {
            case "henkan-reading":
                setSkkIndicator("▽");
                break;
            case "henkan-select":
                setSkkIndicator("▼");
                break;
            default:
                setSkkIndicator(
                    engine.getScript() === "katakana" ? "ア" : "あ",
                );
        }

        const candidateList = engine.getCandidateList();
        if (!candidateList) {
            setCandidatePopup(null);
            return;
        }
        // 辞書登録中は、端末のカーソル位置ではなく登録バーの近くに表示する。
        // 位置は、登録バーが描画されたあとのuseLayoutEffectで計算する。
        const inRegistration = stack.length > 0;
        const position = inRegistration
            ? { top: 0, left: 0 }
            : getCursorPixelPosition();
        if (!position) {
            setCandidatePopup(null);
            return;
        }
        // 現在のページ(CANDIDATE_PAGE_SIZE件単位)だけを切り出し、各候補にa/s/d/fのラベルを付与する。
        // ページの先頭位置はエンジン側(getCandidateList)が返す値を使う。
        const { candidates, index, pageStart } = candidateList;
        const pageItems = candidates
            .slice(pageStart, pageStart + CANDIDATE_PAGE_SIZE)
            .map((candidate, i) => ({
                label: CANDIDATE_PAGE_LABELS[i],
                candidate,
                selected: pageStart + i === index,
            }));
        setCandidatePopup({
            pageItems,
            top: position.top,
            left: position.left,
            inRegistration,
        });
    };

    const updateRegistrationView = () => {
        const stack = registrationStack.current;
        const frame = stack[stack.length - 1];
        if (!frame) {
            setRegistrationView(null);
            return;
        }
        const chars = Array.from(frame.text);
        setRegistrationView({
            reading: frame.reading,
            before: chars.slice(0, frame.cursor).join(""),
            after: chars.slice(frame.cursor).join(""),
            pending: frame.engine.getDisplay(),
            depth: stack.length,
        });
    };

    const startRegistration = (reading: string) => {
        // 登録ごとに新しいエンジンを用意し、かな入力モードにしておく
        const engine = new SkkEngine(undefined, undefined, true);
        engine.toggleMode();
        registrationStack.current.push({ reading, text: "", cursor: 0, engine });
        syncPreeditDisplay();
        updateRegistrationView();
        updateSkkOverlays();
    };

    const finishRegistration = (confirmed: boolean) => {
        const stack = registrationStack.current;
        const frame = stack.pop();
        if (!frame) {
            return;
        }
        const word = frame.text.trim();
        // 1つ外側の登録(無ければメインのエンジン)
        const parent = stack.length > 0 ? stack[stack.length - 1] : null;
        if (confirmed && word) {
            if (parent) {
                // 入れ子の登録: 登録した語を、外側の登録中の入力に追加する
                insertAtCursor(parent, parent.engine.commitRegistration(word));
            } else {
                const committed = skkEngine.current.commitRegistration(word);
                erasePreeditDisplay();
                commitToTerminal(committed);
            }
        } else if (!parent) {
            // 中止または空の登録: skkEngineは▽読み入力(または▼候補選択)の状態のまま残るので、続きから編集できる
            syncPreeditDisplay();
        }
        updateRegistrationView();
        updateSkkOverlays();
    };

    // 辞書登録中のキー入力。すべてここで処理し、端末(PTY)へは一切渡さない。
    const handleRegistrationKeydown = (e: KeyboardEvent) => {
        const stack = registrationStack.current;
        const frame = stack[stack.length - 1];
        if (!frame) {
            return;
        }
        const engine = frame.engine;
        (e as any).catched = true;
        e.preventDefault();
        e.stopPropagation();
        if (e.ctrlKey || e.altKey || e.metaKey) {
            return;
        }

        const append = (text: string) => {
            insertAtCursor(frame, text);
        };
        const subMode = engine.getSubMode();

        if (e.key === "Escape") {
            if (subMode !== "direct") {
                engine.cancel();
            } else {
                finishRegistration(false);
                return;
            }
        } else if (e.key === "Enter") {
            if (subMode !== "direct") {
                append(engine.confirm());
            } else {
                append(engine.commitPendingBuffer());
                finishRegistration(true);
                return;
            }
        } else if (e.key === " ") {
            if (subMode !== "direct") {
                append(engine.space());
                // 登録中の変換でも、辞書に無い読みや候補を使い切った場合は、さらに内側の辞書登録に入る
                const nestedReading = engine.takeRegistrationRequest();
                if (nestedReading !== null) {
                    startRegistration(nestedReading);
                    return;
                }
            } else {
                append(engine.commitPendingBuffer() + " ");
            }
        } else if (e.key === "Backspace") {
            if (engine.hasPendingBuffer() || subMode !== "direct") {
                engine.backspace();
            } else {
                deleteBeforeCursor(frame);
            }
        } else if (
            (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
            subMode === "direct" &&
            !engine.hasPendingBuffer()
        ) {
            // 登録中の文字列の中でカーソルを動かす。変換中や未確定のローマ字がある間は動かさない
            const delta = e.key === "ArrowLeft" ? -1 : 1;
            frame.cursor = Math.min(
                Math.max(frame.cursor + delta, 0),
                Array.from(frame.text).length,
            );
        } else if (
            e.key === "Delete" &&
            subMode === "direct" &&
            !engine.hasPendingBuffer()
        ) {
            // カーソルの直後の1文字を削除する。変換中や未確定のローマ字がある間は何もしない
            deleteAtCursor(frame);
        } else if (e.key === "x" && subMode === "henkan-select") {
            engine.previousCandidate();
        } else if (
            CANDIDATE_PAGE_LABELS.includes(e.key) &&
            subMode === "henkan-select" &&
            engine.getCandidateList() !== null
        ) {
            append(engine.selectCandidateByLabel(e.key));
        } else if (
            isSkkInterceptableKey(e.key) ||
            engine.canHandleSymbolShortcut(e.key)
        ) {
            const isUpper = e.key.length === 1 && e.key !== e.key.toLowerCase();
            append(
                isUpper
                    ? engine.inputUpper(e.key.toLowerCase())
                    : engine.input(e.key.toLowerCase()),
            );
        } else if (e.key.length === 1) {
            // 数字・記号等、SKKの対象外の1文字。変換中の内容を確定してから、そのまま追加する
            let out = "";
            if (subMode !== "direct") {
                out = engine.confirm();
                if (!out) {
                    engine.reset();
                }
            }
            append(out + engine.commitPendingBuffer() + e.key);
        }
        updateRegistrationView();
        updateSkkOverlays();
    };

    // かな入力モードでの母音・子音・句読点・長音符の確定、▽漢字変換モード(読み入力・辞書引き・
    // ▼候補選択)、およびpreedit(未確定文字列・読み・候補)のローカル表示に対応。
    // fcitx5のcomposition機構を一切経由させないよう、windowのcaptureフェーズで
    // xterm.jsのtextareaに到達する前にイベントを奪う。
    const handleSkkKeydown = (e: KeyboardEvent) => {
        // タブ名変更の入力欄(InlineEdit)では、SKKエンジンを経由させず通常の入力として扱う。
        // この判定がないと、かな入力モード中の入力がPTYへ送出され、入力欄に文字が入らない。
        if (
            e.target instanceof HTMLElement &&
            e.target.closest("[data-skk-passthrough]")
        ) {
            return;
        }
        // 修飾キー単体のkeydown(Control/Shift/Alt/Metaを押した瞬間、まだ他のキーと組み合わさっていない状態)は
        // SKKの状態に一切影響させず素通りさせる。これを除外しないと、例えばEscでのキャンセルを意図して
        // Ctrlキーを押した瞬間に「未対応キー」として変換状態がリセットされてしまう。
        if (
            e.key === "Control" ||
            e.key === "Shift" ||
            e.key === "Alt" ||
            e.key === "Meta"
        ) {
            return;
        }

        // 辞書登録中は、登録用のハンドラに処理を任せる
        if (registrationStack.current.length > 0) {
            handleRegistrationKeydown(e);
            return;
        }

        // SKKモードのトグル(fcitx5非経由の独自バインド。既存キーマップと衝突しないctrl+kを使用。
        // ctrl+jはNeovim起動中にウィンドウ移動等で使われることが多く衝突するため避けている)
        if (
            e.ctrlKey &&
            !e.shiftKey &&
            !e.altKey &&
            !e.metaKey &&
            e.key.toLowerCase() === "k"
        ) {
            // 変換中(▽読み入力・▼候補選択)の内容を持ったままモードを切り替えると、
            // toggleMode内部のresetHenkanで無言のまま破棄されてしまう。Enterキーと同じ
            // confirm()を先に呼び、変換中の内容があれば確定させてから切り替える。
            if (skkEngine.current.getSubMode() !== "direct") {
                const committed = skkEngine.current.confirm();
                if (committed) {
                    erasePreeditDisplay();
                    commitToTerminal(committed);
                }
            }
            const newMode = skkEngine.current.toggleMode();
            if (newMode === "kana") {
                // SKKモードが初めてkanaに切り替わったタイミングで、大規模辞書(SKK-JISYO.L)の
                // 非同期読み込みを開始する(2回目以降の呼び出しはpreloadLargeDictionary内部で無視される)。
                preloadLargeDictionary();
            }
            syncPreeditDisplay();
            updateSkkOverlays();
            (e as any).catched = true;
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (skkEngine.current.getMode() !== "kana") {
            return;
        }

        const subMode = skkEngine.current.getSubMode();

        // 変換キャンセル(Escape)。directモード中は何もせず素通しする。
        if (subMode !== "direct" && e.key === "Escape") {
            skkEngine.current.cancel();
            syncPreeditDisplay();
            updateSkkOverlays();
            (e as any).catched = true;
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // スペースキー: henkan-reading中は変換実行、henkan-select中は次候補へ。
        // directモード中は通常のスペース入力として素通しする。
        if (
            e.key === " " &&
            subMode !== "direct" &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey
        ) {
            const committed = skkEngine.current.space();
            (e as any).catched = true;
            e.preventDefault();
            e.stopPropagation();
            // 辞書に候補が無い読みの場合は、読みを確定せず辞書登録モードに入る
            const registrationReading =
                skkEngine.current.takeRegistrationRequest();
            if (registrationReading !== null) {
                startRegistration(registrationReading);
                return;
            }
            if (committed) {
                erasePreeditDisplay();
                commitToTerminal(committed);
            } else {
                syncPreeditDisplay();
            }
            updateSkkOverlays();
            return;
        }

        // Enterキー: henkan-select/henkan-reading中は確定処理。directモード中は通常のEnterとして素通しする。
        if (
            e.key === "Enter" &&
            subMode !== "direct" &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey
        ) {
            const committed = skkEngine.current.confirm();
            (e as any).catched = true;
            e.preventDefault();
            e.stopPropagation();
            erasePreeditDisplay();
            commitToTerminal(committed);
            updateSkkOverlays();
            return;
        }

        // xキー: henkan-select中(▼候補選択中)のみ、前のページへ戻る(実際のSKKの慣習に合わせる)。
        // henkan-reading中やdirect中の"x"は、通常のローマ字入力として素通しする
        // (下のisSkkInterceptableKey分岐でinput()に渡る)。
        if (
            e.key === "x" &&
            subMode === "henkan-select" &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey
        ) {
            skkEngine.current.previousCandidate();
            syncPreeditDisplay();
            updateSkkOverlays();
            (e as any).catched = true;
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // a/s/d/fキー: 候補ポップアップ表示中(候補が複数ある場合)のみ、現在のページ内で
        // 対応する候補を直接選択・確定する。候補が1件のみ(ポップアップ非表示)の場合は
        // 通常のローマ字入力として素通しし、これまで通り現在の候補が暗黙確定される。
        if (
            CANDIDATE_PAGE_LABELS.includes(e.key) &&
            subMode === "henkan-select" &&
            skkEngine.current.getCandidateList() !== null &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey
        ) {
            const committed = skkEngine.current.selectCandidateByLabel(e.key);
            (e as any).catched = true;
            e.preventDefault();
            e.stopPropagation();
            if (committed) {
                erasePreeditDisplay();
                commitToTerminal(committed);
            }
            updateSkkOverlays();
            return;
        }

        // 修飾キーなしの、かな入力対象キー(アルファベット・句読点・長音符・カッコ)のみを対象とする。
        // 大文字は▽漢字変換モードの開始(direct中)、または読みへの追加(henkan-reading中)として扱う。
        // "/"等、通常は素通しさせたいキーは、canHandleSymbolShortcutで"z"の直後という条件付きで
        // インターセプト対象に加える(例: "z/"→「・」。パス指定等での通常の"/"入力は妨げない)。
        if (
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            (isSkkInterceptableKey(e.key) ||
                skkEngine.current.canHandleSymbolShortcut(e.key))
        ) {
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
            updateSkkOverlays();
            return;
        }

        // バックスペース: 未確定バッファ・読み・候補選択いずれかがある間は、まだ端末に確定送出して
        // いない分の編集としてエンジン側で処理し、端末側の削除処理には渡さない。
        if (
            e.key === "Backspace" &&
            (skkEngine.current.hasPendingBuffer() || subMode !== "direct")
        ) {
            skkEngine.current.backspace();
            syncPreeditDisplay();
            updateSkkOverlays();
            (e as any).catched = true;
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // それ以外のキー(矢印キー・数字等)はSKKの対象外なので、通常通り素通しする。
        // ただし、変換途中の状態(henkan-reading/henkan-select)を放置したままpreedit表示だけ消すと、
        // PTYには何も送出されないまま画面から変換結果が消える描画バグになる。まず可能な範囲で
        // 確定してからPTYへ送出し、その後にこのキー自体も素通しされて続けて入力される形にする。
        if (subMode !== "direct") {
            const committed = skkEngine.current.confirm();
            if (committed) {
                erasePreeditDisplay();
                commitToTerminal(committed);
            } else {
                // 送り仮名のローマ字入力中等、確定しようがない状態は破棄する
                skkEngine.current.reset();
                syncPreeditDisplay();
            }
            updateSkkOverlays();
        } else if (skkEngine.current.hasPendingBuffer()) {
            skkEngine.current.reset();
            syncPreeditDisplay();
            updateSkkOverlays();
        }
    };

    useEffect(() => {
        window.addEventListener("keydown", handleSkkKeydown, true);
        return () => {
            window.removeEventListener("keydown", handleSkkKeydown, true);
            preeditListener.current?.dispose();
            preeditListener.current = null;
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
                "keydown",
            );
        });
    };

    useEffect(() => {
        void attachKeyListeners();
        window.rpc.on("term selectAll", handleSelectAll);
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
        window.pasteIntoActiveTerm = () => {
            void terms.current?.getActiveTerm()?.pasteFromClipboard();
        };
    };

    useEffect(() => {
        return () => {
            mousetrap.current?.reset();
        };
    }, []);

    const {
        isMac: isMac_,
        customCSS,
        uiFontFamily,
        borderColor,
        maximized,
        fullScreen,
        backgroundColor,
        backgroundImage,
        backgroundImageSize,
    } = props;
    const borderWidth = isMac_ ? "" : `${maximized ? "0" : "1"}px`;
    // Note: `pathToFileURL` expects a filesystem path, not something already a URL.
    // Users are expected to provide an absolute local path via `backgroundImage`.
    const backgroundImageUrl = backgroundImage
        ? pathToFileURL(backgroundImage).href
        : null;
    // xterm.js側は`allowTransparency`が有効な間、theme.backgroundの値を一切見ずに
    // canvasを完全透過(clearRect)にするだけなので、backgroundColorのアルファ値を
    // 画像の濃淡として使うにはDOM側で別途黒のオーバーレイを重ねる必要がある。
    // (xterm-addon-canvasのBaseRenderLayer#_clearAllで確認済み)
    // アルファ値が高いほど黒みが強くなる(0.9なら90%黒で覆う)。
    const backgroundImageOverlayAlpha = Color(backgroundColor).alpha();
    stylis.set({ prefix: false });
    return (
        <div id="hyper" ref={ref}>
            {backgroundImageUrl && (
                <div
                    className="hyper_backgroundImage"
                    style={{
                        backgroundImage: `linear-gradient(rgba(0,0,0,${backgroundImageOverlayAlpha}), rgba(0,0,0,${backgroundImageOverlayAlpha})), url("${backgroundImageUrl}")`,
                        backgroundSize: backgroundImageSize,
                    }}
                />
            )}
            <div
                style={{ fontFamily: uiFontFamily, borderColor, borderWidth }}
                className={`hyper_main ${isMac_ && "hyper_mainRounded"} ${fullScreen ? "fullScreen" : ""}`}
            >
                <HeaderContainer />
                <TermsContainer ref_={onTermsRef} />
                {props.customInnerChildren}
                {skkIndicator && (
                    <div className="skk_indicator">{skkIndicator}</div>
                )}
                {registrationView && (
                    <div className="skk_registration" ref={registrationBarRef}>
                        <span className="skk_registration_label">
                            {"[".repeat(registrationView.depth)}
                            辞書登録
                            {"]".repeat(registrationView.depth)}
                        </span>
                        <span className="skk_registration_reading">
                            {registrationView.reading}
                        </span>
                        <span className="skk_registration_text">
                            {registrationView.before}
                            <span
                                className="skk_registration_pending"
                                ref={registrationPendingRef}
                            >
                                {registrationView.pending}
                            </span>
                            <span className="skk_registration_cursor" />
                            {registrationView.after}
                        </span>
                    </div>
                )}
                {preedit && (
                    <div
                        className="skk_preedit"
                        style={{
                            top: preedit.top,
                            left: preedit.left,
                            height: preedit.cellHeight,
                            lineHeight: `${preedit.cellHeight}px`,
                            fontFamily: preedit.fontFamily,
                            fontSize: preedit.fontSize,
                            color: preedit.color,
                            background: preedit.background,
                        }}
                    >
                        {Array.from(preedit.text).map((ch, i) => (
                            <span
                                key={i}
                                className="skk_preedit_char"
                                style={{
                                    width: displayWidth(ch) * preedit.cellWidth,
                                }}
                            >
                                {ch}
                            </span>
                        ))}
                    </div>
                )}
                {candidatePopup && (
                    <div
                        className="skk_candidate_popup"
                        style={
                            candidatePopup.inRegistration
                                ? popupAnchor
                                    ? {
                                          left: popupAnchor.left,
                                          bottom: popupAnchor.bottom,
                                      }
                                    : { visibility: "hidden" as const }
                                : {
                                      top: candidatePopup.top,
                                      left: candidatePopup.left,
                                  }
                        }
                    >
                        {candidatePopup.pageItems.map(
                            ({ label, candidate, selected }) => (
                                <div
                                    key={label}
                                    className={`skk_candidate_popup_item ${selected ? "skk_candidate_popup_item_selected" : ""}`}
                                >
                                    <span className="skk_candidate_popup_item_label">
                                        {label}
                                    </span>
                                    {candidate}
                                </div>
                            ),
                        )}
                    </div>
                )}
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

                    .hyper_backgroundImage {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background-repeat: no-repeat;
                        background-position: center;
                        z-index: -1;
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

                    .skk_preedit {
                        position: fixed;
                        white-space: pre;
                        pointer-events: none;
                        z-index: 99;
                    }

                    .skk_preedit_char {
                        display: inline-block;
                        box-sizing: border-box;
                        border-bottom: 1px solid currentColor;
                    }

                    .skk_registration {
                        position: absolute;
                        left: 10px;
                        right: 70px;
                        bottom: 10px;
                        padding: 4px 8px;
                        border: 1px solid rgba(255, 255, 255, 0.3);
                        border-radius: 4px;
                        background: rgba(0, 0, 0, 0.85);
                        color: #fff;
                        font-family: monospace;
                        font-size: 14px;
                        white-space: pre;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        pointer-events: none;
                        z-index: 100;
                    }

                    .skk_registration_label {
                        margin-right: 8px;
                        color: #888;
                    }

                    .skk_registration_reading {
                        margin-right: 8px;
                        color: #aaa;
                    }

                    .skk_registration_pending {
                        text-decoration: underline;
                    }

                    .skk_registration_cursor {
                        display: inline-block;
                        width: 0;
                        height: 1.1em;
                        border-left: 1px solid #fff;
                        vertical-align: text-bottom;
                    }

                    .skk_candidate_popup {
                        position: fixed;
                        min-width: 60px;
                        padding: 2px 0;
                        border-radius: 4px;
                        background: rgba(0, 0, 0, 0.85);
                        font-family: monospace;
                        font-size: 14px;
                        pointer-events: none;
                        z-index: 100;
                    }

                    .skk_candidate_popup_item {
                        padding: 2px 8px;
                        color: #ccc;
                        white-space: nowrap;
                    }

                    .skk_candidate_popup_item_selected {
                        color: #fff;
                        background: rgba(255, 255, 255, 0.2);
                    }

                    .skk_candidate_popup_item_label {
                        display: inline-block;
                        min-width: 1em;
                        margin-right: 6px;
                        color: #888;
                    }
                `}
            </style>

            {/*
        Add custom CSS to Hyper.
        We add a scope to the customCSS so that it can get around the weighting applied by styled-jsx
      */}
            <style
                dangerouslySetInnerHTML={{
                    __html: stylis("#hyper", customCSS),
                }}
            />
        </div>
    );
});

Hyper.displayName = "Hyper";

const mapStateToProps = (state: HyperState) => {
    return {
        isMac,
        customCSS: state.ui.css,
        uiFontFamily: state.ui.uiFontFamily,
        borderColor: state.ui.borderColor,
        activeSession: state.sessions.activeUid,
        backgroundColor: state.ui.backgroundColor,
        backgroundImage: state.ui.backgroundImage,
        backgroundImageSize: state.ui.backgroundImageSize,
        maximized: state.ui.maximized,
        fullScreen: state.ui.fullScreen,
        lastConfigUpdate: state.ui._lastUpdate,
    };
};

const mapDispatchToProps = (dispatch: HyperDispatch) => {
    return {
        execCommand: (
            command: string,
            fn: (e: any, dispatch: HyperDispatch) => void,
            e: any,
        ) => {
            dispatch(uiActions.execCommand(command, fn, e));
        },
        sendSessionData: (uid: string, data: string) => {
            dispatch(sendSessionData(uid, data));
        },
    };
};

const HyperContainer = connect(mapStateToProps, mapDispatchToProps, null, {
    forwardRef: true,
})(Hyper, "Hyper");

export default HyperContainer;

export type HyperConnectedProps = ReturnType<typeof mapStateToProps> &
    ReturnType<typeof mapDispatchToProps>;
