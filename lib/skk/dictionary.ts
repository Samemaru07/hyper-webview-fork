import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

import smallDictionary from "./dictionary/skk-jisyo-s";

type Dictionary = Record<string, string[]>;

// SKK-JISYO.L(約13万エントリ、約5MB)は起動時のバンドル読み込みコストを避けるため、
// SKKモードが初めて有効化されたタイミングでのみ動的importする。読み込みが完了するまでの間は
// 同期読み込み済みのSKK-JISYO.S(約2,400エントリ、数十KB)を代わりに使う。
let largeDictionary: Dictionary | null = null;
let loadingPromise: Promise<void> | null = null;

/**
 * SKK-JISYO.L(大規模辞書)の非同期読み込みを開始する。既に読み込み済み・読み込み中の場合は何もしない。
 * SKKモードが初めてkanaに切り替わったタイミングで呼び出すことを想定している
 * (アプリ起動直後には呼ばない。読み込み処理自体が数百ms程度かかりうるため)。
 */
export function preloadLargeDictionary(): void {
    if (largeDictionary || loadingPromise) {
        return;
    }
    loadingPromise = import("./dictionary/skk-jisyo-l").then((mod) => {
        largeDictionary = mod.default;
    });
}

// ユーザ辞書の保存先ファイル。localStorageはChromiumが遅延書き込みするため、プロセスが
// 強制終了されると直前の登録が失われる。ファイルへ同期的に書き込むことで、確実に永続化する。
let userDictionaryPath: string | null = null;

/**
 * ユーザ辞書の保存先ファイルを設定する。Electronのレンダラー側(hyper.tsx)から、
 * userDataディレクトリ配下のパスを渡す。未設定(ava等のテスト環境)の場合は、
 * 読み込みは常に空、登録は何もしない(永続化せず、テスト同士が状態を共有しない)。
 */
export function setUserDictionaryPath(path: string | null): void {
    userDictionaryPath = path;
}

/**
 * ユーザ辞書を読み込む。辞書引きのたびに読み直し、キャッシュは持たない
 * (複数ウィンドウで登録した内容を、互いに反映するため)。
 */
function loadUserDictionary(): Dictionary {
    if (!userDictionaryPath) {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(
            readFileSync(userDictionaryPath, "utf-8"),
        );
        return parsed && typeof parsed === "object"
            ? (parsed as Dictionary)
            : {};
    } catch {
        // ファイルが未作成、または壊れている場合は、空の辞書として扱う
        return {};
    }
}

/**
 * ユーザ辞書に見出し語と変換結果を登録する。同じ読みに既に登録済みの候補がある場合、
 * 今回の候補を先頭に移動する。一時ファイルへ書き込んでからリネームし、書き込み途中で
 * 強制終了されても、既存の辞書が壊れないようにする。
 */
export function registerUserEntry(reading: string, word: string): void {
    if (!userDictionaryPath) {
        return;
    }
    const entries = loadUserDictionary();
    const rest = (entries[reading] ?? []).filter((w) => w !== word);
    entries[reading] = [word, ...rest];
    try {
        mkdirSync(dirname(userDictionaryPath), { recursive: true });
        const tempPath = `${userDictionaryPath}.tmp`;
        writeFileSync(tempPath, JSON.stringify(entries), "utf-8");
        renameSync(tempPath, userDictionaryPath);
    } catch (error) {
        console.error("ユーザ辞書の保存に失敗しました", error);
    }
}

/**
 * 見出し語(ひらがな)から変換候補一覧を返す。
 * 見つからない場合は空配列を返す。
 *
 * SKK-JISYO.L(大規模辞書)の読み込みが完了していればそちらを優先し、
 * 未完了(または未開始)の間はSKK-JISYO.L(小規模辞書)を使う。
 *
 * 辞書データの出典・ライセンスは lib/skk/dictionary/NOTICE.md を参照。
 * 送り仮名付きの見出し語は現時点で辞書生成時に除外済み(MVPスコープ外)。
 */
export function lookupCandidates(reading: string): string[] {
    const dictionary = largeDictionary ?? smallDictionary;
    const system = dictionary[reading] ?? [];
    const user = loadUserDictionary()[reading] ?? [];
    if (user.length === 0) {
        return system;
    }
    // ユーザ辞書の候補を先頭に並べ、システム辞書側の重複候補は取り除く
    return [...user, ...system.filter((c) => !user.includes(c))];
}
