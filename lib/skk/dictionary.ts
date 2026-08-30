import smallDictionary from './dictionary/skk-jisyo-s';

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
  loadingPromise = import('./dictionary/skk-jisyo-l').then((mod) => {
    largeDictionary = mod.default;
  });
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
  return dictionary[reading] ?? [];
}
