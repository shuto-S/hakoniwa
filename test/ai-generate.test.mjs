import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiClient } from '../src/renderer/ai/client.js';
import {
  generateMutter,
  generatePoem,
  generateTale,
  generateChronicle,
  refillNamePool,
} from '../src/renderer/ai/generate.js';

// AIレスポンスをモックする backend。台本(reply)を返し、渡された opts を記録する。
function mockBackend(reply) {
  const calls = [];
  return {
    calls,
    hasKey: async () => true,
    generate: async (opts) => {
      calls.push(opts);
      const text = typeof reply === 'function' ? reply(opts) : reply;
      return text == null ? { ok: false, error: 'mock-fail' } : { ok: true, text };
    },
  };
}

const enabled = { aiEnabled: true, aiConsent: true, aiAuthMode: 'developer', aiModel: 'm' };
// レート制限を無効化してロジックだけ見る
const noLimit = { limits: { maxPerDay: 1e9, minIntervalMs: 0 } };

test('generateMutter: モック応答を整形して返す(引用符・改行を除去)', async () => {
  const backend = mockBackend('「いい天気だなあ」\n(余計な行)');
  const c = new AiClient(enabled, backend, noLimit);
  const line = await generateMutter(c, { season: 'spring', weather: 'sunny', timeOfDay: 'day', name: 'ゆず', lang: 'ja' });
  assert.equal(line, 'いい天気だなあ');
  // プロンプトに文脈が乗っているか
  assert.match(backend.calls[0].prompt, /ゆず/);
  assert.match(backend.calls[0].system, /Japanese/);
});

test('generatePoem: kind ごとにプロンプトが変わり、応答を返す', async () => {
  const backend = mockBackend((opts) => (opts.prompt.includes('whale') ? '🐋 はるのそら' : 'x'));
  const c = new AiClient(enabled, backend, noLimit);
  const line = await generatePoem(c, 'whale', { season: 'spring', lang: 'ja' });
  assert.equal(line, '🐋 はるのそら');
});

test('generateTale: 応答を返す', async () => {
  const c = new AiClient(enabled, mockBackend('🚶 とおくの海を見たよ'), noLimit);
  assert.equal(await generateTale(c, { season: 'summer', lang: 'ja' }), '🚶 とおくの海を見たよ');
});

test('generateChronicle: できごとが空なら生成せず null', async () => {
  const backend = mockBackend('📖 きょうも平和だった');
  const c = new AiClient(enabled, backend, noLimit);
  assert.equal(await generateChronicle(c, [], { day: 1, season: 'spring', lang: 'ja' }), null);
  assert.equal(backend.calls.length, 0, '空なら生成を呼ばない');
});

test('generateChronicle: できごとを渡すと要約が返り、プロンプトに含まれる', async () => {
  const backend = mockBackend('📖 家がたって、雨がふった一日');
  const c = new AiClient(enabled, backend, noLimit);
  const line = await generateChronicle(c, ['🏠 家がたった', '🌧 あめ'], { day: 3, season: 'summer', lang: 'ja' });
  assert.equal(line, '📖 家がたって、雨がふった一日');
  assert.match(backend.calls[0].prompt, /家がたった/);
  assert.match(backend.calls[0].prompt, /Day 3/);
});

test('refillNamePool: JSON配列応答をプールに積む', async () => {
  const backend = mockBackend('["そら","うみ","はな"]');
  const c = new AiClient(enabled, backend, noLimit);
  const names = await refillNamePool(c, 'villager', { season: 'spring', lang: 'ja' });
  assert.deepEqual(names, ['そら', 'うみ', 'はな']);
  assert.equal(c.size('name:villager'), 3);
  assert.equal(c.take('name:villager'), 'そら');
  // schema 付きで頼んでいる
  assert.ok(backend.calls[0].schema);
});

test('refillNamePool: 壊れた応答なら空(プールは増えない)', async () => {
  const c = new AiClient(enabled, mockBackend('not json'), noLimit);
  assert.deepEqual(await refillNamePool(c, 'sheep', { season: 'spring', lang: 'ja' }), []);
  assert.equal(c.size('name:sheep'), 0);
});

test('AI無効なら生成関数はすべて null / 空(モックは呼ばれない)', async () => {
  const backend = mockBackend('should not be used');
  const c = new AiClient({ ...enabled, aiEnabled: false }, backend, noLimit);
  assert.equal(await generateMutter(c, { season: 'spring', weather: 'sunny', timeOfDay: 'day', name: 'x', lang: 'ja' }), null);
  assert.equal(await generatePoem(c, 'whale', { season: 'spring', lang: 'ja' }), null);
  assert.equal(await generateChronicle(c, ['a'], { day: 1, season: 'spring', lang: 'ja' }), null);
  assert.deepEqual(await refillNamePool(c, 'villager', { season: 'spring', lang: 'ja' }), []);
  assert.equal(backend.calls.length, 0);
});

test('生成失敗(ok:false)でも null / 空でフォールバック', async () => {
  const c = new AiClient(enabled, mockBackend(null), noLimit); // 常に失敗
  assert.equal(await generateMutter(c, { season: 'spring', weather: 'sunny', timeOfDay: 'day', name: 'x', lang: 'ja' }), null);
  assert.deepEqual(await refillNamePool(c, 'villager', { season: 'spring', lang: 'ja' }), []);
});
