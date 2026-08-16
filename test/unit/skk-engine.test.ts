import test from 'ava';

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

test('getBufferは未確定バッファの中身をそのまま返す(preedit表示用)', (t) => {
  const engine = new SkkEngine();
  engine.toggleMode();
  t.is(engine.getBuffer(), '');
  engine.input('k');
  t.is(engine.getBuffer(), 'k');
  engine.input('a');
  t.is(engine.getBuffer(), '');
});
