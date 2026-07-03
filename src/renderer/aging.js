import { shuffle } from './terrain.js';

const TICK = 1; // 年齢を進める間隔(秒)
const DECAY_STEP_INTERVAL = 1.8; // 枯れ・崩れで1ブロック消える間隔

const CAMPFIRE_LIFE = [180, 420]; // たきびが燃えつきるまで(秒)
const ASH_LIFE = [120, 300]; // 灰が風に消えるまで
const FLOWER_LIFE = [300, 720]; // 花の寿命
const TREE_DECAY_CHANCE = 1 / 1500; // 1本あたり毎秒(期待寿命 約25分)
const HUT_DECAY_CHANCE = 1 / 2400; // 1軒あたり毎秒(期待寿命 約40分)

// 時のうつろい: たきびは燃えつき、花は枯れ、木は立ち枯れ、古い家は崩れる
export class Aging {
  constructor(world, settings) {
    this.settings = settings;
    this.onEvent = null;
    this.setWorld(world);
  }

  setWorld(world) {
    this.world = world;
    this.timer = 0;
    this.stepTimer = 0;
    this.ages = new Map(); // "kind:col,row" → { age, life }
    this.queue = []; // 少しずつ消えていくブロック
    this.queueLabel = null;
  }

  rand([min, max]) {
    return min + Math.random() * (max - min);
  }

  update(dt) {
    if (!this.settings.decay) return;

    // 分解キュー(枯れ・崩れは1ブロックずつ進む)
    this.stepTimer += dt;
    if (this.queue.length > 0 && this.stepTimer >= DECAY_STEP_INTERVAL) {
      this.stepTimer = 0;
      const b = this.queue.shift();
      // まだ同じブロックがそこにあるときだけ消す(ユーザーが触った場所は尊重)
      if (this.world.inBounds(b.col, b.row) && this.world.stackAt(b.col, b.row)[b.y] === b.type) {
        this.world.setBlock(b.col, b.row, b.y, null);
      }
      if (this.queue.length === 0 && this.queueLabel) {
        if (this.onEvent) this.onEvent(this.queueLabel);
        this.queueLabel = null;
      }
    }

    this.timer += dt;
    if (this.timer < TICK) return;
    this.timer = 0;
    this.tick();
  }

  tick() {
    this.ageTops('campfire', CAMPFIRE_LIFE, (c, r) => {
      this.world.replaceTop(c, r, 'ash');
      if (this.onEvent) this.onEvent('🔥 たきびが燃えつきた');
    });
    this.ageTops('ash', ASH_LIFE, (c, r) => this.world.removeTop(c, r));
    this.ageFlowers();
    if (this.queue.length === 0) {
      this.maybeKillTree();
      this.maybeCrumbleHut();
    }
  }

  // 露出している type ブロックの年齢を進め、寿命が来たら expire する
  ageTops(type, lifeRange, expire) {
    const alive = new Set();
    for (const [c, r] of this.world.columns()) {
      if (this.world.topType(c, r) !== type) continue;
      const key = `${type}:${c},${r}`;
      alive.add(key);
      let entry = this.ages.get(key);
      if (!entry) {
        entry = { age: 0, life: this.rand(lifeRange) };
        this.ages.set(key, entry);
      }
      entry.age += TICK;
      if (entry.age >= entry.life) {
        this.ages.delete(key);
        expire(c, r);
      }
    }
    // なくなった(または埋まった)ものの記録を掃除
    for (const key of [...this.ages.keys()]) {
      if (key.startsWith(`${type}:`) && !alive.has(key)) this.ages.delete(key);
    }
  }

  ageFlowers() {
    const alive = new Set();
    for (const flowerKey of [...this.world.flowers]) {
      const key = `flower:${flowerKey}`;
      alive.add(key);
      let entry = this.ages.get(key);
      if (!entry) {
        entry = { age: 0, life: this.rand(FLOWER_LIFE) };
        this.ages.set(key, entry);
      }
      entry.age += TICK;
      if (entry.age >= entry.life) {
        this.ages.delete(key);
        this.world.flowers.delete(flowerKey);
        this.world.version++;
      }
    }
    for (const key of [...this.ages.keys()]) {
      if (key.startsWith('flower:') && !alive.has(key)) this.ages.delete(key);
    }
  }

  // 木の立ち枯れ: 葉を散らし、幹を上から少しずつ崩す
  maybeKillTree() {
    const trunks = [...this.world.columns()].filter(([c, r]) => {
      const stack = this.world.stackAt(c, r);
      return stack.includes('wood') && stack.includes('leaves');
    });
    if (trunks.length === 0 || Math.random() >= trunks.length * TREE_DECAY_CHANCE) return;

    const [c, r] = trunks[Math.floor(Math.random() * trunks.length)];
    const stack = this.world.stackAt(c, r);
    // 幹の柱: 葉→幹の順(上から)
    for (let y = stack.length - 1; y >= 0; y--) {
      if (stack[y] === 'leaves' || stack[y] === 'wood') {
        this.queue.push({ col: c, row: r, y, type: stack[y] });
      }
    }
    // まわりに浮いている葉(下が空のもの=樹冠)
    for (const [nc, nr] of this.world.neighbors(c, r)) {
      const ns = this.world.stackAt(nc, nr);
      for (let y = ns.length - 1; y > 0; y--) {
        if (ns[y] === 'leaves' && !ns[y - 1]) {
          this.queue.push({ col: nc, row: nr, y, type: 'leaves' });
        }
      }
    }
    this.queueLabel = '🍂 ふるい木がかれた';
  }

  // 家の崩落: 屋根と壁を少しずつ崩す
  maybeCrumbleHut() {
    if (this.queue.length > 0) return;
    const centers = this.world.hutCenters();
    if (centers.length === 0 || Math.random() >= centers.length * HUT_DECAY_CHANCE) return;

    const [c, r] = centers[Math.floor(Math.random() * centers.length)];
    const roofY = this.world.topIndex(c, r);
    this.queue.push({ col: c, row: r, y: roofY, type: 'wood' });
    const walls = [];
    for (const [nc, nr] of this.world.neighbors(c, r)) {
      const ns = this.world.stackAt(nc, nr);
      // 屋根の高さから2段ぶんだけを崩す(まわりの建物は巻き込まない)
      for (let y = Math.min(ns.length - 1, roofY); y >= Math.max(0, roofY - 2); y--) {
        if (ns[y] === 'brick' || ns[y] === 'wood') {
          walls.push({ col: nc, row: nr, y, type: ns[y] });
        }
      }
    }
    this.queue.push(...shuffle(walls)); // 崩れる順はバラバラに
    this.queueLabel = '🏚️ ふるい家がくずれた';
  }
}
