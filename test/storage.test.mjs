import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorldFiles, saveWorldAtomic } from '../src/main/storage.ts';

async function paths() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tsuminiwa-storage-'));
  return {
    dir,
    target: path.join(dir, 'world.json'),
    backup: path.join(dir, 'world.backup.json'),
  };
}

test('atomic save: 正常な直前世代をバックアップする', async (t) => {
  const p = await paths();
  t.after(() => fs.rm(p.dir, { recursive: true, force: true }));
  assert.equal(await saveWorldAtomic(p.target, p.backup, '{"v":1}'), true);
  assert.equal(await saveWorldAtomic(p.target, p.backup, '{"v":2}'), true);
  assert.equal(await fs.readFile(p.target, 'utf8'), '{"v":2}');
  assert.equal(await fs.readFile(p.backup, 'utf8'), '{"v":1}');
});

test('atomic save: 不正JSONは現在の世界を上書きしない', async (t) => {
  const p = await paths();
  t.after(() => fs.rm(p.dir, { recursive: true, force: true }));
  await fs.writeFile(p.target, '{"v":1}');
  assert.equal(await saveWorldAtomic(p.target, p.backup, '{broken'), false);
  assert.equal(await fs.readFile(p.target, 'utf8'), '{"v":1}');
});

test('load: 本体が壊れていればバックアップから復旧する', async (t) => {
  const p = await paths();
  t.after(() => fs.rm(p.dir, { recursive: true, force: true }));
  await fs.writeFile(p.target, '{broken');
  await fs.writeFile(p.backup, '{"v":1}');
  assert.deepEqual(await loadWorldFiles(p.target, p.backup), {
    json: '{"v":1}',
    recovered: true,
    failed: false,
  });
});
