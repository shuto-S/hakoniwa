import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateWorld,
  treePlan,
  plantTree,
  treeRemovalPlan,
  isTreeColumn,
  shuffle,
} from '../src/renderer/terrain.js';
import { BLOCK_TYPES } from '../src/renderer/config.js';
import { World } from '../src/renderer/world.js';

test('generateWorld: 全マスに地形があり、高さ上限を守る', () => {
  for (let i = 0; i < 5; i++) {
    const world = generateWorld(15, 15, 8);
    for (const [c, r] of world.columns()) {
      const height = world.heightAt(c, r);
      assert.ok(height >= 1, `(${c},${r}) が空`);
      assert.ok(height <= 8, `(${c},${r}) が高さ上限超え`);
      for (const block of world.stackAt(c, r)) {
        if (block) assert.ok(BLOCK_TYPES[block], `未知のブロック ${block}`);
      }
    }
  }
});

test('generateWorld: 草と水がだいたい存在する', () => {
  const world = generateWorld(15, 15, 8);
  const tops = [...world.columns()].map(([c, r]) => world.topType(c, r));
  assert.ok(tops.some((t) => t === 'grass' || t === 'leaves'), '草がない');
});

test('treePlan: 高さ上限に収まらないときは null', () => {
  const world = generateWorld(9, 9, 4); // 上限が低い
  // どの草マスでも、planが返るなら全ブロックが上限未満
  for (const [c, r] of world.columns()) {
    if (world.topType(c, r) !== 'grass') continue;
    const plan = treePlan(world, c, r);
    if (!plan) continue;
    for (const b of plan) {
      assert.ok(b.y < world.maxHeight, `y=${b.y} が上限超え`);
      assert.ok(['wood', 'leaves'].includes(b.type));
    }
  }
});

test('treePlan: 幹の下から葉までつながる形になっている', () => {
  const world = generateWorld(9, 9, 10);
  const grass = [...world.columns()].find(([c, r]) => world.topType(c, r) === 'grass');
  assert.ok(grass, 'テスト用の草マスがない');
  const plan = treePlan(world, ...grass);
  assert.ok(plan, 'planが立たない');
  const trunk = plan.filter((b) => b.type === 'wood');
  const base = world.heightAt(...grass);
  // 幹は地面から隙間なく積まれる
  trunk.sort((a, b) => a.y - b.y);
  trunk.forEach((b, i) => assert.equal(b.y, base + i));
  assert.ok(plan.some((b) => b.type === 'leaves'), '葉がない');
});

test('isTreeColumn: 小屋の屋根(木材だけの柱)は木とみなさない', () => {
  const world = new World(5, 5, 8);
  world.placeTop(1, 1, 'grass');
  world.placeTop(1, 1, 'wood'); // 屋根や柱だけ
  assert.equal(isTreeColumn(world, 1, 1), false);
  world.placeTop(1, 1, 'leaves');
  assert.equal(isTreeColumn(world, 1, 1), true);
});

test('treeRemovalPlan: 地面に接した樹冠の葉も取りこぼさない', () => {
  const world = new World(9, 9, 10);
  for (const [c, r] of world.columns()) world.placeTop(c, r, 'grass');
  // となりの1マスだけ、樹冠と同じ高さまで盛る
  const center = [4, 4];
  const [nc, nr] = world.neighbors(...center)[0];
  world.placeTop(nc, nr, 'stone');
  world.placeTop(nc, nr, 'stone'); // 高さ3

  // trunkHeight=2(random=0)で canopyY = 1+2 = 3 → 隣の葉は地面に接して置かれる
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    plantTree(world, ...center);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(world.stackAt(nc, nr)[3], 'leaves');
  assert.equal(world.stackAt(nc, nr)[2], 'stone'); // 下が空でない=浮いていない

  const plan = treeRemovalPlan(world, ...center);
  assert.ok(
    plan.some((b) => b.col === nc && b.row === nr && b.y === 3),
    '接地した樹冠の葉が除去対象に入っていない'
  );
  // 実際に消すと木がなくなる
  for (const b of plan) world.setBlock(b.col, b.row, b.y, null);
  assert.equal(isTreeColumn(world, ...center), false);
  assert.equal(world.stackAt(nc, nr).includes('leaves'), false);
});

test('generateWorld: params付きでも全マスに地形があり高さ上限を守る', () => {
  const params = { waterLevel: 0.5, hilliness: 1.8, treeDensity: 2, flowerDensity: 3, snow: 0.3, sandiness: 0.1 };
  const world = generateWorld(15, 15, 8, params);
  for (const [c, r] of world.columns()) {
    const h = world.heightAt(c, r);
    assert.ok(h >= 1 && h <= 8, `(${c},${r}) 高さ ${h}`);
  }
  // 水多め設定なら水マスが存在する
  assert.ok(world.topsOfType('water').length > 0);
});

test('generateWorld: 極端な水量でも必ず歩けるマスが残る(all-water 保険)', () => {
  const params = { waterLevel: 0.6, hilliness: 0.3, treeDensity: 0, flowerDensity: 0, snow: 0, sandiness: 0 };
  for (let i = 0; i < 20; i++) {
    const world = generateWorld(9, 9, 8, params);
    assert.ok(
      world.columnsWhere((c, r) => world.isWalkable(c, r)).length > 0,
      '歩けるマスがゼロになってはいけない'
    );
  }
});

test('generateWorld: params無しは従来と同じ経路(例外なく生成)', () => {
  const world = generateWorld(11, 11, 8);
  assert.equal([...world.columns()].length, 121);
});

test('shuffle: 要素が保存される', () => {
  const array = [1, 2, 3, 4, 5, 6, 7];
  const shuffled = shuffle([...array]);
  assert.deepEqual([...shuffled].sort(), array);
});
