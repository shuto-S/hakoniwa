import { BLOCK_TYPES, HEX_RADIUS, HEX_WIDTH, BLOCK_HEIGHT } from './config.js';

// odd-r オフセット座標(尖った頂点が上下方向の六角形、奇数行が右にずれる)
const NEIGHBORS_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const NEIGHBORS_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

export class World {
  constructor(cols, rows, maxHeight) {
    this.cols = cols;
    this.rows = rows;
    this.maxHeight = maxHeight;
    // 各マスはブロック種の配列。null は空中(木の葉の下など)
    this.stacks = Array.from({ length: cols * rows }, () => []);
    this.flowers = new Set(); // "col,row" — マスの上に咲く飾り
    this.crops = new Map(); // "col,row" → { stage: 0..2, t: 経過秒 } はたけの上の作物
    this.frozen = false; // 冬は水面が凍る(保存されない・季節から導出)
    this.version = 0; // 変更検知用
  }

  index(col, row) {
    return row * this.cols + col;
  }

  inBounds(col, row) {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  stackAt(col, row) {
    return this.stacks[this.index(col, row)];
  }

  // 一番上の非 null ブロックの段。空なら -1
  topIndex(col, row) {
    const stack = this.stackAt(col, row);
    for (let y = stack.length - 1; y >= 0; y--) {
      if (stack[y]) return y;
    }
    return -1;
  }

  topType(col, row) {
    const top = this.topIndex(col, row);
    return top >= 0 ? this.stackAt(col, row)[top] : null;
  }

  heightAt(col, row) {
    return this.topIndex(col, row) + 1;
  }

  placeTop(col, row, type) {
    if (!this.inBounds(col, row) || !BLOCK_TYPES[type]) return false;
    const stack = this.stackAt(col, row);
    this.trim(stack);
    if (stack.length >= this.maxHeight) return false;
    stack.push(type);
    this.flowers.delete(`${col},${row}`);
    this.crops.delete(`${col},${row}`);
    this.version++;
    return true;
  }

  removeTop(col, row) {
    if (!this.inBounds(col, row)) return false;
    const key = `${col},${row}`;
    if (this.flowers.has(key)) {
      this.flowers.delete(key);
      this.version++;
      return true;
    }
    if (this.crops.has(key)) {
      this.crops.delete(key);
      this.version++;
      return true;
    }
    const stack = this.stackAt(col, row);
    const top = this.topIndex(col, row);
    if (top < 0) return false;
    stack[top] = null;
    this.trim(stack);
    this.version++;
    return true;
  }

  plantCrop(col, row) {
    const key = `${col},${row}`;
    if (this.topType(col, row) !== 'farm' || this.crops.has(key)) return false;
    this.crops.set(key, { stage: 0, t: 0 });
    this.version++;
    return true;
  }

  removeCrop(col, row) {
    if (!this.crops.delete(`${col},${row}`)) return false;
    this.version++;
    return true;
  }

  // 任意の段に置く(木の葉のように宙に浮かせられる)
  setBlock(col, row, y, type) {
    if (!this.inBounds(col, row) || y < 0 || y >= this.maxHeight) return false;
    const stack = this.stackAt(col, row);
    while (stack.length <= y) stack.push(null);
    stack[y] = type;
    this.trim(stack);
    if (type && this.topIndex(col, row) <= y) {
      this.flowers.delete(`${col},${row}`);
      this.crops.delete(`${col},${row}`);
    }
    this.version++;
    return true;
  }

  replaceTop(col, row, type) {
    const top = this.topIndex(col, row);
    if (top < 0) return false;
    this.stackAt(col, row)[top] = type;
    this.version++;
    return true;
  }

  addFlower(col, row) {
    if (!this.inBounds(col, row)) return false;
    this.flowers.add(`${col},${row}`);
    this.version++;
    return true;
  }

  trim(stack) {
    while (stack.length > 0 && !stack[stack.length - 1]) stack.pop();
  }

  neighbors(col, row) {
    const offsets = row % 2 === 0 ? NEIGHBORS_EVEN : NEIGHBORS_ODD;
    const result = [];
    for (const [dc, dr] of offsets) {
      const c = col + dc;
      const r = row + dr;
      if (this.inBounds(c, r)) result.push([c, r]);
    }
    return result;
  }

  // キャラクターが立てるマスか(水面の上は不可。凍っていれば歩ける)
  isWalkable(col, row) {
    const top = this.topType(col, row);
    if (top === null) return false;
    if (BLOCK_TYPES[top].water) return this.frozen;
    return true;
  }

  // 家の中心 = 屋根(き)が頭上にあり、まわりの過半にレンガの壁がある柱
  hutCenters() {
    const centers = [];
    for (const [c, r] of this.columns()) {
      if (this.topType(c, r) !== 'wood') continue;
      const walls = this.neighbors(c, r).filter(([nc, nr]) =>
        this.stackAt(nc, nr).includes('brick')
      );
      if (walls.length >= 4) centers.push([c, r]);
    }
    return centers;
  }

  // 六角グリッド上のマス距離
  distance(c1, r1, c2, r2) {
    const toCube = (c, r) => {
      const x = c - (r - (r & 1)) / 2;
      return [x, -x - r, r];
    };
    const a = toCube(c1, r1);
    const b = toCube(c2, r2);
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  }

  // ワールド座標(グリッド中心が原点)
  positionOf(col, row) {
    const offsetX = (this.cols - 1 + 0.5) * HEX_WIDTH * 0.5;
    const offsetZ = ((this.rows - 1) * 1.5 * HEX_RADIUS) / 2;
    return {
      x: (col + 0.5 * (row % 2)) * HEX_WIDTH - offsetX,
      z: row * 1.5 * HEX_RADIUS - offsetZ,
    };
  }

  topSurfaceY(col, row) {
    return this.heightAt(col, row) * BLOCK_HEIGHT;
  }

  // マウス位置(ワールドXZ)から一番近いマスを求める
  columnAtPoint(x, z) {
    let best = null;
    let bestDist = HEX_WIDTH * HEX_WIDTH; // 半径 √3R/2 より少し緩め
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const p = this.positionOf(col, row);
        const dx = p.x - x;
        const dz = p.z - z;
        const d = dx * dx + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          best = { col, row };
        }
      }
    }
    return best;
  }

  *columns() {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        yield [col, row];
      }
    }
  }

  serialize() {
    return {
      v: 1,
      cols: this.cols,
      rows: this.rows,
      maxHeight: this.maxHeight,
      stacks: this.stacks.map((s) => s.map((b) => b || 0)),
      flowers: [...this.flowers],
      crops: [...this.crops.entries()],
    };
  }

  static deserialize(data) {
    const world = new World(data.cols, data.rows, data.maxHeight);
    data.stacks.forEach((stack, i) => {
      world.stacks[i] = stack.map((b) => (b && BLOCK_TYPES[b] ? b : null));
      world.trim(world.stacks[i]);
    });
    for (const key of data.flowers || []) world.flowers.add(key);
    for (const [key, crop] of data.crops || []) world.crops.set(key, crop);
    return world;
  }
}
