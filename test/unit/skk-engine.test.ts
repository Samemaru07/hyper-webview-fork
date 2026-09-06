import test from 'ava';

import {preloadLargeDictionary, lookupCandidates} from '../../lib/skk/dictionary';
import {isSkkInterceptableKey, SkkEngine} from '../../lib/skk/engine';
import type {CandidateHistoryStore} from '../../lib/skk/engine';

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

test('存在しない綴り(bx)は子音の置き換えにより解消され、無限に蓄積されない', (t) => {
  // qのように一部のアルファベットはwanakana側で特別な意味(っくぁ等)を持つため、
  // 確実にどの母音を続けても変換が成立しないbxの組み合わせで検証する。
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('b'), '');
  t.is(engine.getDisplay(), 'b');
  t.is(engine.input('x'), ''); // bxはどの母音でも変換が成立しないため、xに置き換わる
  t.is(engine.getDisplay(), 'x');
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

test('[は全角の「に変換される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('['), '「');
});

test(']は全角の」に変換される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input(']'), '」');
});

test('未確定バッファがある状態で[が来ると、バッファをリテラル確定してから「が続く', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('x'), ''); // xは単体では変換が成立せず、未確定バッファに残る
  t.is(engine.input('['), 'x「');
});

test('z/は全角の・に変換される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('z'), '');
  t.is(engine.input('/'), '・');
});

test('z.は全角の…に変換される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('z'), '');
  t.is(engine.input('.'), '…');
});

test('z,は全角の‥に変換される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('z'), '');
  t.is(engine.input(','), '‥');
});

test('zh/zj/zk/zlは矢印記号に変換される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('z'), '');
  t.is(engine.input('h'), '←');
  t.is(engine.input('z'), '');
  t.is(engine.input('j'), '↓');
  t.is(engine.input('z'), '');
  t.is(engine.input('k'), '↑');
  t.is(engine.input('z'), '');
  t.is(engine.input('l'), '→');
});

test('zの直後でなければh/j/k/lは通常のかな入力として扱われる', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('h'), '');
  t.is(engine.input('a'), 'は');
});

test('canHandleSymbolShortcutは、未確定バッファがzのときのみ/に対してtrueを返す', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.false(engine.canHandleSymbolShortcut('/')); // 直前にzが無ければfalse
  engine.input('z');
  t.true(engine.canHandleSymbolShortcut('/'));
  t.false(engine.canHandleSymbolShortcut('a')); // /以外はfalse
});

test('未確定バッファがある状態で句読点が来た場合、バッファをリテラル確定してから句読点を独立して変換する', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('k'), '');
  t.true(engine.hasPendingBuffer());
  t.is(engine.input(','), 'k、');
  t.false(engine.hasPendingBuffer());
});

test('isSkkInterceptableKeyはアルファベット・句読点・長音符・カッコのみtrueを返す', (t) => {
  t.true(isSkkInterceptableKey('a'));
  t.true(isSkkInterceptableKey('Z'));
  t.true(isSkkInterceptableKey(','));
  t.true(isSkkInterceptableKey('.'));
  t.true(isSkkInterceptableKey('-'));
  t.true(isSkkInterceptableKey('['));
  t.true(isSkkInterceptableKey(']'));
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
    わたし: ['私'],
    かk: ['書', '描'],
    かんs: ['関']
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

// 以下は本来、動的import(preloadLargeDictionary内のimport('./dictionary/skk-jisyo-l'))が
// 完了した後にSKK-JISYO.Lのエントリが見つかることを検証したいテストだが、
// webpackバンドル時とts-node(avaのテスト実行環境)とで動的importの解決経路が異なり、
// ts-node環境ではNode.jsのネイティブESMローダーに渡ってハングしてしまうため、
// このテストスイートでは検証できない。
// 実際のwebpackビルドでSKK-JISYO.Lが正しく別チャンクとして分離・ロードされることは、
// webpackビルドの実行結果(1.bundle.js等)で別途確認済み。
test.serial.skip(
  'preloadLargeDictionaryの読み込み完了後は、SKK-JISYO.L(大規模辞書)にしかないエントリも見つかる',
  async (t) => {
    preloadLargeDictionary();
    // 動的importの完了を待つため、読み込みが終わるまでポーリングする
    for (let i = 0; i < 50 && lookupCandidates('あーくとう').length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    t.deepEqual(lookupCandidates('あーくとう'), ['アーク灯']);
  }
);

test('子音の置き換え: mの後にdを打つと、mがdに置き換わりdaでだに変換できる', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('m'), '');
  t.is(engine.getDisplay(), 'm');
  t.is(engine.input('d'), ''); // mがdに置き換わる(バックスペース不要)
  t.is(engine.getDisplay(), 'd');
  t.is(engine.input('a'), 'だ');
});

test('子音の置き換え: 拗音(kya)は置き換え対象にならず、そのまま蓄積が続く', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('k'), '');
  t.is(engine.input('y'), ''); // kyは継続可能(kya/kyu/kyo)なので置き換えない
  t.is(engine.getDisplay(), 'ky');
  t.is(engine.input('a'), 'きゃ');
});

test('子音の置き換え: sh(しゃ行)も置き換え対象にならない', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('s'), '');
  t.is(engine.input('h'), ''); // shは継続可能(sha/shi/shu/she/sho)なので置き換えない
  t.is(engine.input('a'), 'しゃ');
});

test('子音の置き換え: 促音(同じ子音の繰り返し)も置き換え対象にならない', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('t'), '');
  t.is(engine.input('t'), ''); // ttは継続可能(tta等)なので置き換えない
  t.is(engine.getDisplay(), 'tt');
  t.is(engine.input('a'), 'った');
});

test('子音の置き換え: 連続して2回置き換わるケース(m→b→d)', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  engine.input('m');
  engine.input('b'); // mがbに置き換わる(mbはどの母音でも成立しない)
  t.is(engine.getDisplay(), 'b');
  engine.input('d'); // bがdに置き換わる(bdはどの母音でも成立しない)
  t.is(engine.getDisplay(), 'd');
  t.is(engine.input('a'), 'だ');
});

test('子音の置き換え: 母音は通常通りバッファに追加され置き換えの対象外', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  engine.input('k');
  t.is(engine.input('a'), 'か'); // 母音なので通常通り完成する
});

test('qキー(direct中、バッファが空)でひらがな/カタカナのscriptがトグルされる', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.getScript(), 'hiragana');
  t.is(engine.input('q'), ''); // トグルのみ、何も確定しない
  t.is(engine.getScript(), 'katakana');
  t.is(engine.input('k'), '');
  t.is(engine.input('a'), 'カ'); // カタカナで確定される
  t.is(engine.input('q'), '');
  t.is(engine.getScript(), 'hiragana');
  t.is(engine.input('k'), '');
  t.is(engine.input('a'), 'か'); // ひらがなに戻る
});

test('qキーはバッファが空のときのみ有効。子音が未確定の状態では通常の子音置き換えとして処理される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.input('k'), '');
  t.is(engine.getScript(), 'hiragana');
  engine.input('q'); // kにqを続けても、どの母音でも成立しないためqへ置き換わるだけ(scriptはトグルされない)
  t.is(engine.getScript(), 'hiragana');
});

test('句読点・長音符はカタカナscriptでも変化しない', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  engine.input('q');
  t.is(engine.input(','), '、');
  t.is(engine.input('-'), 'ー');
});

test('henkan-reading中にqを押すと、辞書引きせず読みをその場でカタカナ化して確定する', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  'ore'.split('').forEach((c) => engine.input(c));
  t.is(engine.getDisplay(), 'これ');
  t.is(engine.input('q'), 'コレ');
  t.is(engine.getSubMode(), 'direct');
});

test('katakanaモード中に開始したhenkan-readingの読みは、scriptに関わらず常にひらがなで蓄積される(辞書キーのため)', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.input('q'); // katakanaモードに切り替え
  engine.inputUpper('k');
  'anji'.split('').forEach((c) => engine.input(c));
  t.is(engine.getDisplay(), 'かんじ'); // ひらがなのまま
  engine.space();
  t.is(engine.getDisplay(), '漢字'); // 辞書引きも正常に機能する
});

test('toggleMode(ctrl+j)でscriptもhiraganaにリセットされる', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  engine.input('q');
  t.is(engine.getScript(), 'katakana');
  engine.toggleMode(); // ascii
  engine.toggleMode(); // kana、この時点でscriptがリセットされているはず
  t.is(engine.getScript(), 'hiragana');
});

test('送り仮名: KaKuと入力すると「かk」で辞書引きされ「書く」に変換できる', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k'); // K
  t.is(engine.input('a'), ''); // a → reading="か"
  t.is(engine.getDisplay(), 'か');
  engine.inputUpper('k'); // 2箇所目の大文字K → 送り仮名マーカー(子音'k')開始
  t.is(engine.getDisplay(), 'か*k'); // 送り仮名待ちのプレビュー表示
  t.is(engine.input('u'), ''); // u → "ku"→「く」が完成、自動的に辞書引き→henkan-select
  t.is(engine.getSubMode(), 'henkan-select');
  t.is(engine.getDisplay(), '書く');
  t.is(engine.confirm(), '書く');
  t.is(engine.getSubMode(), 'direct');
});

test('送り仮名: KanSuruと入力すると、単独の"n"が読みに含まれ「関する」に変換できる(回帰テスト)', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k'); // K
  t.is(engine.input('a'), ''); // a → reading="か"
  t.is(engine.input('n'), ''); // n → 単独では未確定のままバッファに保持される
  t.is(engine.getDisplay(), 'かn'); // 読み"か" + 未確定バッファ"n"のプレビュー(まだ送り仮名マーカーなし)
  engine.inputUpper('s'); // 2箇所目の大文字S → 送り仮名マーカー開始。
  // ここでバッファの"n"が読みへ確定され、reading="かん"になっている必要がある
  // (この確定が抜けると、"n"が送り仮名側に紛れ込み「貸す」等の誤変換になる)。
  t.is(engine.getDisplay(), 'かん*s');
  t.is(engine.input('u'), ''); // u → "su"→「す」が完成、辞書引きキーは"かんs"
  t.is(engine.getSubMode(), 'henkan-select');
  t.is(engine.getDisplay(), '関す');
  t.is(engine.input('r'), '関す'); // henkan-select中の入力で暗黙確定 + "r"はバッファに保持
  t.is(engine.input('u'), 'る'); // "ru"→「る」
  t.is(engine.getSubMode(), 'direct');
});

test('送り仮名: henkan-select中はSpaceで他の候補(描く)にも送れる', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  engine.input('a');
  engine.inputUpper('k');
  engine.input('u');
  t.is(engine.getDisplay(), '書く');
  engine.space();
  t.is(engine.getDisplay(), '描く');
});

test('送り仮名: 辞書にエントリがない場合、読み+送り仮名をそのままかなで確定してdirectに戻る', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('t');
  engine.input('a');
  engine.input('be'); // reading="たべ"
  engine.inputUpper('r'); // 送り仮名マーカー(子音'r')、"たべr"は辞書にない
  const committed = engine.input('u');
  t.is(committed, 'たべる'); // 候補なしのためひらがなのまま確定
  t.is(engine.getSubMode(), 'direct');
});

test('送り仮名: Escapeで送り仮名ローマ字入力をキャンセルすると、マーカーが外れ通常の▽読み入力に戻る', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  engine.input('a');
  engine.inputUpper('k'); // 送り仮名マーカー開始
  t.is(engine.getDisplay(), 'か*k');
  engine.cancel();
  t.is(engine.getDisplay(), 'か'); // マーカーが外れ、通常の▽読み入力に戻る
  t.is(engine.getSubMode(), 'henkan-reading');
});

test('送り仮名: henkan-select中にEscapeすると、送り仮名ローマ字入力からやり直せる状態に戻る', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  engine.input('a');
  engine.inputUpper('k');
  engine.input('u');
  t.is(engine.getSubMode(), 'henkan-select');
  engine.cancel();
  t.is(engine.getSubMode(), 'henkan-reading');
  t.is(engine.getDisplay(), 'か*k'); // 送り仮名のローマ字だけクリアされ、直前の状態(子音のみ)に戻る
  t.is(engine.input('u'), ''); // 送り仮名を打ち直せる
  t.is(engine.getDisplay(), '書く');
});

test('送り仮名: 送り仮名マーカーの子音1文字だけの状態でbackspaceすると、マーカー自体が解除される', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('k');
  engine.input('a');
  engine.inputUpper('k');
  t.is(engine.getDisplay(), 'か*k');
  t.true(engine.backspace());
  t.is(engine.getDisplay(), 'か'); // マーカーが外れる
});

test('送り仮名: 実際の辞書データを使い、KaKuが書くに変換できる(モック辞書ではなく本番辞書での回帰テスト)', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  engine.inputUpper('k');
  engine.input('a');
  engine.inputUpper('k');
  t.is(engine.input('u'), '');
  t.is(engine.getSubMode(), 'henkan-select');
  t.is(engine.getDisplay(), '書く');
  t.is(engine.confirm(), '書く');
});

test('送り仮名: 実際の辞書データを使い、KanSuruが関するに変換できる(モック辞書ではなく本番辞書での回帰テスト)', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  engine.inputUpper('k');
  engine.input('a');
  engine.input('n');
  engine.inputUpper('s');
  t.is(engine.input('u'), '');
  t.is(engine.getSubMode(), 'henkan-select');
  t.is(engine.getDisplay(), '関す');
  t.is(engine.input('r'), '関す');
  t.is(engine.input('u'), 'る');
});

test('送り仮名: 送り仮名マーカーの文字自体でモーラが完成する場合(母音1文字)、即座に辞書引きされる(使う)', (t) => {
  const testLookupU = (reading: string): string[] => {
    const dict: Record<string, string[]> = {つかu: ['使']};
    return dict[reading] ?? [];
  };
  const engine = new SkkEngine(testLookupU);
  engine.toggleMode();
  engine.inputUpper('t');
  engine.input('s');
  engine.input('u');
  engine.input('k');
  engine.input('a');
  t.is(engine.getDisplay(), 'つか');
  t.is(engine.inputUpper('u'), ''); // uだけで「う」が完成し、即座に辞書引き→henkan-select
  t.is(engine.getSubMode(), 'henkan-select');
  t.is(engine.getDisplay(), '使う');
});

test('送り仮名: 使う。のように直後に句点が来ても正しく「使う。」と確定する(元バグの再現ケース)', (t) => {
  const testLookupU = (reading: string): string[] => {
    const dict: Record<string, string[]> = {つかu: ['使']};
    return dict[reading] ?? [];
  };
  const engine = new SkkEngine(testLookupU);
  engine.toggleMode();
  engine.inputUpper('t');
  engine.input('s');
  engine.input('u');
  engine.input('k');
  engine.input('a');
  engine.inputUpper('u');
  t.is(engine.getDisplay(), '使う');
  t.is(engine.input('.'), '使う。'); // henkan-select中の句点で暗黙確定+句点も確定
  t.is(engine.getSubMode(), 'direct');
});

test('Hon+Spaceのように末尾が単独nの読みでも、正しく「ん」として辞書引きされる(元バグの再現ケース)', (t) => {
  const testLookupHon = (reading: string): string[] => {
    const dict: Record<string, string[]> = {ほん: ['本', '翻', '奔']};
    return dict[reading] ?? [];
  };
  const engine = new SkkEngine(testLookupHon);
  engine.toggleMode();
  engine.inputUpper('h');
  engine.input('o');
  t.is(engine.input('n'), ''); // n単体はまだ未確定、バッファに保持される
  t.is(engine.getDisplay(), 'ほn'); // 表示上は未変換のnのまま(preedit)
  engine.space();
  t.is(engine.getSubMode(), 'henkan-select');
  t.is(engine.getDisplay(), '本'); // 「ほん」として正しく辞書引きされる
});

test('Enter確定時も同様に、末尾の単独nが正しく「ん」として解決される', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  engine.inputUpper('h');
  engine.input('o');
  engine.input('n');
  const committed = engine.confirm();
  t.is(committed, 'ほん'); // 辞書変換ではなくそのままかな確定するケースでも「ん」になる
});

/**
 * テスト用のインメモリCandidateHistoryStore。
 * 複数のSkkEngineインスタンス間で履歴が共有される様子(再起動を跨いだ想定)を再現できる。
 */
function createInMemoryHistoryStore(): CandidateHistoryStore {
  const data: Record<string, string> = {};
  return {
    get: (key) => data[key],
    recordChoice: (key, candidate) => {
      data[key] = candidate;
    }
  };
}

test('候補の並び替え: 初回は辞書順、確定した候補を次回は先頭に表示する(かった: 勝った/買った)', (t) => {
  const testLookupKatta = (reading: string): string[] => {
    const dict: Record<string, string[]> = {かった: ['勝った', '買った']};
    return dict[reading] ?? [];
  };
  const history = createInMemoryHistoryStore();

  // 1回目: 辞書順(勝った、買った)。2番目の「買った」を選ぶ。
  const engine1 = new SkkEngine(testLookupKatta, history);
  engine1.toggleMode();
  engine1.inputUpper('k');
  'atta'.split('').forEach((c) => engine1.input(c));
  engine1.space();
  t.is(engine1.getDisplay(), '勝った'); // 初回は辞書順で先頭
  engine1.space();
  t.is(engine1.getDisplay(), '買った');
  t.is(engine1.confirm(), '買った');

  // 2回目: 別のエンジンインスタンス(再起動を想定)でも、同じhistory storeなら「買った」が先頭になる。
  const engine2 = new SkkEngine(testLookupKatta, history);
  engine2.toggleMode();
  engine2.inputUpper('k');
  'atta'.split('').forEach((c) => engine2.input(c));
  engine2.space();
  t.is(engine2.getDisplay(), '買った'); // 前回確定した候補が先頭に来る
});

test('getCandidateList: 候補が複数ある場合、一覧と現在の選択位置を返す(かった: 勝った/買った)', (t) => {
  const testLookupKatta = (reading: string): string[] => {
    const dict: Record<string, string[]> = {かった: ['勝った', '買った']};
    return dict[reading] ?? [];
  };
  const engine = new SkkEngine(testLookupKatta);
  engine.toggleMode();
  engine.inputUpper('k');
  'atta'.split('').forEach((c) => engine.input(c));
  engine.space();
  t.deepEqual(engine.getCandidateList(), {candidates: ['勝った', '買った'], index: 0});
  engine.space();
  t.deepEqual(engine.getCandidateList(), {candidates: ['勝った', '買った'], index: 1});
});

test('getCandidateList: 候補が1件のみの場合はnullを返す(ポップアップ不要)', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('w');
  'atashi'.split('').forEach((c) => engine.input(c));
  engine.space();
  t.is(engine.getDisplay(), '私');
  t.is(engine.getCandidateList(), null);
});

test('getCandidateList: henkan-select以外の状態ではnullを返す', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  t.is(engine.getCandidateList(), null); // directモード
  engine.inputUpper('w');
  t.is(engine.getCandidateList(), null); // henkan-reading中
});

test('previousCandidate: henkan-select中、xで前の候補へ戻る(かった: 勝った/買った/勝手)', (t) => {
  const testLookupKatta = (reading: string): string[] => {
    const dict: Record<string, string[]> = {かった: ['勝った', '買った', '勝手']};
    return dict[reading] ?? [];
  };
  const engine = new SkkEngine(testLookupKatta);
  engine.toggleMode();
  engine.inputUpper('k');
  'atta'.split('').forEach((c) => engine.input(c));
  engine.space();
  t.is(engine.getDisplay(), '勝った');
  engine.space();
  t.is(engine.getDisplay(), '買った');
  engine.space();
  t.is(engine.getDisplay(), '勝手');
  engine.previousCandidate();
  t.is(engine.getDisplay(), '買った');
  engine.previousCandidate();
  t.is(engine.getDisplay(), '勝った');
});

test('previousCandidate: 先頭候補でxを押すと、henkan-readingへ戻る(cancel()と同じ挙動)', (t) => {
  const testLookupKatta = (reading: string): string[] => {
    const dict: Record<string, string[]> = {かった: ['勝った', '買った']};
    return dict[reading] ?? [];
  };
  const engine = new SkkEngine(testLookupKatta);
  engine.toggleMode();
  engine.inputUpper('k');
  'atta'.split('').forEach((c) => engine.input(c));
  engine.space();
  t.is(engine.getSubMode(), 'henkan-select');
  engine.previousCandidate();
  t.is(engine.getSubMode(), 'henkan-reading');
  t.is(engine.getDisplay(), 'かった');
});

test('previousCandidate: henkan-select中でなければ何もしない', (t) => {
  const engine = new SkkEngine(testLookup);
  engine.toggleMode();
  engine.inputUpper('w');
  t.is(engine.getSubMode(), 'henkan-reading');
  engine.previousCandidate();
  t.is(engine.getSubMode(), 'henkan-reading'); // 変化なし
});

test('候補の並び替え: 送り仮名変換でも同様に、確定した候補が次回先頭に表示される', (t) => {
  const testLookupKaK = (reading: string): string[] => {
    const dict: Record<string, string[]> = {かk: ['書', '描', '欠']};
    return dict[reading] ?? [];
  };
  const history = createInMemoryHistoryStore();

  const engine1 = new SkkEngine(testLookupKaK, history);
  engine1.toggleMode();
  engine1.inputUpper('k');
  engine1.input('a');
  engine1.inputUpper('k');
  engine1.input('u');
  t.is(engine1.getDisplay(), '書く'); // 初回は辞書順
  engine1.space();
  t.is(engine1.getDisplay(), '描く');
  t.is(engine1.confirm(), '描く');

  const engine2 = new SkkEngine(testLookupKaK, history);
  engine2.toggleMode();
  engine2.inputUpper('k');
  engine2.input('a');
  engine2.inputUpper('k');
  engine2.input('u');
  t.is(engine2.getDisplay(), '描く'); // 前回確定した「描く」の語幹(描)が先頭に来る
});

test('候補の並び替え: 履歴に記憶された候補が今回の候補一覧に含まれない場合、辞書順のまま', (t) => {
  const history = createInMemoryHistoryStore();
  const lookupA = (reading: string): string[] => {
    const dict: Record<string, string[]> = {てすと: ['甲', '乙']};
    return dict[reading] ?? [];
  };
  const engine1 = new SkkEngine(lookupA, history);
  engine1.toggleMode();
  engine1.inputUpper('t');
  'esuto'.split('').forEach((c) => engine1.input(c));
  engine1.space();
  engine1.space(); // 「乙」を選ぶ
  t.is(engine1.confirm(), '乙');

  // 辞書の内容が変わり「乙」が候補から消えたケースを模擬
  const lookupB = (reading: string): string[] => {
    const dict: Record<string, string[]> = {てすと: ['甲', '丙']};
    return dict[reading] ?? [];
  };
  const engine2 = new SkkEngine(lookupB, history);
  engine2.toggleMode();
  engine2.inputUpper('t');
  'esuto'.split('').forEach((c) => engine2.input(c));
  engine2.space();
  t.is(engine2.getDisplay(), '甲'); // 履歴の「乙」が見つからないので辞書順のまま
});
