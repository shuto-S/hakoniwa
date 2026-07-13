import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneLevelUndo } from '../src/renderer/undo.ts';

test('Undoは直前の一世代だけを返す', () => {
  const undo = new OneLevelUndo();
  undo.capture('最初の世界');
  undo.capture('直前の確定済み世界');
  assert.equal(undo.take(), '直前の確定済み世界');
  assert.equal(undo.take(), null);
});

test('Undo可能時間切れ相当のclearで復元対象を破棄する', () => {
  const undo = new OneLevelUndo();
  undo.capture({ world: 1 });
  undo.clear();
  assert.equal(undo.take(), null);
});
