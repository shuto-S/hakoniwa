import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/renderer/world.ts';
import { WaterSim } from '../src/renderer/water.ts';

// 平らな土台の上で水の広がりを調べる
function flatWorld(height = 1) {
  const world = new World(9, 9, 8);
  for (const [c, r] of world.columns()) {
    for (let y = 0; y < height; y++) world.placeTop(c, r, 'stone');
  }
  return world;
}

function waterCount(world) {
  return [...world.columns()].filter(([c, r]) => world.topType(c, r) === 'water').length;
}

test('水は下に落ちる', () => {
  const world = flatWorld(1);
  // 中央だけ2段高くして、その上に水
  world.placeTop(4, 4, 'stone');
  world.placeTop(4, 4, 'stone');
  world.placeTop(4, 4, 'water');
  const sim = new WaterSim(world);
  sim.step();
  // 水位より低い隣へ流れている
  const spread = world.neighbors(4, 4).filter(([c, r]) => world.topType(c, r) === 'water').length;
  assert.ok(spread > 0, '水が流れていない');
});

test('平地では MAX_SPREAD を超えて広がらない(無限拡散しない)', () => {
  const world = flatWorld(2);
  // 1マスだけ低い水源…ではなく、高台に水源を置く
  world.placeTop(4, 4, 'water');
  const sim = new WaterSim(world);
  for (let i = 0; i < 60; i++) sim.step();
  const count = waterCount(world);
  // MAX_SPREAD=3 なので距離3以内(六角で1+3+6+9=37マス)を超えない
  assert.ok(count <= 37, `広がりすぎ: ${count}`);
  // 全マス(81)を飲み込んでいないこと
  assert.ok(count < 81, '世界が水没した');
  // 水源から距離3を超えるマスに水がない
  for (const [c, r] of world.columns()) {
    if (world.topType(c, r) === 'water') {
      assert.ok(world.distance(4, 4, c, r) <= 3, `(${c},${r}) は遠すぎる`);
    }
  }
});

test('段差を落ちた水はまた広がる(滝)', () => {
  const world = flatWorld(1);
  // 高さ3の柱の上に水源 → 下に落ちてから平地を広がる
  for (let i = 0; i < 2; i++) world.placeTop(0, 0, 'stone');
  world.placeTop(0, 0, 'water');
  const sim = new WaterSim(world);
  for (let i = 0; i < 40; i++) sim.step();
  // 落下点(dist=0扱い)からさらに3マス広がれる
  const count = waterCount(world);
  assert.ok(count > 3, `滝下で広がっていない: ${count}`);
});

test('serialize/load で広がり距離が保たれる', () => {
  const world = flatWorld(2);
  world.placeTop(4, 4, 'water');
  const sim = new WaterSim(world);
  for (let i = 0; i < 10; i++) sim.step();
  const saved = sim.serialize();
  const sim2 = new WaterSim(world);
  sim2.load(saved);
  const before = waterCount(world);
  for (let i = 0; i < 30; i++) sim2.step();
  // 復元後も上限を守る
  assert.ok(waterCount(world) <= 37, 'ロード後に広がりすぎ');
  assert.ok(waterCount(world) >= before);
});
