import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mutterRequest, cleanLine } from '../src/renderer/ai/flavor.js';

test('mutterRequest: 文脈を含み、言語指定が入る', () => {
  const req = mutterRequest({
    season: 'spring', weather: 'rain', timeOfDay: 'day',
    name: 'ゆず', job: 'farmer', trait: 'lively', lang: 'ja',
  });
  assert.match(req.system, /Japanese/);
  assert.match(req.prompt, /spring/);
  assert.match(req.prompt, /rain/);
  assert.match(req.prompt, /ゆず/);
  assert.match(req.prompt, /farmer/);
  assert.ok(req.maxOutputTokens > 0);
});

test('mutterRequest: 英語指定', () => {
  const req = mutterRequest({ season: 'winter', weather: 'snow', timeOfDay: 'night', name: 'Sora', lang: 'en' });
  assert.match(req.system, /English/);
});

test('cleanLine: 引用符・改行の除去と長さ制限', () => {
  assert.equal(cleanLine('「いい天気」'), 'いい天気');
  assert.equal(cleanLine('  hello  '), 'hello');
  assert.equal(cleanLine('first line\nsecond'), 'first line');
  assert.equal(cleanLine(''), null);
  assert.equal(cleanLine(null), null);
  const long = 'あ'.repeat(40);
  const out = cleanLine(long, 10);
  assert.ok(out.length <= 11 && out.endsWith('…'));
});
