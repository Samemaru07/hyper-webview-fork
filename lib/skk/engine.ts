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

/**
 * 「そのキーで最後に確定した候補」を記憶・参照するためのインターフェース。
 * 本家SKKの仕様(初回は辞書順、次回からは最後に確定した候補を先頭に表示)に合わせた挙動を実現する。
 * テスト時にモック実装を注入できるよう、SkkEngineのコンストラクタで差し替え可能にしている。
 */
export interface CandidateHistoryStore {
  get(key: string): string | undefined;
  recordChoice(key: string, candidate: string): void;
}

const HISTORY_STORAGE_KEY = 'skk-candidate-history-v1';

/**
 * localStorageを使った永続化実装。Electronのレンダラープロセスでは
 * localStorageの内容が自動的にディスクへ保存され、アプリ再起動後も残る。
 * ava等のNode.js環境(localStorage未定義)でも例外を投げず、単に永続化されないだけで
 * 安全に動作する(getは常にundefined、recordChoiceは何もしない)。
 */
class LocalStorageCandidateHistoryStore implements CandidateHistoryStore {
  private cache: Record<string, string> | null = null;

  private load(): Record<string, string> {
    // localStorageが使えない環境(ava等のNode.jsテスト環境)では、インメモリキャッシュも
    // 一切保持しない。もしここでキャッシュだけ保持してしまうと、モジュール単位の
    // シングルトンであるdefaultHistoryStoreを介して、無関係なテスト同士が状態を
    // 共有してしまう(意図しない副作用)。
    if (typeof localStorage === 'undefined') {
      return {};
    }
    if (this.cache) {
      return this.cache;
    }
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      this.cache = raw ? JSON.parse(raw) : {};
    } catch {
      this.cache = {};
    }
    return this.cache!;
  }

  get(key: string): string | undefined {
    return this.load()[key];
  }

  recordChoice(key: string, candidate: string): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    const data = this.load();
    data[key] = candidate;
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // 保存に失敗しても(容量超過等)、動作継続を優先し無視する
    }
  }
}

const defaultHistoryStore = new LocalStorageCandidateHistoryStore();

// バッファが指定文字数を超えても完成しない場合、無限に溜め込まないための安全弁。
// 子音の置き換え(canContinueBuffer)導入により、通常はバッファが2文字を超える前に
// 完成/置き換えのいずれかで解消されるため、実際にはほぼ到達しない防御的なフォールバック。
const MAX_PENDING_BUFFER_LENGTH = 4;

// 句読点・長音符。未確定の子音バッファがある状態でこれらが来た場合は、
// 中途半端な合成(例: "k" + "-" -> "kー")を避けるため、バッファを先にリテラル確定してから
// 句読点/長音符を独立して変換する。
const PUNCTUATION_CHARS = new Set([',', '.', '-']);

// 全角カッコ。本家SKKの慣習にならい、"["→「、"]"→」に固定変換する
// (wanakanaのローマ字→かな変換表には含まれないキーのため、専用のマップで扱う)。
const BRACKET_CHARS: Record<string, string> = {
  '[': '「',
  ']': '」'
};

// 本家SKKの"z"始まりの記号ショートカット。未確定バッファが"z"単体のときにこれらの
// キーが続くと、対応する記号に変換される("/"は通常のシェル操作(パス区切り等)でも
// 頻出するキーのため、常時インターセプトはせず、"z"の直後という条件付きでのみ扱う。
// isEngineが持つ現在のbuffer状態を見る必要があるため、静的なisSkkInterceptableKeyとは
// 別に、SkkEngine#canHandleSymbolShortcutで判定する)。
const Z_SYMBOL_SHORTCUTS: Record<string, string> = {
  '/': '・',
  '.': '…',
  ',': '‥',
  h: '←',
  j: '↓',
  k: '↑',
  l: '→'
};

const VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);

/**
 * かな入力モードで直接ハンドリング対象とすべきキーかどうかを判定する。
 * 呼び出し側(hyper.tsx)のkeydownハンドラで、xterm.jsへの素通しを止めるかの判定に使う。
 * 大文字・小文字どちらも対象(大文字は▽漢字変換モードの開始トリガーになるため)。
 */
export function isSkkInterceptableKey(key: string): boolean {
  return /^[a-zA-Z]$/.test(key) || PUNCTUATION_CHARS.has(key) || key in BRACKET_CHARS;
}

/**
 * SKKのローマ字→かな変換・モード管理・漢字変換(▽/▼)・送り仮名変換を担うステートマシン。
 *
 * スコープ:
 * - かな入力モードでの母音・子音・句読点・長音符の確定、子音の置き換え
 * - ▽漢字変換モード: 読み入力・辞書引き・▼候補選択・確定/キャンセル
 * - 送り仮名(活用語尾を伴う変換、例: 「OkuRu」→「送る」)
 * - qキーによるひらがな/カタカナの切り替え
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
  // 送り仮名のトリガーとなった子音1文字(小文字)。nullなら送り仮名なしの通常変換。
  // 2箇所目の大文字入力で設定される。辞書検索キーは `reading + okuriConsonant` になる
  // (例: 「おく」+「r」→「おくr」、SKK-JISYO側の送り仮名エントリ形式と一致)。
  private okuriConsonant: string | null = null;
  // 送り仮名として確定したかな(1モーラ分)。候補と結合して最終的な確定文字列を作る。
  private okuriKana = '';
  // 直近の辞書引きで使ったキー(reading、または送り仮名ありならreading+okuriConsonant)。
  // 確定時にCandidateHistoryStoreへ記録する際に使う。
  private historyKey: string | null = null;

  constructor(
    private readonly lookup: (reading: string) => string[] = lookupCandidates,
    private readonly historyStore: CandidateHistoryStore = defaultHistoryStore
  ) {}

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
   * "z"始まりの記号ショートカット(例: "z/"→「・」)を、今このキーで発動できるかどうか。
   * 呼び出し側(hyper.tsx)で、通常は素通しさせたいキー("/"等)を、"z"の直後という
   * 条件付きでのみインターセプト対象に切り替えるために使う。
   */
  canHandleSymbolShortcut(key: string): boolean {
    return this.buffer === 'z' && key in Z_SYMBOL_SHORTCUTS;
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
      if (this.okuriConsonant !== null) {
        // 送り仮名待ち: 本家SKKの慣習にならい「*」で送り仮名部分の開始を示す
        return this.reading + '*' + this.buffer;
      }
      return this.reading + this.buffer;
    }
    return this.buffer;
  }

  private resetHenkan(): void {
    this.subMode = 'direct';
    this.reading = '';
    this.candidates = [];
    this.candidateIndex = 0;
    this.okuriConsonant = null;
    this.okuriKana = '';
    this.historyKey = null;
  }

  /**
   * 辞書引きした候補配列を、CandidateHistoryStoreに記憶された「そのキーで最後に確定した候補」が
   * あれば先頭に並び替える。記憶がない、または候補に含まれていない場合はそのまま返す。
   */
  private reorderByHistory(key: string, candidates: string[]): string[] {
    const remembered = this.historyStore.get(key);
    if (!remembered) {
      return candidates;
    }
    const index = candidates.indexOf(remembered);
    if (index <= 0) {
      return candidates;
    }
    const reordered = candidates.slice();
    reordered.splice(index, 1);
    reordered.unshift(remembered);
    return reordered;
  }

  /**
   * 確定した候補をCandidateHistoryStoreに記録する。送り仮名ありの場合、
   * 候補には送り仮名(okuriKana)が結合済みなので、辞書引きキーと対応する形に
   * 戻す(末尾のokuriKana分を取り除く)。
   */
  private recordHistoryIfNeeded(chosen: string | undefined): void {
    if (!this.historyKey || !chosen) {
      return;
    }
    const stem = this.okuriKana ? chosen.slice(0, chosen.length - this.okuriKana.length) : chosen;
    this.historyStore.recordChoice(this.historyKey, stem);
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
   * 未確定のローマ字バッファを、最終確定用に解決する。
   * IMEMode:falseで変換することで、単独の"n"は「ん」に確定される
   * (IMEMode:trueだと「nn」等の続きを期待して"n"のまま止まってしまうため)。
   * "sh"のような真に不完全な綴りは、それでも変換できずローマ字のまま返る。
   * space/confirm(Enter)など、「これ以上入力が続かない」ことが確定したタイミングでのみ使う。
   */
  private resolveTrailingBuffer(): string {
    if (!this.buffer) {
      return '';
    }
    const resolved = toKana(this.buffer, {IMEMode: false});
    this.buffer = '';
    return resolved;
  }

  /**
   * ローマ字1文字をバッファに追加し、変換が成立すればその結果を返す(未成立なら空文字)。
   * PUNCTUATION_CHARSの特別扱いを含む、direct/henkan-reading共通のローマ字→かな変換処理。
   * 常にひらがなで返す(辞書の見出し語キーとして使うため、scriptの影響を受けない)。
   */
  private convertRawChar(char: string): string {
    if (this.buffer === 'z' && char in Z_SYMBOL_SHORTCUTS) {
      this.buffer = '';
      return Z_SYMBOL_SHORTCUTS[char];
    }

    if (char in BRACKET_CHARS) {
      const pendingLiteral = this.buffer;
      this.buffer = '';
      return pendingLiteral + BRACKET_CHARS[char];
    }

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
    this.recordHistoryIfNeeded(chosen);
    this.resetHenkan();
    return chosen;
  }

  /**
   * 送り仮名のローマ字が1モーラ分完成した時点で、`reading + okuriConsonant`をキーに
   * 辞書引きし、各候補に送り仮名を結合してhenkan-selectへ遷移する。
   * 候補が0件の場合は、読み+送り仮名をそのままかなとして確定してdirectに戻る。
   */
  private finishOkuriLookup(): string {
    const key = this.reading + (this.okuriConsonant ?? '');
    const candidates = this.reorderByHistory(key, this.lookup(key));
    if (candidates.length === 0) {
      const literal = this.applyScript(this.reading) + this.applyScript(this.okuriKana);
      this.resetHenkan();
      return literal;
    }
    this.candidates = candidates.map((c) => c + this.okuriKana);
    this.candidateIndex = 0;
    this.subMode = 'henkan-select';
    this.historyKey = key;
    // okuriConsonantはここではクリアしない。キャンセル時に送り仮名ローマ字入力を
    // やり直せるよう、マーカーとして保持し続ける(resetHenkan()で最終的にクリアされる)。
    return '';
  }

  /**
   * 小文字キー入力。
   * - direct中: 確定した文字列をそのまま返す(未確定なら空文字)。呼び出し側がPTYへ送出する。
   * - henkan-reading中(送り仮名マーカーなし): 読みバッファに追加するだけで、常に空文字を返す
   *   (確定はspace/confirmで行うため、ここでは何もPTYに送出しない)。
   * - henkan-reading中(送り仮名マーカーあり): 送り仮名のローマ字として処理する。
   *   1モーラ分完成した時点で自動的に辞書引きし、henkan-selectへ遷移する。
   * - henkan-select中: 現在の候補を暗黙的に確定してから、この文字はdirect相当として処理する。
   *   戻り値は「暗黙確定した候補」+「この文字による新たな確定分(あれば)」の連結。
   *
   * qキー(バッファが空の状態)は特別扱いする。
   * - direct中: ひらがな/カタカナのscriptをトグルするだけで、何も確定しない。
   * - henkan-reading中(送り仮名マーカーなし): 辞書引きせず、蓄積済みの読みをその場で
   *   カタカナ化して確定する(本家SKKのショートカット動作に合わせた挙動)。
   */
  input(char: string): string {
    const implicitlyConfirmed = this.implicitConfirmIfNeeded();

    if (char === 'q' && this.buffer.length === 0 && this.okuriConsonant === null) {
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

    if (this.subMode === 'henkan-reading' && this.okuriConsonant !== null) {
      const kana = this.convertRawChar(char);
      if (!kana) {
        return implicitlyConfirmed;
      }
      this.okuriKana = kana;
      return implicitlyConfirmed + this.finishOkuriLookup();
    }

    if (this.subMode === 'henkan-reading') {
      this.reading += this.convertRawChar(char);
      return implicitlyConfirmed;
    }
    return implicitlyConfirmed + this.convertChar(char);
  }

  /**
   * 大文字キー入力。
   * - direct中: ▽漢字変換モードを開始する。
   * - henkan-reading中(読みが1文字以上あり、まだ送り仮名マーカーなし): 送り仮名の開始
   *   マーカーとして扱う。以降の小文字入力は送り仮名のローマ字として処理される。
   * - henkan-select中の大文字は、現在の候補を暗黙的に確定してから、新たな▽漢字変換モードを開始する。
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
      this.okuriConsonant = null;
      this.okuriKana = '';
    }
    if (this.subMode === 'henkan-reading' && this.okuriConsonant === null && this.reading.length > 0) {
      // 2箇所目の大文字: 送り仮名の開始マーカー。この文字自体をconvertRawCharに通す。
      // 「使う」のように送り仮名が母音1文字(う)から始まる場合、この1文字だけで
      // 既にモーラが完成するため、即座に辞書引きへ進む必要がある
      // (単に「未確定として次の文字を待つ」と決め打ちしない)。
      //
      // マーカー処理に入る前に、読み側の未確定バッファ(例: 「KanSuru」の"n"のような
      // 単独の"n")を先に読みへ確定させておく必要がある。これをしないと、単独の"n"が
      // 送り仮名側のバッファに紛れ込み、読みが1文字短いまま辞書引きされてしまう
      // (「かんs」であるべきキーが「かs」になる、といった形で変換結果が壊れる)。
      if (this.buffer) {
        this.reading += this.resolveTrailingBuffer();
      }
      this.okuriConsonant = char;
      const kana = this.convertRawChar(char);
      if (kana) {
        this.okuriKana = kana;
        return implicitlyConfirmed + this.finishOkuriLookup();
      }
      return implicitlyConfirmed;
    }
    if (this.subMode === 'henkan-reading' && this.okuriConsonant === null) {
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
    if (this.subMode === 'henkan-reading' && this.okuriConsonant !== null) {
      // 送り仮名のローマ字入力中はSpaceに意味を持たせない(母音入力で自動的に確定されるため)
      return '';
    }
    if (this.subMode === 'henkan-reading') {
      if (this.buffer) {
        // 未確定ローマ字が残っている場合、最終解決してから読みに追加する
        // (単独の"n"は「ん」に、"sh"のような真に不完全な綴りはリテラルのまま)
        this.reading += this.resolveTrailingBuffer();
      }
      const candidates = this.reorderByHistory(this.reading, this.lookup(this.reading));
      if (candidates.length === 0) {
        const literal = this.applyScript(this.reading);
        this.resetHenkan();
        return literal;
      }
      this.candidates = candidates;
      this.candidateIndex = 0;
      this.subMode = 'henkan-select';
      this.historyKey = this.reading;
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
    if (this.subMode === 'henkan-reading' && this.okuriConsonant !== null) {
      // 送り仮名のローマ字入力中はEnterに意味を持たせない
      return '';
    }
    if (this.subMode === 'henkan-select') {
      const chosen = this.candidates[this.candidateIndex];
      this.recordHistoryIfNeeded(chosen);
      this.resetHenkan();
      return chosen;
    }
    if (this.subMode === 'henkan-reading') {
      if (this.buffer) {
        // 未確定ローマ字が残っている場合、最終解決してから読みに追加する
        this.reading += this.resolveTrailingBuffer();
      }
      const literal = this.applyScript(this.reading);
      this.resetHenkan();
      return literal;
    }
    return '';
  }

  /**
   * Escape。変換を1段階キャンセルする。
   * - henkan-select中(送り仮名変換由来): 送り仮名ローマ字入力待ちの状態に戻る
   *   (マーカーは残したまま、送り仮名の入力だけやり直せる)。
   * - henkan-select中(通常変換): 候補選択をやめてhenkan-readingに戻る(読みは保持)。
   * - henkan-reading中(送り仮名マーカーあり): マーカーを解除し、通常の▽読み入力に戻る。
   * - henkan-reading中(送り仮名マーカーなし): 読み入力自体を破棄してdirectに戻る。
   */
  cancel(): void {
    if (this.subMode === 'henkan-select') {
      this.subMode = 'henkan-reading';
      this.candidates = [];
      this.candidateIndex = 0;
      if (this.okuriConsonant !== null) {
        // 送り仮名のローマ字入力からやり直せるよう、マーカー(子音)はバッファにも残した状態
        // (「送り仮名待ち」の直前の状態)に戻し、確定済みの送り仮名かなだけクリアする。
        this.buffer = this.okuriConsonant;
        this.okuriKana = '';
      }
      return;
    }
    if (this.subMode === 'henkan-reading') {
      if (this.okuriConsonant !== null) {
        this.okuriConsonant = null;
        this.buffer = '';
        return;
      }
      this.resetHenkan();
    }
  }

  /**
   * バックスペース。
   * - 未確定ローマ字バッファがあれば、その末尾を1文字削る
   *   (送り仮名マーカーの子音1文字だけが残っている状態では、マーカー自体を解除する)。
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
      if (this.okuriConsonant !== null && this.buffer.length === 1) {
        this.okuriConsonant = null;
        this.buffer = '';
        return true;
      }
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
