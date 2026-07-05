import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mutterRequest,
  cleanLine,
  poemRequest,
  taleRequest,
  chronicleRequest,
  namesRequest,
  parseNameList,
} from '../src/renderer/ai/flavor.ts';

test('mutterRequest: 文脈を含み、言語指定が入る', () => {
  const req = mutterRequest({
    season: 'spring',
    weather: 'rain',
    timeOfDay: 'day',
    name: 'ゆず',
    job: 'farmer',
    trait: 'lively',
    lang: 'ja',
  });
  assert.match(req.system, /Japanese/);
  assert.match(req.prompt, /spring/);
  assert.match(req.prompt, /rain/);
  assert.match(req.prompt, /ゆず/);
  assert.match(req.prompt, /farmer/);
  assert.ok(req.maxOutputTokens > 0);
});

test('mutterRequest: 英語指定', () => {
  const req = mutterRequest({
    season: 'winter',
    weather: 'snow',
    timeOfDay: 'night',
    name: 'Sora',
    lang: 'en',
  });
  assert.match(req.system, /English/);
});

test('poemRequest: subject と季節・言語が入る', () => {
  const r = poemRequest({ subject: 'a whale in the sky', season: 'spring', lang: 'ja' });
  assert.match(r.system, /Japanese/);
  assert.match(r.prompt, /whale/);
  assert.match(r.prompt, /spring/);
  const en = poemRequest({ subject: 'the aurora', season: 'winter', lang: 'en' });
  assert.match(en.system, /English/);
  assert.match(en.prompt, /aurora/);
});

test('taleRequest: 言語指定', () => {
  assert.match(taleRequest({ season: 'autumn', lang: 'en' }).system, /English/);
  assert.match(taleRequest({ season: 'autumn', lang: 'ja' }).system, /Japanese/);
});

test('chronicleRequest: できごとを渡し要約を頼む', () => {
  const r = chronicleRequest(['🏠 家がたった', '🌧 あめになった'], {
    day: 3,
    season: 'summer',
    lang: 'ja',
  });
  assert.match(r.prompt, /家がたった/);
  assert.match(r.prompt, /Day 3/);
  assert.ok(r.maxOutputTokens > 0);
});

test('namesRequest: schema付きで種類・言語を反映', () => {
  const r = namesRequest('sheep', { season: 'spring', lang: 'en' });
  assert.equal(r.schema.type, 'array');
  assert.match(r.system, /sheep/);
  assert.match(r.system, /romanized/);
  const ja = namesRequest('villager', { season: 'spring', lang: 'ja' });
  assert.match(ja.system, /Japanese/);
});

test('parseNameList: JSON配列を安全にパース', () => {
  assert.deepEqual(parseNameList('["a"," b ","",1,"c"]'), ['a', 'b', 'c']);
  assert.deepEqual(parseNameList('not json'), []);
  assert.deepEqual(parseNameList(null), []);
  assert.deepEqual(parseNameList('{"x":1}'), []);
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
