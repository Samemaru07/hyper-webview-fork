import dictionary from './dictionary/skk-jisyo-s';

/**
 * 見出し語(ひらがな)から変換候補一覧を返す。
 * 見つからない場合は空配列を返す。
 *
 * 辞書データの出典・ライセンスは lib/skk/dictionary/NOTICE.md を参照。
 * 送り仮名付きの見出し語は現時点で辞書生成時に除外済み(MVPスコープ外)。
 */
export function lookupCandidates(reading: string): string[] {
  return dictionary[reading] ?? [];
}
