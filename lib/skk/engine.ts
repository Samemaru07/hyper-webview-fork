import {toKana} from 'wanakana';

export type SkkMode = 'ascii' | 'kana';

// バッファが指定文字数を超えても完成しない場合、無限に溜め込まないための安全弁。
// 例: 存在しないローマ字綴りを打ち続けた場合など。
const MAX_PENDING_BUFFER_LENGTH = 4;

// 句読点・長音符。未確定の子音バッファがある状態でこれらが来た場合は、
// 中途半端な合成(例: "k" + "-" -> "kー")を避けるため、バッファを先にリテラル確定してから
// 句読点/長音符を独立して変換する。
const PUNCTUATION_CHARS = new Set([',', '.', '-']);

/**
 * かな入力モードで直接ハンドリング対象とすべきキーかどうかを判定する。
 * 呼び出し側(hyper.tsx)のkeydownハンドラで、xterm.jsへの素通しを止めるかの判定に使う。
 */
export function isSkkInterceptableKey(key: string): boolean {
  return /^[a-zA-Z]$/.test(key) || PUNCTUATION_CHARS.has(key);
}

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

  /**
   * 現在の未確定バッファをそのまま返す(preedit表示用)。
   * バッファの中身は常にASCIIのローマ字綴りであることが保証されている
   * (かな等への変換が成立した時点でバッファはクリアされるため)。
   */
  getBuffer(): string {
    return this.buffer;
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
    if (PUNCTUATION_CHARS.has(char) && this.buffer.length > 0) {
      // 未確定バッファがある状態での句読点/長音符は、バッファをリテラルとして
      // 先に確定し、句読点/長音符は独立して変換する。
      const pendingLiteral = this.buffer;
      this.buffer = '';
      return pendingLiteral + toKana(char, {IMEMode: true});
    }

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
