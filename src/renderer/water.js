const MAX_SPREAD = 3; // 平らな場所を水が流れるマス数
const TICK = 0.35;

// 水は低いほうへ流れ、平地では数マスだけ広がる。
// 段差を落ちた水は新しい水源としてまた広がる(マイクラ風)。
export class WaterSim {
  constructor(world) {
    this.setWorld(world);
  }

  setWorld(world) {
    this.world = world;
    this.timer = 0;
    this.spreadDist = new Map(); // "col,row" → 水源からの距離
  }

  update(dt) {
    this.timer += dt;
    if (this.timer < TICK) return;
    this.timer = 0;
    this.step();
  }

  step() {
    const world = this.world;
    const flows = [];

    for (const [col, row] of world.columns()) {
      if (world.topType(col, row) !== 'water') continue;
      const level = world.heightAt(col, row);
      const dist = this.spreadDist.get(`${col},${row}`) ?? 0;
      for (const [nc, nr] of world.neighbors(col, row)) {
        if (world.topType(nc, nr) === 'water') continue;
        const nh = world.heightAt(nc, nr);
        if (nh >= level) continue;
        const falling = nh + 1 < level;
        if (!falling && dist >= MAX_SPREAD) continue;
        flows.push({ col: nc, row: nr, dist: falling ? 0 : dist + 1 });
      }
    }

    // 走査が終わってからまとめて流す(1ティックで連鎖しないように)。
    // 同じマスへ複数の流れが届いたときは、いちばん小さい距離を採用する
    // (滝で落ちた水 dist=0 を、平地からの流れ dist=3 が上書きしないように)
    for (const flow of flows) {
      const key = `${flow.col},${flow.row}`;
      if (this.world.topType(flow.col, flow.row) === 'water') {
        const current = this.spreadDist.get(key);
        if (current === undefined || flow.dist < current) this.spreadDist.set(key, flow.dist);
        continue;
      }
      if (this.world.placeTop(flow.col, flow.row, 'water')) {
        this.spreadDist.set(key, flow.dist);
      }
    }

    // 消えた水のメタ情報を掃除
    for (const key of [...this.spreadDist.keys()]) {
      const [c, r] = key.split(',').map(Number);
      if (!this.world.inBounds(c, r) || this.world.topType(c, r) !== 'water') {
        this.spreadDist.delete(key);
      }
    }
  }

  serialize() {
    return [...this.spreadDist.entries()];
  }

  load(entries) {
    this.spreadDist = new Map(entries || []);
  }
}
