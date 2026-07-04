import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiClient } from '../src/renderer/ai/client.js';

function makeBackend(overrides = {}) {
  const calls = [];
  return {
    calls,
    hasKey: async () => overrides.hasKey ?? true,
    generate: async (opts) => {
      calls.push(opts);
      return overrides.generate ? overrides.generate(opts) : { ok: true, text: 'hi' };
    },
  };
}

const enabled = { aiEnabled: true, aiConsent: true, aiAuthMode: 'developer', aiModel: 'm' };

test('AI無効/未同意のときは生成せず null', async () => {
  const backend = makeBackend();
  const c = new AiClient({ ...enabled, aiEnabled: false }, backend);
  assert.equal(await c.generate({ prompt: 'x' }), null);
  const c2 = new AiClient({ ...enabled, aiConsent: false }, backend);
  assert.equal(await c2.generate({ prompt: 'x' }), null);
  assert.equal(backend.calls.length, 0);
});

test('キーが無ければ null', async () => {
  const backend = makeBackend({ hasKey: false });
  const c = new AiClient(enabled, backend);
  assert.equal(await c.generate({ prompt: 'x' }), null);
  assert.equal(backend.calls.length, 0);
});

test('生成失敗(ok:false)は null にフォールバック', async () => {
  const backend = makeBackend({ generate: () => ({ ok: false, error: 'boom' }) });
  const c = new AiClient(enabled, backend);
  assert.equal(await c.generate({ prompt: 'x' }), null);
});

test('成功時はテキストを返す', async () => {
  const backend = makeBackend({ generate: () => ({ ok: true, text: '  やあ  ' }) });
  const c = new AiClient(enabled, backend);
  assert.equal(await c.generate({ prompt: 'x' }), '  やあ  ');
});

test('最小間隔の間は生成しない(レート上限)', async () => {
  let now = 1_000_000;
  const backend = makeBackend();
  const c = new AiClient(enabled, backend, { now: () => now, limits: { maxPerDay: 100, minIntervalMs: 5000 } });
  assert.equal(await c.generate({ prompt: 'a' }), 'hi');
  assert.equal(await c.generate({ prompt: 'b' }), null); // すぐ次は弾かれる
  now += 5000;
  assert.equal(await c.generate({ prompt: 'c' }), 'hi'); // 間隔が空けば通る
  assert.equal(backend.calls.length, 2);
});

test('1日の上限を超えたら生成しない/翌日リセット', async () => {
  let now = 0;
  const backend = makeBackend();
  const c = new AiClient(enabled, backend, { now: () => now, limits: { maxPerDay: 2, minIntervalMs: 0 } });
  assert.equal(await c.generate({ prompt: '1' }), 'hi');
  assert.equal(await c.generate({ prompt: '2' }), 'hi');
  assert.equal(await c.generate({ prompt: '3' }), null); // 上限
  now += 86400000; // 翌日
  assert.equal(await c.generate({ prompt: '4' }), 'hi');
});

test('並行呼び出しでも最小間隔をすり抜けない(レート枠を同期確保)', async () => {
  let now = 1_000_000;
  // hasKey に非同期の間(await)を作って TOCTOU を再現しやすくする
  const backend = {
    calls: [],
    hasKey: async () => {
      await Promise.resolve();
      return true;
    },
    generate: async (opts) => {
      backend.calls.push(opts);
      return { ok: true, text: 'hi' };
    },
  };
  const c = new AiClient(enabled, backend, { now: () => now, limits: { maxPerDay: 100, minIntervalMs: 5000 } });
  // 同フレームで3件を同時に発火(await しない)
  const [a, b, d] = await Promise.all([
    c.generate({ prompt: '1' }),
    c.generate({ prompt: '2' }),
    c.generate({ prompt: '3' }),
  ]);
  // 最初の1件だけ通り、残りは最小間隔で弾かれる
  const passed = [a, b, d].filter((x) => x !== null).length;
  assert.equal(passed, 1);
  assert.equal(backend.calls.length, 1);
});

test('プール: fill/take/size と空のときの null', () => {
  const c = new AiClient(enabled, makeBackend());
  assert.equal(c.take('mutter'), null);
  c.fill('mutter', ['a', '', '  ', 'b']); // 空白は除外
  assert.equal(c.size('mutter'), 2);
  assert.equal(c.take('mutter'), 'a');
  assert.equal(c.take('mutter'), 'b');
  assert.equal(c.take('mutter'), null);
});
