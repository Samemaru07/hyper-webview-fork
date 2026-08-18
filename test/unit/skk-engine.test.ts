import test from 'ava';

import {preloadLargeDictionary, lookupCandidates} from '../../lib/skk/dictionary';
import {isSkkInterceptableKey, SkkEngine} from '../../lib/skk/engine';

test('母音単体はそのまま確定する', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('a'), 'あ');
});

test('子音+母音は子音入力時は未確定、母音入力時に確定する', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('k'), '');
  t.true(engine.hasPendingBuffer());
  t.is(engine.input('a'), 'か');
  t.false(engine.hasPendingBuffer());
});

test('促音(っ)を含む入力が確定する', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('t'), '');
  t.is(engine.input('t'), '');
  t.is(engine.input('a'), 'った');
});

test('撥音(ん)の単体入力(nn)が確定する', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('n'), '');
  t.is(engine.input('n'), 'ん');
});

test('backspaceは未確定バッファがある場合のみ消費してtrueを返す', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.false(engine.backspace());
  engine.input('k');
  t.true(engine.backspace());
  t.false(engine.hasPendingBuffer());
});

test('toggleModeで英字入力⇔かな入力を切り替え、バッファをリセットする', (t) => {
  const engine = new SkkEngine();
  t.is(engine.getMode(), 'ascii');
  t.is(engine.toggleMode(), 'kana');
  engine.input('k');
  t.true(engine.hasPendingBuffer());
  t.is(engine.toggleMode(), 'ascii');
  t.false(engine.hasPendingBuffer());
});

test('存在しない綴りを打ち続けた場合、安全弁でリテラルとして確定する', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('q'), '');
  t.is(engine.input('q'), '');
  t.is(engine.input('q'), '');
  // 4文字目でMAX_PENDING_BUFFER_LENGTHに達し、リテラルとして吐き出される
  t.is(engine.input('q'), 'qqqq');
});

test('読点(,)は全角の「、」に変換される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input(','), '、');
});

test('句点(.)は全角の「。」に変換される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('.'), '。');
});

test('長音符(-)は全角の「ー」に変換される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('-'), 'ー');
});

test('母音の後の長音符は正しく結合される(例: aー)', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('a'), 'あ');
  t.is(engine.input('-'), 'ー');
});

test('未確定バッファがある状態で句読点が来た場合、バッファをリテラル確定してから句読点を独立して変換する', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('k'), '');
  t.true(engine.hasPendingBuffer());
  t.is(engine.input(','), 'k、');
  t.false(engine.hasPendingBuffer());
});

test('isSkkInterceptableKeyはアルファベット・句読点・長音符のみtrueを返す', (t) => {
  t.true(isSkkInterceptableKey('a'));
  t.true(isSkkInterceptableKey('Z'));
  t.true(isSkkInterceptableKey(','));
  t.true(isSkkInterceptableKey('.'));
  t.true(isSkkInterceptableKey('-'));
  t.false(isSkkInterceptableKey('1'));
  t.false(isSkkInterceptableKey(' '));
  t.false(isSkkInterceptableKey('Enter'));
  t.false(isSkkInterceptableKey('Backspace'));
});

test('getDisplayはdirectモード中、未確定バッファの中身をそのまま返す(preedit表示用)', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.getDisplay(), '');
  engine.input('k');
  t.is(engine.getDisplay(), 'k');
  engine.input('a');
  t.is(engine.getDisplay(), '');
});

// ここから▽漢字変換モードのテスト。実際の辞書データに依存しないよう、
// テスト用の固定辞書をコンストラクタで注入する。
const testLookup = (reading: string): string[] => {
  const dict: Record<string, string[]> = {
    かんじ: ['漢字', '幹事'],
    わたし: ['私']
  };
  return dict[reading] ?? [];
};

test('大文字入力でhenkan-readingへ遷移し、読みがひらがなで蓄積される', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  t.is(engine.getSubMode(), 'direct');
  engine.inputUpper('w');
  t.is(engine.getSubMode(), 'henkan-reading');
  engine.input('a');
  engine.input('t');
  engine.input('a');
  engine.input('s');
  engine.input('h');
  engine.input('i');
  t.is(engine.getDisplay(), 'わたし');
});

test('スペースで辞書引きし、henkan-selectへ遷移して最初の候補を表示する', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  'anji'.split('').forEach((c) => engine.input(c));
  t.is(engine.getDisplay(), 'かんじ');
  const committed = engine.space();
  t.is(committed, '');
  t.is(engine.getSubMode(), 'henkan-select');
  t.is(engine.getDisplay(), '漢字');
});

test('henkan-select中のスペースで次候補に送り、末尾で先頭へ循環する', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  'anji'.split('').forEach((c) => engine.input(c));
  engine.space();
  t.is(engine.getDisplay(), '漢字');
  engine.space();
  t.is(engine.getDisplay(), '幹事');
  engine.space();
  t.is(engine.getDisplay(), '漢字');
});

test('Enterで選択中の候補を確定し、directモードへ戻る', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  'anji'.split('').forEach((c) => engine.input(c));
  engine.space();
  engine.space(); // 幹事
  const committed = engine.confirm();
  t.is(committed, '幹事');
  t.is(engine.getSubMode(), 'direct');
  t.is(engine.getDisplay(), '');
});

test('辞書に見出し語がない場合、読みをそのままかなとして確定してdirectへ戻る', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('a');
  engine.input('i');
  engine.input('u');
  engine.input('e');
  engine.input('o');
  const committed = engine.space();
  t.is(committed, 'あいうえお');
  t.is(engine.getSubMode(), 'direct');
});

test('henkan-select中にキャンセル(cancel)するとhenkan-readingに戻り、読みは保持される', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  'anji'.split('').forEach((c) => engine.input(c));
  engine.space();
  t.is(engine.getSubMode(), 'henkan-select');
  engine.cancel();
  t.is(engine.getSubMode(), 'henkan-reading');
  t.is(engine.getDisplay(), 'かんじ');
});

test('henkan-reading中にキャンセル(cancel)するとdirectに戻り、読みは破棄される', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  engine.input('a');
  engine.cancel();
  t.is(engine.getSubMode(), 'direct');
  t.is(engine.getDisplay(), '');
});

test('henkan-reading中のbackspaceは、未確定ローマ字→読みの順に1文字ずつ削る', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  engine.input('a'); // 読み: 'か'
  engine.input('n'); // 未確定バッファ: 'n'
  t.is(engine.getDisplay(), 'かn');
  engine.backspace();
  t.is(engine.getDisplay(), 'か'); // 未確定バッファのnが消える
  engine.backspace();
  t.is(engine.getDisplay(), ''); // 読みの'か'が消える
  t.is(engine.getSubMode(), 'henkan-reading');
  engine.backspace();
  t.is(engine.getSubMode(), 'direct'); // 読みも空になったのでdirectへ戻る
});

test('henkan-select中のbackspaceはcancelと同様にhenkan-readingへ戻る', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  'anji'.split('').forEach((c) => engine.input(c));
  engine.space();
  t.is(engine.getSubMode(), 'henkan-select');
  engine.backspace();
  t.is(engine.getSubMode(), 'henkan-reading');
});

test('resetはhenkan中の状態も含めて完全にdirectへ戻す', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  'anji'.split('').forEach((c) => engine.input(c));
  engine.space();
  engine.reset();
  t.is(engine.getSubMode(), 'direct');
  t.is(engine.getMode(), 'kana');
  t.is(engine.getDisplay(), '');
});

test('実際の辞書データ(skk-jisyo-s.json)を使い、Watashiが私に変換できる', (t) => {
  // コンストラクタ引数を省略すると本番と同じ辞書(lookupCandidates)が使われる
  const engine = new SkkEngine();
  engine.toggleMode();
  engine.inputUpper('w');
  'atashi'.split('').forEach((c) => engine.input(c));
  t.is(engine.getDisplay(), 'わたし');
  engine.space();
  t.is(engine.getDisplay(), '私');
});

test('henkan-select中にEnterを介さず小文字を入力すると、候補が暗黙的に確定されてからその文字が処理される(Watashi+ha→私は)', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  engine.inputUpper('w');
  'atashi'.split('').forEach((c) => engine.input(c));
  engine.space();
  t.is(engine.getSubMode(), 'henkan-select');
  t.is(engine.input('h'), '私'); // 「私」が暗黙確定、hはまだ未確定なので追加分はなし
  t.is(engine.getSubMode(), 'direct');
  t.true(engine.hasPendingBuffer()); // hが未確定バッファに残っている
  t.is(engine.input('a'), 'は'); // haが確定して「は」
});

test('henkan-select中に大文字を入力すると、候補が暗黙的に確定されてから新たなhenkan-readingが始まる', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  'anji'.split('').forEach((c) => engine.input(c));
  engine.space();
  t.is(engine.getSubMode(), 'henkan-select');
  const committed = engine.inputUpper('k');
  t.is(committed, '漢字'); // 前の候補が暗黙確定
  t.is(engine.getSubMode(), 'henkan-reading'); // 新しい▽読み入力が始まっている
});

test('henkan-select中に句読点を入力すると、候補が暗黙的に確定されてから句読点も確定される', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  'anji'.split('').forEach((c) => engine.input(c));
  engine.space();
  t.is(engine.input(','), '漢字、');
  t.is(engine.getSubMode(), 'direct');
});

test.serial('preloadLargeDictionary呼び出し前は、SKK-JISYO.L(大規模辞書)にしかないエントリは見つからない', (t) => {
  // 「あーくとう」はSKK-JISYO.Lにのみ存在し、SKK-JISYO.Sには含まれない
  t.deepEqual(lookupCandidates('あーくとう'), []);
});

test.serial('preloadLargeDictionaryの読み込み完了後は、SKK-JISYO.L(大規模辞書)にしかないエントリも見つかる', async (t) => {
  preloadLargeDictionary();
  // 動的importの完了を待つため、読み込みが終わるまでポーリングする
  for (let i = 0; i < 50 && lookupCandidates('あーくとう').length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  t.deepEqual(lookupCandidates('あーくとう'), ['アーク灯']);
});
