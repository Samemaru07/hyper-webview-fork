import {toKana} from 'wanakana';

export type SkkMode = 'ascii' | 'kana';

// バッファが指定文字数を超えても完成しない場合、無限に溜め込まないための安全弁。
// 例: 存在しないローマ字綴りを打ち続けた場合など。
const MAX_PENDING_BUFFER_LENGTH = 4;

/**
 * SKKのローマ字→かな変換・モード管理を担う最小限のステートマシン。
 *
 * PoC段階のスコープ:
 * - かな入力モードでの母音・子音入力の確定のみを対象とする
 * - ▽漢字変換モード(辞書引き・候補選択)は対象外
 * - 未確定文字列の画面表示(preedit相当)は行わない。確定した文字列のみ端末に送出する
 */
export class SkkEngine {
  private mode: SkkMode = 'ascii';
  private buffer = '';

  getMode(): SkkMode {
    return this.mode;
  }

  toggleMode(): SkkMode {
    this.buffer = '';
    this.mode = this.mode === 'ascii' ? 'kana' : 'ascii';
    return this.mode;
  }

  hasPendingBuffer(): boolean {
    return this.buffer.length > 0;
  }

  reset(): void {
    this.buffer = '';
  }

  /**
   * かな入力モード中に、印字可能な1文字(a-z等)を渡す。
   * 戻り値が空文字の場合はまだ未確定(バッファに保持中)、
   * 空文字でない場合はその文字列を確定として端末に送出してよい。
   */
  input(char: string): string {
    this.buffer += char;

    const converted = toKana(this.buffer, {IMEMode: true});

    if (/[a-z]/i.test(converted)) {
      if (this.buffer.length >= MAX_PENDING_BUFFER_LENGTH) {
        // 安全弁: 変換が成立する見込みがない場合、バッファを生の文字列としてそのまま確定する
        const literal = this.buffer;
        this.buffer = '';
        return literal;
      }
      // まだ未確定(例: 'k' や 'sh' や 'n' 単体)。バッファに保持し続ける。
      return '';
    }

    this.buffer = '';
    return converted;
  }

  /**
   * バックスペース。未確定バッファがあればその末尾を1文字削るだけに留め、
   * まだ何も端末に送出していないので画面上の削除は発生させない(呼び出し側でpreventDefaultする)。
   * バッファが空ならfalseを返すので、呼び出し側は通常のバックスペース処理に委ねてよい。
   */
  backspace(): boolean {
    if (this.buffer.length === 0) {
      return false;
    }
    this.buffer = this.buffer.slice(0, -1);
    return true;
  }
}
