import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '../src/renderer/i18n/index.js';
import {
  describeBlocks,
  describeEvent,
  registerEvent,
  listEvents,
  registerAction,
  getAction,
  listActions,
  actionFunctionDeclarations,
  worldManifest,
} from '../src/renderer/ai/registry.js';
import { observeWorld } from '../src/renderer/ai/observe.js';
import { World } from '../src/renderer/world.js';

test('describeBlocks: 全ブロックに key/name/desc が付く(言語で name が変わる)', () => {
  setLanguage('en');
  const en = describeBlocks();
  const grass = en.find((b) => b.key === 'grass');
  assert.equal(grass.name, 'Grass');
  assert.ok(grass.desc.length > 0);
  setLanguage('ja');
  const ja = describeBlocks();
  assert.equal(ja.find((b) => b.key === 'grass').name, 'くさ');
  assert.equal(en.length, ja.length);
});

test('describeEvent: 既定のレアが引ける / 未知は null', () => {
  assert.match(describeEvent('whale').subject, /whale/);
  assert.match(describeEvent('aurora').subject, /aurora/);
  assert.equal(describeEvent('nope'), null);
});

test('registerEvent: 新イベントを足すと listEvents / describeEvent に出る(=一句が自動対応)', () => {
  registerEvent('comet', { subject: 'a bright comet with a long tail' });
  assert.match(describeEvent('comet').subject, /comet/);
  assert.ok(listEvents().some((e) => e.kind === 'comet'));
});

test('アクションレジストリ: 登録すると function 宣言と実行が生える', () => {
  let ran = null;
  registerAction({
    key: 'plant_flower',
    description: 'Plant a flower on nearby grass',
    params: { type: 'object', properties: { col: { type: 'number' }, row: { type: 'number' } } },
    execute: (character, params) => {
      ran = { name: character.name, params };
    },
  });
  const decls = actionFunctionDeclarations();
  const decl = decls.find((d) => d.name === 'plant_flower');
  assert.ok(decl);
  assert.match(decl.description, /flower/);
  assert.equal(decl.parameters.type, 'object');

  const action = getAction('plant_flower');
  action.execute({ name: 'ゆず' }, { col: 1, row: 2 });
  assert.deepEqual(ran, { name: 'ゆず', params: { col: 1, row: 2 } });
  assert.ok(listActions().some((a) => a.key === 'plant_flower'));
});

test('worldManifest: blocks/events/actions を含む静的表', () => {
  const m = worldManifest();
  assert.ok(Array.isArray(m.blocks) && m.blocks.length > 0);
  assert.ok(Array.isArray(m.events));
  assert.ok(Array.isArray(m.actions));
});

test('observeWorld: 近傍ブロックを汎用に列挙し、新ブロックも自動で乗る', () => {
  const world = new World(9, 9, 8);
  for (const [c, r] of world.columns()) world.placeTop(c, r, 'grass');
  world.placeTop(4, 4, 'farm'); // 中央を畑に
  const char = { name: 'そら', type: 'villager', job: 'farmer', trait: { key: 'lively' }, col: 4, row: 4 };
  const obs = observeWorld(world, char, {
    weather: 'sunny',
    season: 'spring',
    characters: [char, { name: 'うみ', type: 'villager', col: 5, row: 4 }],
    recentEvents: ['a', 'b'],
  });
  assert.equal(obs.self.name, 'そら');
  assert.equal(obs.weather, 'sunny');
  assert.equal(obs.nearby.length, 6); // 六角の隣接6マス
  assert.ok(obs.nearby.every((n) => n.block === 'grass'));
  assert.ok(obs.others.some((o) => o.name === 'うみ' && o.distance === 1));
});
