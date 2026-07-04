import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/renderer/world.js';

function makeWorld(cols = 7, rows = 7, maxHeight = 8) {
  return new World(cols, rows, maxHeight);
}

test('placeTop は積み上がり、maxHeight で止まる', () => {
  const world = makeWorld(3, 3, 3);
  assert.equal(world.placeTop(1, 1, 'grass'), true);
  assert.equal(world.placeTop(1, 1, 'dirt'), true);
  assert.equal(world.placeTop(1, 1, 'stone'), true);
  assert.equal(world.placeTop(1, 1, 'stone'), false); // 上限
  assert.equal(world.heightAt(1, 1), 3);
  assert.equal(world.topType(1, 1), 'stone');
});

test('removeTop は花 → 作物 → ブロックの順に消す', () => {
  const world = makeWorld();
  world.placeTop(2, 2, 'farm');
  world.plantCrop(2, 2);
  world.flowers.add('2,2');
  assert.equal(world.removeTop(2, 2), true); // 花
  assert.equal(world.flowers.has('2,2'), false);
  assert.equal(world.crops.has('2,2'), true);
  assert.equal(world.removeTop(2, 2), true); // 作物
  assert.equal(world.crops.has('2,2'), false);
  assert.equal(world.removeTop(2, 2), true); // ブロック
  assert.equal(world.heightAt(2, 2), 0);
  assert.equal(world.removeTop(2, 2), false); // もう何もない
});

test('ブロックを置くと花と作物は消える', () => {
  const world = makeWorld();
  world.placeTop(1, 1, 'farm');
  world.plantCrop(1, 1);
  world.flowers.add('1,1');
  world.placeTop(1, 1, 'stone');
  assert.equal(world.flowers.has('1,1'), false);
  assert.equal(world.crops.has('1,1'), false);
});

test('setBlock は null 埋めで宙に浮くブロックを作れる', () => {
  const world = makeWorld();
  world.placeTop(0, 0, 'grass');
  world.setBlock(0, 0, 3, 'leaves'); // 高さ3に浮かせる(1,2はnull)
  assert.equal(world.heightAt(0, 0), 4);
  assert.equal(world.topType(0, 0), 'leaves');
  assert.equal(world.stackAt(0, 0)[1], null);
  // 浮いた葉を消すと trailing null が刈られて元の高さに戻る
  world.setBlock(0, 0, 3, null);
  assert.equal(world.heightAt(0, 0), 1);
  assert.equal(world.stackAt(0, 0).length, 1);
});

test('neighbors: odd-r オフセットが distance=1 と一致する', () => {
  const world = makeWorld(9, 9);
  for (const [c, r] of [[4, 4], [4, 3]]) {
    const neighbors = world.neighbors(c, r);
    assert.equal(neighbors.length, 6, `(${c},${r}) の隣は6マス`);
    for (const [nc, nr] of neighbors) {
      assert.equal(world.distance(c, r, nc, nr), 1, `(${c},${r})→(${nc},${nr})`);
    }
    // 重複なし
    assert.equal(new Set(neighbors.map(([a, b]) => `${a},${b}`)).size, 6);
  }
});

test('distance は対称で、自分自身は0', () => {
  const world = makeWorld(9, 9);
  assert.equal(world.distance(2, 3, 2, 3), 0);
  for (const [a, b] of [[[0, 0], [5, 5]], [[1, 4], [6, 2]], [[3, 3], [3, 6]]]) {
    assert.equal(world.distance(...a, ...b), world.distance(...b, ...a));
    assert.ok(world.distance(...a, ...b) > 0);
  }
});

test('isWalkable: 水の上は歩けないが、凍ると歩ける', () => {
  const world = makeWorld();
  world.placeTop(1, 1, 'water');
  assert.equal(world.isWalkable(1, 1), false);
  world.frozen = true;
  assert.equal(world.isWalkable(1, 1), true);
  assert.equal(world.isWalkable(0, 0), false); // 何もないマス
});

test('hutCenters: 屋根の下にレンガ壁が4方向以上あると家', () => {
  const world = makeWorld(9, 9);
  const center = [4, 4];
  // 地面
  for (const [c, r] of world.columns()) world.placeTop(c, r, 'grass');
  // 壁と屋根(autopilot の hutPlan と同じ形)
  const neighbors = world.neighbors(...center);
  neighbors.forEach(([nc, nr], i) => {
    if (i === 0) return; // 入口
    world.setBlock(nc, nr, 1, 'brick');
    world.setBlock(nc, nr, 2, 'brick');
  });
  for (const [nc, nr] of neighbors) world.setBlock(nc, nr, 3, 'wood');
  world.setBlock(...center, 3, 'wood');
  const centers = world.hutCenters();
  assert.deepEqual(centers, [center]);
});

test('serialize → deserialize で世界が保たれる', () => {
  const world = makeWorld(4, 4, 6);
  world.placeTop(0, 0, 'grass');
  world.setBlock(1, 1, 2, 'leaves'); // 浮きブロック(null含む)
  world.placeTop(2, 2, 'farm');
  world.plantCrop(2, 2);
  world.crops.get('2,2').stage = 1;
  world.flowers.add('0,0');

  const restored = World.deserialize(world.serialize());
  assert.equal(restored.cols, 4);
  assert.equal(restored.maxHeight, 6);
  assert.deepEqual(restored.stackAt(1, 1), [null, null, 'leaves']);
  assert.equal(restored.topType(0, 0), 'grass');
  assert.ok(restored.flowers.has('0,0'));
  assert.deepEqual(restored.crops.get('2,2'), { stage: 1, t: 0 });
});

test('columnsWhere 相当: columns() は全マスを一度ずつ返す', () => {
  const world = makeWorld(5, 6);
  const all = [...world.columns()];
  assert.equal(all.length, 30);
  assert.equal(new Set(all.map(([c, r]) => `${c},${r}`)).size, 30);
});
