import test from 'ava';

import {SkkEngine} from '../../lib/skk/engine';

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
