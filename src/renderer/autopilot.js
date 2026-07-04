import { treePlan, shuffle, isTreeColumn } from './terrain.js';

const PLAN_INTERVAL = 2.2; // 次のできごとを考えるまでの間隔
const BUILD_INTERVAL = 0.28; // 建設中の1ブロックごとの間隔

// 自動発展モード: 草がひろがり、花が咲き、木が育ち、ひとが家を建てる
export class Autopilot {
  constructor(world, characterManager, settings) {
    this.world = world;
    this.characters = characterManager;
    this.settings = settings;
    this.enabled = false;
    this.queue = [];
    this.queueLabel = null; // 建設が終わったときの「できごと」通知
    this.timer = 0;
    this.weather = null; // main で注入される
    this.calendar = null; // 季節(daynight)
    this.onEvent = null;
  }

  setWorld(world) {
    this.world = world;
    this.queue = [];
    this.queueLabel = null;
    this.timer = 0;
  }

  update(dt) {
    if (!this.enabled) return;
    this.timer += dt;
    const base = this.queue.length > 0 ? BUILD_INTERVAL : PLAN_INTERVAL;
    const interval = base / this.settings.autoSpeed;
    if (this.timer < interval) return;
    this.timer = 0;

    if (this.queue.length > 0) {
      const b = this.queue.shift();
      this.world.setBlock(b.col, b.row, b.y, b.type);
      if (this.queue.length === 0 && this.queueLabel) {
        if (this.onEvent) this.onEvent(this.queueLabel);
        this.queueLabel = null;
      }
      return;
    }
    this.plan();
  }

  plan() {
    // 天気と季節で世界の育ちかたが変わる
    const weather = this.weather ? this.weather.state : 'sunny';
    const season = this.calendar ? this.calendar.season.key : 'spring';
    if (weather === 'rain' && Math.random() < 0.5) {
      Math.random() < 0.5 ? this.spreadGrass() : this.bloomFlower();
      return;
    }
    if (weather === 'snow' && Math.random() < 0.45) {
      this.snowfall();
      return;
    }
    if (weather === 'sunny' && Math.random() < 0.12 && season !== 'winter') {
      this.meltSnow();
      return;
    }
    if (season === 'spring' && Math.random() < 0.2) {
      this.bloomFlower();
      return;
    }

    const roll = Math.random();
    if (roll < 0.4) this.spreadGrass();
    else if (roll < 0.58) this.bloomFlower();
    else if (roll < 0.75) this.growTree();
    else if (roll < 0.85) this.buildHut();
    else if (roll < 0.93) this.capSnow();
    // 残りは何もしない(静かなターン)
  }

  // 雪の日: どこかのマスに雪が積もる(積もりすぎない程度に)
  snowfall() {
    const snowy = this.world.topsOfType('snow').length;
    if (snowy > this.world.cols * this.world.rows * 0.15) return;
    const spots = this.world.columnsWhere((c, r) => {
      const top = this.world.topType(c, r);
      return (
        top && top !== 'snow' && top !== 'water' && this.world.heightAt(c, r) < this.world.maxHeight
      );
    });
    if (spots.length === 0) return;
    const [c, r] = spots[Math.floor(Math.random() * spots.length)];
    this.world.placeTop(c, r, 'snow');
  }

  // 晴れの日: 積もった雪がとける
  meltSnow() {
    const spots = this.world.topsOfType('snow');
    if (spots.length === 0) return;
    const [c, r] = spots[Math.floor(Math.random() * spots.length)];
    this.world.removeTop(c, r);
  }

  grassTops() {
    return this.world.topsOfType('grass');
  }

  spreadGrass() {
    const candidates = this.world.columnsWhere((c, r) => {
      if (this.world.topType(c, r) !== 'dirt') return false;
      return this.world
        .neighbors(c, r)
        .some(([nc, nr]) => this.world.topType(nc, nr) === 'grass');
    });
    if (candidates.length === 0) return;
    const [c, r] = candidates[Math.floor(Math.random() * candidates.length)];
    this.world.replaceTop(c, r, 'grass');
  }

  bloomFlower() {
    if (this.world.flowers.size >= Math.floor((this.world.cols * this.world.rows) / 9)) return;
    const spots = this.grassTops().filter(([c, r]) => !this.world.flowers.has(`${c},${r}`));
    if (spots.length === 0) return;
    const [c, r] = spots[Math.floor(Math.random() * spots.length)];
    this.world.addFlower(c, r);
  }

  growTree() {
    // 冬は木が育たない
    if (this.calendar && this.calendar.season.key === 'winter') return;
    // 小屋の屋根の木材を数えないよう「幹+葉」で判定する
    const treeCount = this.world.columnsWhere((c, r) => isTreeColumn(this.world, c, r)).length;
    if (treeCount >= Math.floor((this.world.cols * this.world.rows) / 18)) return;

    const spots = shuffle(
      this.grassTops().filter(([c, r]) =>
        // まわりに幹がないところに生やす
        this.world.neighbors(c, r).every(([nc, nr]) => !this.world.stackAt(nc, nr).includes('wood'))
      )
    );
    for (const [c, r] of spots) {
      const plan = treePlan(this.world, c, r);
      if (plan) {
        this.queue.push(...plan);
        return;
      }
    }
  }

  capSnow() {
    const peaks = this.world.columnsWhere(
      (c, r) =>
        this.world.topType(c, r) === 'stone' &&
        this.world.heightAt(c, r) >= Math.max(4, this.world.maxHeight - 3) &&
        this.world.heightAt(c, r) < this.world.maxHeight
    );
    if (peaks.length === 0) return;
    const [c, r] = peaks[Math.floor(Math.random() * peaks.length)];
    this.queue.push({ col: c, row: r, y: this.world.heightAt(c, r), type: 'snow' });
  }

  // ひとがいるときだけ、六角リングの小屋を少しずつ建てる
  buildHut() {
    const hasVillager = this.characters.characters.some((c) => c.type === 'villager');
    if (!hasVillager) return;

    const brickColumns = this.world.columnsWhere((c, r) =>
      this.world.stackAt(c, r).includes('brick')
    ).length;
    if (brickColumns >= 15) return; // 小屋はだいたい3軒まで

    const spots = shuffle(this.grassTops());
    for (const [c, r] of spots) {
      const site = this.hutPlan(c, r);
      if (site) {
        this.queue.push(...site);
        this.queueLabel = '🏠 ちいさな家がたった';
        return;
      }
    }
  }

  hutPlan(col, row) {
    const neighbors = this.world.neighbors(col, row);
    if (neighbors.length < 6) return null; // 端は避ける
    const base = this.world.heightAt(col, row);
    if (base + 3 >= this.world.maxHeight) return null;
    for (const [nc, nr] of neighbors) {
      if (this.world.heightAt(nc, nr) !== base) return null; // 平地だけ
      if (this.world.topType(nc, nr) !== 'grass') return null;
    }

    const blocks = [];
    const doorway = Math.floor(Math.random() * 6);
    for (let level = 0; level < 2; level++) {
      neighbors.forEach(([nc, nr], i) => {
        if (i === doorway) return; // 入口
        blocks.push({ col: nc, row: nr, y: base + level, type: 'brick' });
      });
    }
    for (const [nc, nr] of neighbors) {
      blocks.push({ col: nc, row: nr, y: base + 2, type: 'wood' });
    }
    blocks.push({ col, row, y: base + 2, type: 'wood' });
    return blocks;
  }
}
