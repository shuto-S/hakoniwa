import { World } from './world.js';

// なだらかな地形をつくる簡易バリューノイズ
function makeNoise(cols, rows) {
  const size = 6;
  const grid = Array.from({ length: size * size }, () => Math.random());
  const at = (x, y) => grid[Math.min(size - 1, y) * size + Math.min(size - 1, x)];
  return (col, row) => {
    const fx = (col / Math.max(1, cols - 1)) * (size - 1);
    const fy = (row / Math.max(1, rows - 1)) * (size - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

// params(任意): worldgen-schema の値。無ければ既定で従来どおりの生成。
export function generateWorld(cols, rows, maxHeight, params = null) {
  const world = new World(cols, rows, maxHeight);
  const noise = makeNoise(cols, rows);

  // 既定値(params 無しなら従来と同じ挙動)
  const waterLevel = params ? params.waterLevel : 0.22;
  const hilliness = params ? params.hilliness : 1;
  const sandBand = (params ? params.sandiness : 0.08) + waterLevel;
  const treeMul = params ? params.treeDensity : 1;
  const flowerMul = params ? params.flowerDensity : 1;

  for (const [col, row] of world.columns()) {
    const v = noise(col, row);
    const stack = world.stackAt(col, row);
    if (v < waterLevel) {
      // 池
      stack.push('sand', 'water');
    } else if (v < sandBand) {
      // 砂浜
      stack.push('sand', 'sand');
    } else {
      const raw = 2 + Math.round((v - sandBand) * 5 * hilliness);
      const height = Math.max(2, Math.min(maxHeight - 3, raw));
      for (let y = 0; y < height - 1; y++) {
        stack.push(y < height - 2 ? 'stone' : 'dirt');
      }
      stack.push(height >= 5 ? 'stone' : 'grass');
    }
  }

  // 水が多すぎて陸が無いと住民が住めない。最低限の陸を必ず残す(ことばで世界生成の保険)
  if (world.columnsWhere((c, r) => world.isWalkable(c, r)).length === 0) {
    for (const [c, r] of world.columns()) {
      if (world.topType(c, r) === 'water') world.replaceTop(c, r, 'sand');
    }
  }

  // 最初の木と花(密度は params で調整)
  const grassColumns = [...world.columns()].filter(([c, r]) => world.topType(c, r) === 'grass');
  shuffle(grassColumns);
  const treeCount = Math.round(Math.max(2, (cols * rows) / 60) * treeMul);
  for (let i = 0; i < treeCount && i < grassColumns.length; i++) {
    plantTree(world, grassColumns[i][0], grassColumns[i][1]);
  }
  const flowerCount = Math.round(4 * flowerMul);
  for (let i = treeCount; i < treeCount + flowerCount && i < grassColumns.length; i++) {
    const [c, r] = grassColumns[i];
    // 木が生えて樹冠になったマスには咲かせない
    if (world.topType(c, r) === 'grass') world.addFlower(c, r);
  }

  // 雪化粧(params.snow の割合だけ、地表を雪に)
  const snow = params ? params.snow : 0;
  if (snow > 0) {
    for (const [c, r] of world.columns()) {
      const top = world.topType(c, r);
      if (top && top !== 'water' && Math.random() < snow) world.placeTop(c, r, 'snow');
    }
  }

  world.version++;
  return world;
}

// 幹2〜3段 + 中心と隣接マスに葉、を積む木
export function treePlan(world, col, row) {
  const base = world.heightAt(col, row);
  const trunkHeight = 2 + Math.floor(Math.random() * 2);
  const canopyY = base + trunkHeight;
  if (canopyY + 1 >= world.maxHeight) return null;

  const blocks = [];
  for (let y = 0; y < trunkHeight; y++) {
    blocks.push({ col, row, y: base + y, type: 'wood' });
  }
  for (const [nc, nr] of world.neighbors(col, row)) {
    if (world.heightAt(nc, nr) <= canopyY) {
      blocks.push({ col: nc, row: nr, y: canopyY, type: 'leaves' });
    }
  }
  blocks.push({ col, row, y: canopyY, type: 'leaves' });
  blocks.push({ col, row, y: canopyY + 1, type: 'leaves' });
  return blocks;
}

export function plantTree(world, col, row) {
  const plan = treePlan(world, col, row);
  if (!plan) return false;
  for (const b of plan) world.setBlock(b.col, b.row, b.y, b.type);
  return true;
}

// 幹の柱と樹冠をまとめて消すための一覧(枯れ・伐採で共用)。
// 隣の葉は「幹に葉がある高さ」と「宙に浮いている葉」の両方を対象にする
// (斜面では樹冠の葉が地面に接して置かれることがあるため)。
export function treeRemovalPlan(world, col, row) {
  const stack = world.stackAt(col, row);
  const blocks = [];
  const canopyLevels = new Set();
  for (let y = stack.length - 1; y >= 0; y--) {
    if (stack[y] === 'leaves') canopyLevels.add(y);
    if (stack[y] === 'leaves' || stack[y] === 'wood') {
      blocks.push({ col, row, y, type: stack[y] });
    }
  }
  for (const [nc, nr] of world.neighbors(col, row)) {
    const ns = world.stackAt(nc, nr);
    for (let y = ns.length - 1; y >= 0; y--) {
      if (ns[y] !== 'leaves') continue;
      if (canopyLevels.has(y) || (y > 0 && !ns[y - 1])) {
        blocks.push({ col: nc, row: nr, y, type: 'leaves' });
      }
    }
  }
  return blocks;
}

// 「木」の定義: 幹と葉の両方を含む柱(小屋の屋根の木材と区別する)
export function isTreeColumn(world, col, row) {
  const stack = world.stackAt(col, row);
  return stack.includes('wood') && stack.includes('leaves');
}

export function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
