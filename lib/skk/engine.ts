import {toKana, toKatakana} from 'wanakana';

import {lookupCandidates} from './dictionary';

export type SkkMode = 'ascii' | 'kana';

/**
 * かな入力モード内のサブステート。
 * - direct: 通常のかな入力(母音・子音・句読点・長音符の確定)
 * - henkan-reading: ▽相当。見出し語の読みをかなで蓄積中
 * - henkan-select: ▼相当。辞書引きした候補を1つずつ表示・選択中
 */
export type KanaSubMode = 'direct' | 'henkan-reading' | 'henkan-select';

/**
 * direct中の確定文字列をひらがなにするかカタカナにするかの設定。
 * qキー(バッファが空の状態)でトグルする。
 */
export type KanaScript = 'hiragana' | 'katakana';

// バッファが指定文字数を超えても完成しない場合、無限に溜め込まないための安全弁。
// 子音の置き換え(canContinueBuffer)導入により、通常はバッファが2文字を超える前に
// 完成/置き換えのいずれかで解消されるため、実際にはほぼ到達しない防御的なフォールバック。
const MAX_PENDING_BUFFER_LENGTH = 4;

// 句読点・長音符。未確定の子音バッファがある状態でこれらが来た場合は、
// 中途半端な合成(例: "k" + "-" -> "kー")を避けるため、バッファを先にリテラル確定してから
// 句読点/長音符を独立して変換する。
const PUNCTUATION_CHARS = new Set([',', '.', '-']);

const VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);

/**
 * かな入力モードで直接ハンドリング対象とすべきキーかどうかを判定する。
 * 呼び出し側(hyper.tsx)のkeydownハンドラで、xterm.jsへの素通しを止めるかの判定に使う。
 * 大文字・小文字どちらも対象(大文字は▽漢字変換モードの開始トリガーになるため)。
 */
export function isSkkInterceptableKey(key: string): boolean {
  return /^[a-zA-Z]$/.test(key) || PUNCTUATION_CHARS.has(key);
}

/**
 * SKKのローマ字→かな変換・モード管理・漢字変換(▽/▼)を担うステートマシン。
 *
 * MVPスコープ:
 * - かな入力モードでの母音・子音・句読点・長音符の確定
 * - ▽漢字変換モード: 読み入力・辞書引き・▼候補選択・確定/キャンセル
 * - 送り仮名(活用語尾を伴う変換)は対象外
 * - 辞書はコンストラクタで注入可能(テスト用にモック差し替えできるように)
 */
export class SkkEngine {
  private mode: SkkMode = 'ascii';
  private subMode: KanaSubMode = 'direct';
  // 未確定のローマ字バッファ。direct/henkan-readingで共用。
  private buffer = '';
  // henkan-reading中に確定していく読み(ひらがな)。
  private reading = '';
  private candidates: string[] = [];
  private candidateIndex = 0;
  private script: KanaScript = 'hiragana';

  constructor(private readonly lookup: (reading: string) => string[] = lookupCandidates) {}

  getMode(): SkkMode {
    return this.mode;
  }

  getSubMode(): KanaSubMode {
    return this.subMode;
  }

  getScript(): KanaScript {
    return this.script;
  }

  toggleMode(): SkkMode {
    this.resetHenkan();
    this.buffer = '';
    this.script = 'hiragana';
    this.mode = this.mode === 'ascii' ? 'kana' : 'ascii';
    return this.mode;
  }

  hasPendingBuffer(): boolean {
    return this.buffer.length > 0;
  }

  /**
   * 現在の状態に応じた、ローカル表示すべき文字列(preedit相当)を返す。
   * PTYには送出しない、画面表示専用の文字列。
   */
  getDisplay(): string {
    if (this.subMode === 'henkan-select') {
      return this.candidates[this.candidateIndex] ?? '';
    }
    if (this.subMode === 'henkan-reading') {
      return this.reading + this.buffer;
    }
    return this.buffer;
  }

  private resetHenkan(): void {
    this.subMode = 'direct';
    this.reading = '';
    this.candidates = [];
    this.candidateIndex = 0;
  }

  /**
   * 現在のバッファに`nextChar`を追加した場合、いずれかの母音を続けることで
   * 変換が成立する見込みがあるかどうかを判定する。ハードコードした拗音の組み合わせ表を
   * 持たず、実際にwanakanaへ「バッファ+nextChar+各母音」を試させることで判定する
   * (例: "k"+"y"は"kya"が成立するのでtrue、"m"+"d"はどの母音でも成立しないのでfalse)。
   */
  private canContinueBuffer(nextChar: string): boolean {
    const candidate = this.buffer + nextChar;
    for (const vowel of VOWELS) {
      if (!/[a-z]/i.test(toKana(candidate + vowel, {IMEMode: true}))) {
        return true;
      }
    }
    return false;
  }

  /**
   * 現在のscript設定(ひらがな/カタカナ)を文字列に適用する。
   * 句読点・長音符・ローマ字リテラルはtoKatakanaを通しても変化しないため、
   * どのケースでも安全に呼び出せる。
   */
  private applyScript(text: string): string {
    return this.script === 'katakana' ? toKatakana(text) : text;
  }

  /**
   * ローマ字1文字をバッファに追加し、変換が成立すればその結果を返す(未成立なら空文字)。
   * PUNCTUATION_CHARSの特別扱いを含む、direct/henkan-reading共通のローマ字→かな変換処理。
   * 常にひらがなで返す(辞書の見出し語キーとして使うため、scriptの影響を受けない)。
   */
  private convertRawChar(char: string): string {
    if (PUNCTUATION_CHARS.has(char) && this.buffer.length > 0) {
      const pendingLiteral = this.buffer;
      this.buffer = '';
      return pendingLiteral + toKana(char, {IMEMode: true});
    }

    // 子音の置き換え: 未確定の子音バッファがある状態で母音以外の文字が来て、
    // かつその組み合わせではどの母音を続けても変換が成立する見込みがない場合、
    // バックスペースなしでバッファを今回の入力に置き換える
    // (例: "m"の後に"d"→バッファが"d"になり、"da"で「だ」に変換できる)。
    if (this.buffer.length > 0 && !VOWELS.has(char) && !PUNCTUATION_CHARS.has(char) && !this.canContinueBuffer(char)) {
      this.buffer = char;
      return '';
    }

    this.buffer += char;
    const converted = toKana(this.buffer, {IMEMode: true});

    if (/[a-z]/i.test(converted)) {
      if (this.buffer.length >= MAX_PENDING_BUFFER_LENGTH) {
        const literal = this.buffer;
        this.buffer = '';
        return literal;
      }
      return '';
    }

    this.buffer = '';
    return converted;
  }

  /**
   * convertRawCharの結果に現在のscript設定を適用したもの。direct中の確定に使う。
   */
  private convertChar(char: string): string {
    return this.applyScript(this.convertRawChar(char));
  }

  /**
   * henkan-select中に、Enterを介さず次の文字が入力された場合、現在選択中の候補を
   * 暗黙的に確定する(実際のSKKの慣習に合わせた挙動)。henkan-select中でなければ何もせず空文字を返す。
   */
  private implicitConfirmIfNeeded(): string {
    if (this.subMode !== 'henkan-select') {
      return '';
    }
    const chosen = this.candidates[this.candidateIndex];
    this.resetHenkan();
    return chosen;
  }

  /**
   * 小文字キー入力。
   * - direct中: 確定した文字列をそのまま返す(未確定なら空文字)。呼び出し側がPTYへ送出する。
   * - henkan-reading中: 読みバッファに追加するだけで、常に空文字を返す
   *   (確定はspace/confirmで行うため、ここでは何もPTYに送出しない)。
   * - henkan-select中: 現在の候補を暗黙的に確定してから、この文字はdirect相当として処理する。
   *   戻り値は「暗黙確定した候補」+「この文字による新たな確定分(あれば)」の連結。
   *
   * qキー(バッファが空の状態)は特別扱いする。
   * - direct中: ひらがな/カタカナのscriptをトグルするだけで、何も確定しない。
   * - henkan-reading中: 辞書引きせず、蓄積済みの読みをその場でカタカナ化して確定する
   *   (本家SKKのショートカット動作に合わせた挙動)。
   */
  input(char: string): string {
    const implicitlyConfirmed = this.implicitConfirmIfNeeded();

    if (char === 'q' && this.buffer.length === 0) {
      if (this.subMode === 'direct') {
        this.script = this.script === 'hiragana' ? 'katakana' : 'hiragana';
        return implicitlyConfirmed;
      }
      if (this.subMode === 'henkan-reading') {
        const katakanaReading = toKatakana(this.reading);
        this.resetHenkan();
        return implicitlyConfirmed + katakanaReading;
      }
    }

    if (this.subMode === 'henkan-reading') {
      this.reading += this.convertRawChar(char);
      return implicitlyConfirmed;
    }
    return implicitlyConfirmed + this.convertChar(char);
  }

  /**
   * 大文字キー入力。direct中なら▽漢字変換モードを開始する。
   * henkan-select中の大文字は、現在の候補を暗黙的に確定してから、新たな▽漢字変換モードを開始する。
   * henkan-reading中の大文字は、送り仮名開始トリガー(MVPスコープ外)ではなく、
   * 通常の読み文字として扱う。
   * 戻り値は「暗黙確定した候補」(なければ空文字)。呼び出し側がPTYへ送出する。
   */
  inputUpper(char: string): string {
    if (this.mode !== 'kana') {
      return '';
    }
    const implicitlyConfirmed = this.implicitConfirmIfNeeded();
    if (this.subMode === 'direct') {
      this.subMode = 'henkan-reading';
      this.reading = '';
      this.buffer = '';
    }
    if (this.subMode === 'henkan-reading') {
      this.reading += this.convertRawChar(char);
    }
    return implicitlyConfirmed;
  }

  /**
   * スペースキー。
   * - henkan-reading中: 辞書引きを実行し、henkan-selectへ遷移する。
   *   候補が0件の場合は読みをそのままかなとして確定し、directに戻る(戻り値としてその文字列を返す)。
   * - henkan-select中: 次候補へ送る(末尾なら先頭に循環)。
   * - direct中: このメソッドは呼ばれない想定(呼び出し側でスペースを素通しする)。
   */
  space(): string {
    if (this.subMode === 'henkan-reading') {
      if (this.buffer) {
        // 未確定ローマ字が残っている場合、変換不能な残骸として読みにそのまま追加する
        this.reading += this.buffer;
        this.buffer = '';
      }
      const candidates = this.lookup(this.reading);
      if (candidates.length === 0) {
        const literal = this.applyScript(this.reading);
        this.resetHenkan();
        return literal;
      }
      this.candidates = candidates;
      this.candidateIndex = 0;
      this.subMode = 'henkan-select';
      return '';
    }
    if (this.subMode === 'henkan-select') {
      this.candidateIndex = (this.candidateIndex + 1) % this.candidates.length;
      return '';
    }
    return '';
  }

  /**
   * Enterキー。
   * - henkan-select中: 現在選択中の候補を確定して返す。
   * - henkan-reading中: 読みをそのままかなとして確定して返す(漢字変換はしない)。
   * - direct中: このメソッドは呼ばれない想定(呼び出し側で通常のEnter処理に委ねる)。
   */
  confirm(): string {
    if (this.subMode === 'henkan-select') {
      const chosen = this.candidates[this.candidateIndex];
      this.resetHenkan();
      return chosen;
    }
    if (this.subMode === 'henkan-reading') {
      if (this.buffer) {
        this.reading += this.buffer;
        this.buffer = '';
      }
      const literal = this.applyScript(this.reading);
      this.resetHenkan();
      return literal;
    }
    return '';
  }

  /**
   * Ctrl+g / Escape。変換を1段階キャンセルする。
   * - henkan-select中: 候補選択をやめてhenkan-readingに戻る(読みは保持)。
   * - henkan-reading中: 読み入力自体を破棄してdirectに戻る。
   */
  cancel(): void {
    if (this.subMode === 'henkan-select') {
      this.subMode = 'henkan-reading';
      this.candidates = [];
      this.candidateIndex = 0;
      return;
    }
    if (this.subMode === 'henkan-reading') {
      this.resetHenkan();
    }
  }

  /**
   * バックスペース。
   * - 未確定ローマ字バッファがあれば、その末尾を1文字削る。
   * - henkan-reading中でバッファが空なら、読みの末尾を1文字削る
   *   (読みも空になったらdirectに戻る)。
   * - henkan-select中は候補選択をキャンセルしhenkan-readingに戻る(cancel()と同じ)。
   * - direct中でバッファも空ならfalseを返し、呼び出し側は通常のバックスペース処理に委ねる。
   */
  backspace(): boolean {
    if (this.subMode === 'henkan-select') {
      this.cancel();
      return true;
    }
    if (this.buffer.length > 0) {
      this.buffer = this.buffer.slice(0, -1);
      return true;
    }
    if (this.subMode === 'henkan-reading') {
      if (this.reading.length > 0) {
        this.reading = this.reading.slice(0, -1);
      } else {
        this.resetHenkan();
      }
      return true;
    }
    return false;
  }

  reset(): void {
    this.buffer = '';
    this.resetHenkan();
  }
}
