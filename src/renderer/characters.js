import * as THREE from 'three';
import { MAX_CHARACTERS } from './config.js';
import { shuffle, treePlan, treeRemovalPlan, isTreeColumn } from './terrain.js';
import { MAKERS } from './characterMeshes.js';

const NAMES = {
  villager: ['そら', 'うみ', 'はな', 'ゆず', 'こはる', 'もも', 'りん', 'たろう', 'あおい', 'つむぎ', 'さくら', 'ふうた'],
  sheep: ['モコ', 'フワ', 'メエ', 'ポワ', 'ユキ', 'マシュ', 'ワタ'],
  chicken: ['ピヨ', 'コッコ', 'トサカ', 'マメ', 'ココ', 'チャボ'],
  deer: ['モミジ', 'シカノスケ', 'バンビ'],
  cat: ['タマ', 'クロ', 'ミケ', 'トラ'],
  traveler: ['たびびと'],
};

// せいかく: 歩くはやさと、次の行動までの間の個体差
export const TRAITS = [
  { label: 'のんびり', speed: 0.8, idle: 1.4 },
  { label: 'せっかち', speed: 1.25, idle: 0.65 },
  { label: 'げんき', speed: 1.15, idle: 0.8 },
  { label: 'まいぺーす', speed: 1, idle: 1 },
  { label: 'おくびょう', speed: 0.9, idle: 1.25 },
];

const JOBS = ['きこり', 'のうふ', 'つりびと', 'むらびと'];

const BABY_SCALE = 0.55;
const GROW_TIME = 240; // 子どもがおとなになるまで(秒)
const EGG_HATCH_TIME = [90, 180];
const EGG_RATE = 1 / 240; // にわとり1羽あたり毎秒の産卵確率
const LAMB_RATE = 1 / 300;
const BLACK_LAMB_CHANCE = 0.12; // くろいこひつじ(低確率)
const FESTIVAL_LENGTH = 55; // おまつりの長さ(秒)
const ANIMAL_FESTIVAL_CHANCE = 0.2; // まれに動物もおまつりに参加する
const TRAVELER_FESTIVAL_CHANCE = 0.5; // 旅人はそこそこの確率で祭りに混ざる

const MOVE_DURATION = {
  villager: 0.55, sheep: 0.7, chicken: 0.45, traveler: 0.5, deer: 0.42, cat: 0.5,
};
const VISITOR_TYPES = new Set(['traveler', 'deer', 'cat']);

// キャラの体はパーツごとに固有のジオメトリ/マテリアルを持つので、
// シーンから外すときに必ず破棄する(常駐アプリでのGPUリーク防止)
function disposeMesh(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
}

// あいさつの吹き出し(絵文字をスプライトで頭上に出す)
const GREET_EMOJI = {
  villager: '💬',
  traveler: '💬',
  sheep: '💕',
  chicken: '🎵',
  deer: '🌿',
  cat: '…', // ねこはそっけない
};
const GREET_COOLDOWN = 90; // 同じ2人が続けてあいさつしない(秒)
const BUBBLE_LIFE = 1.9;

const bubbleTextures = new Map();
function bubbleMaterial(emoji) {
  if (!bubbleTextures.has(emoji)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 32, 36);
    bubbleTextures.set(emoji, new THREE.CanvasTexture(canvas));
  }
  return new THREE.SpriteMaterial({
    map: bubbleTextures.get(emoji),
    transparent: true,
    depthWrite: false,
  });
}

class Character {
  constructor(type, col, row, world, scaleBase, opts = {}) {
    this.type = type;
    this.col = col;
    this.row = row;
    this.baby = opts.baby || false;
    this.age = opts.age || 0;
    this.name = opts.name || type;
    this.job = opts.job || null;
    this.trait = opts.trait || TRAITS[3];
    this.variant = opts.variant || null;
    this.jitter = opts.jitter ?? 0.92 + Math.random() * 0.16; // 体格の個体差
    this.task = null; // 昼のしごと {kind, target}
    this.taskDone = false;
    this.jobCooldown = 15 + Math.random() * 60;
    this.targetSpot = null; // 夜・おまつりに向かう場所
    this.mesh = MAKERS[type](this);
    this.mesh.scale.setScalar(scaleBase * (this.baby ? BABY_SCALE : 1) * this.jitter);
    this.state = 'idle';
    this.idleTimer = Math.random() * 2;
    this.phase = Math.random() * Math.PI * 2;
    this.progress = 0;
    this.workDuration = 3;
    this.from = null;
    this.to = null;
    // 訪問者は決まった歩数だけ歩いて去っていく
    this.stepsRemaining = VISITOR_TYPES.has(type)
      ? (type === 'cat' ? 40 : 25) + Math.floor(Math.random() * 20)
      : Infinity;
    this.done = false;
    const p = world.positionOf(col, row);
    this.mesh.position.set(p.x, world.topSurfaceY(col, row), p.z);
    this.mesh.rotation.y = Math.random() * Math.PI * 2;
  }

  // ctx: { speed, isNight, festival }
  update(dt, time, world, ctx) {
    const speed = ctx.speed * this.trait.speed;

    if (this.state === 'sleeping') {
      if (!ctx.isNight) {
        this.state = 'idle';
        this.idleTimer = (0.5 + Math.random() * 2) * this.trait.idle;
        return;
      }
      const targetY = world.topSurfaceY(this.col, this.row);
      this.mesh.position.y += (targetY - this.mesh.position.y) * Math.min(1, dt * 10);
      this.mesh.position.y += Math.sin(time * 1.2 + this.phase) * 0.01; // 寝息
      return;
    }

    if (this.state === 'greeting') {
      // 向き合ってぴょこぴょこ
      this.progress += (dt * speed) / 1.6;
      const ground = world.topSurfaceY(this.col, this.row);
      this.mesh.position.y = ground + Math.abs(Math.sin(Math.min(1, this.progress) * Math.PI * 2)) * 0.1;
      if (this.progress >= 1) {
        this.state = 'idle';
        this.idleTimer = (0.8 + Math.random()) * this.trait.idle;
      }
      return;
    }

    if (this.state === 'dancing') {
      if (!ctx.festival || !ctx.isNight) {
        this.state = ctx.isNight ? 'sleeping' : 'idle';
        return;
      }
      const ground = world.topSurfaceY(this.col, this.row);
      this.mesh.position.y = ground + Math.abs(Math.sin(time * 5 + this.phase)) * 0.14;
      this.mesh.rotation.y += dt * 2.5;
      return;
    }

    if (this.state === 'working') {
      this.progress += (dt * speed) / this.workDuration;
      this.mesh.rotation.z = Math.sin(this.progress * Math.PI * 6) * 0.22; // こつこつ
      if (this.progress >= 1) {
        this.mesh.rotation.z = 0;
        this.state = 'idle';
        this.idleTimer = 1;
        this.taskDone = true;
      }
      return;
    }

    if (this.state === 'fishing') {
      this.progress += (dt * speed) / this.workDuration;
      this.mesh.rotation.x = 0.15 + Math.sin(time * 1.5 + this.phase) * 0.03; // じっと待つ
      if (this.progress >= 1) {
        this.mesh.rotation.x = 0;
        this.state = 'idle';
        this.idleTimer = 1;
        this.taskDone = true;
      }
      return;
    }

    if (this.state === 'idle') {
      this.idleTimer -= dt * speed;
      const targetY = world.topSurfaceY(this.col, this.row);
      this.mesh.position.y += (targetY - this.mesh.position.y) * Math.min(1, dt * 10);
      this.mesh.position.y += Math.sin(time * 3 + this.phase) * 0.006;
      if (this.idleTimer <= 0) {
        if (ctx.isNight && !VISITOR_TYPES.has(this.type)) {
          this.nightMove(world, ctx);
        } else if (this.task) {
          this.taskMove(world);
        } else {
          this.startWalk(world);
        }
      }
      return;
    }

    if (this.state === 'eating') {
      this.progress += (dt * speed) / 1.4;
      this.mesh.rotation.x = Math.sin(Math.min(1, this.progress) * Math.PI) * 0.35;
      if (this.progress >= 1) {
        this.mesh.rotation.x = 0;
        world.replaceTop(this.col, this.row, 'dirt');
        this.state = 'idle';
        this.idleTimer = (1 + Math.random() * 2) * this.trait.idle;
      }
      return;
    }

    // walking
    this.progress += (dt * speed) / MOVE_DURATION[this.type];
    const t = Math.min(1, this.progress);
    const ease = t * t * (3 - 2 * t);
    this.mesh.position.x = this.from.x + (this.to.x - this.from.x) * ease;
    this.mesh.position.z = this.from.z + (this.to.z - this.from.z) * ease;
    this.mesh.position.y =
      this.from.y + (this.to.y - this.from.y) * ease + Math.sin(t * Math.PI) * 0.16;
    if (t >= 1) {
      this.state = 'idle';
      this.stepsRemaining--;
      if (this.stepsRemaining <= 0) this.done = true;
      this.idleTimer = VISITOR_TYPES.has(this.type)
        ? 0.2 + Math.random() * 0.6
        : (0.6 + Math.random() * 3) * this.trait.idle;
    }
  }

  // 夜: おまつりなら火のまわりへ、ふだんは家へ。動物はその場で眠る
  nightMove(world, ctx) {
    if (ctx.festival && this.targetSpot) {
      const [tc, tr] = this.targetSpot;
      if (world.distance(this.col, this.row, tc, tr) <= 1) {
        this.state = 'dancing';
      } else {
        this.startWalk(world, this.targetSpot);
      }
      return;
    }
    if (this.type !== 'villager' || !this.targetSpot) {
      this.state = 'sleeping';
      return;
    }
    const [tc, tr] = this.targetSpot;
    if (world.distance(this.col, this.row, tc, tr) <= 1) {
      this.state = 'sleeping';
      return;
    }
    this.startWalk(world, this.targetSpot);
  }

  // 昼のしごと: 現場に着いたら作業をはじめる
  taskMove(world) {
    const [tc, tr] = this.task.target;
    if (world.distance(this.col, this.row, tc, tr) <= 1) {
      if (this.task.kind === 'fish') {
        this.state = 'fishing';
        this.workDuration = 12 + Math.random() * 8;
      } else {
        this.state = 'working';
        this.workDuration = this.task.kind === 'chop' ? 3.5 : 2.2;
      }
      this.progress = 0;
      // 現場のほうを向く
      const p = world.positionOf(tc, tr);
      this.mesh.rotation.y = Math.atan2(p.x - this.mesh.position.x, p.z - this.mesh.position.z);
      return;
    }
    this.startWalk(world, this.task.target);
  }

  startWalk(world, target = null) {
    // ひつじは足元の草をたまに食べる
    if (this.type === 'sheep' && world.topType(this.col, this.row) === 'grass' && Math.random() < 0.2) {
      this.state = 'eating';
      this.progress = 0;
      return;
    }
    const currentHeight = world.heightAt(this.col, this.row);
    const options = world.neighbors(this.col, this.row).filter(([c, r]) => {
      if (!world.isWalkable(c, r)) return false;
      return Math.abs(world.heightAt(c, r) - currentHeight) <= 1;
    });
    if (options.length === 0) {
      this.idleTimer = 1 + Math.random();
      return;
    }
    let choice;
    if (target) {
      // 目的地に近づくマスを選ぶ(たまに寄り道して詰まりを避ける)
      options.sort(
        (a, b) =>
          world.distance(a[0], a[1], target[0], target[1]) -
          world.distance(b[0], b[1], target[0], target[1])
      );
      choice = Math.random() < 0.8 ? options[0] : options[Math.floor(Math.random() * options.length)];
    } else {
      choice = options[Math.floor(Math.random() * options.length)];
    }
    const [col, row] = choice;
    const from = world.positionOf(this.col, this.row);
    const to = world.positionOf(col, row);
    this.from = { x: from.x, y: this.mesh.position.y, z: from.z };
    this.to = { x: to.x, y: world.topSurfaceY(col, row), z: to.z };
    this.col = col;
    this.row = row;
    this.progress = 0;
    this.state = 'walking';
    this.mesh.rotation.y = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
  }
}

export class CharacterManager {
  constructor(scene, world, settings) {
    this.scene = scene;
    this.world = world;
    this.settings = settings;
    this.characters = [];
    this.eggs = [];
    this.isNight = false;
    this.onEvent = null;
    this.calendar = null; // main で注入(季節・日数)
    this.jobQueue = []; // きこりの伐採・植樹などを1ブロックずつ反映
    this.jobStepTimer = 0;
    this.festivalActive = false;
    this.festivalT = 0;
    this.eggGeo = new THREE.SphereGeometry(0.06, 8, 6);
    this.eggMat = new THREE.MeshStandardMaterial({ color: 0xfaf3e0, roughness: 0.6 });
    this.bubbles = []; // あいさつの吹き出し
    this.greetTimer = 0;
    this.pairCooldowns = new Map(); // "名前|名前" → 最後にあいさつした時刻
  }

  setWorld(world) {
    this.world = world;
    for (const c of this.characters) {
      this.scene.remove(c.mesh);
      disposeMesh(c.mesh);
    }
    for (const egg of this.eggs) this.scene.remove(egg.mesh); // 卵は共有ジオメトリなので破棄しない
    for (const bubble of this.bubbles) {
      this.scene.remove(bubble.sprite);
      bubble.sprite.material.dispose();
    }
    this.characters = [];
    this.eggs = [];
    this.bubbles = [];
    this.jobQueue = [];
    this.pairCooldowns.clear(); // 消えたキャラのあいさつ履歴を残さない
    this.festivalActive = false;
  }

  // 池の氷がとけた春などに、歩けないマスに取り残されたキャラを助ける
  rescueStranded() {
    const walkable = this.world.columnsWhere((c, r) => this.world.isWalkable(c, r));
    if (walkable.length === 0) return;
    for (const c of this.characters) {
      if (this.world.isWalkable(c.col, c.row)) continue;
      walkable.sort(
        (a, b) =>
          this.world.distance(c.col, c.row, a[0], a[1]) -
          this.world.distance(c.col, c.row, b[0], b[1])
      );
      [c.col, c.row] = walkable[0];
      const p = this.world.positionOf(c.col, c.row);
      c.mesh.position.set(p.x, this.world.topSurfaceY(c.col, c.row), p.z);
      c.state = 'idle';
      c.idleTimer = 1 + Math.random();
    }
  }

  scaleOf(character) {
    return this.settings.characterScale * (character.baby ? BABY_SCALE : 1) * character.jitter;
  }

  pickName(type) {
    const pool = NAMES[type] || NAMES.villager;
    const used = new Set(this.characters.map((c) => c.name));
    const free = pool.filter((n) => !used.has(n));
    if (free.length > 0) return free[Math.floor(Math.random() * free.length)];
    return pool[Math.floor(Math.random() * pool.length)] + '二世';
  }

  // いちばん人数の少ないしごとに就く
  pickJob() {
    const counts = new Map(JOBS.map((j) => [j, 0]));
    for (const c of this.characters) {
      if (c.type === 'villager' && c.job) counts.set(c.job, (counts.get(c.job) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
  }

  spawn(type) {
    if (this.characters.length >= MAX_CHARACTERS) return false;
    const spots = shuffle(this.world.columnsWhere((c, r) => this.world.isWalkable(c, r)));
    if (spots.length === 0) return false;
    const [col, row] = spots[0];
    return this.spawnAt(type, col, row);
  }

  spawnAt(type, col, row, opts = {}) {
    if (this.characters.length >= MAX_CHARACTERS) return null;
    const filled = {
      ...opts,
      name: opts.name || this.pickName(type),
      job: opts.job || (type === 'villager' ? this.pickJob() : null),
      trait: opts.trait || TRAITS[Math.floor(Math.random() * TRAITS.length)],
    };
    const character = new Character(type, col, row, this.world, this.settings.characterScale, filled);
    this.characters.push(character);
    this.scene.add(character.mesh);
    return character;
  }

  applyScale() {
    for (const c of this.characters) c.mesh.scale.setScalar(this.scaleOf(c));
  }

  // マップの端から訪問者がやってくる
  spawnVisitor(type) {
    const edges = this.world.columnsWhere(
      (c, r) =>
        (c === 0 || r === 0 || c === this.world.cols - 1 || r === this.world.rows - 1) &&
        this.world.isWalkable(c, r)
    );
    if (edges.length === 0) return null;
    const [col, row] = edges[Math.floor(Math.random() * edges.length)];
    return this.spawnAt(type, col, row);
  }

  campfireColumns() {
    return this.world.topsOfType('campfire');
  }

  // 夜のはじまり: 3日にいちど、火があればおまつり。ふだんは家へ
  setNight(isNight) {
    if (isNight === this.isNight) return;
    this.isNight = isNight;
    if (!isNight) {
      for (const c of this.characters) c.targetSpot = null;
      this.festivalActive = false;
      return;
    }
    const fires = this.campfireColumns();
    const villagers = this.characters.filter((c) => c.type === 'villager');
    const festivalNight = this.calendar && this.calendar.day % 3 === 2;
    if (festivalNight && fires.length > 0 && villagers.length >= 2) {
      this.festivalActive = true;
      this.festivalT = FESTIVAL_LENGTH;
      // たいていはひとだけのおまつり。まれに動物もいっしょに踊りだす。
      // 通りすがりの旅人は、出くわしたらそこそこの確率で混ざる
      const animalsJoin = Math.random() < ANIMAL_FESTIVAL_CHANCE;
      const travelerJoins = Math.random() < TRAVELER_FESTIVAL_CHANCE;
      const joinsFestival = (c) => {
        if (c.type === 'villager') return true;
        if (c.type === 'traveler') return travelerJoins;
        if (VISITOR_TYPES.has(c.type)) return false; // しか・ねこは混ざらない
        return animalsJoin; // ひつじ・にわとり
      };
      for (const c of this.characters) {
        c.targetSpot = joinsFestival(c) ? fires[0] : null;
        c.task = null;
        if (c.state === 'working' || c.state === 'fishing') {
          c.state = 'idle';
          c.mesh.rotation.z = 0; // 作業中の傾きを戻す
          c.mesh.rotation.x = 0;
        }
      }
      if (this.onEvent) {
        this.onEvent(
          animalsJoin
            ? '🎉 たきびのまわりで どうぶつもいっしょに おまつり!'
            : '🎉 たきびのまわりで おまつりが はじまった!'
        );
      }
      return;
    }
    const spots = [...this.world.hutCenters(), ...fires];
    for (const c of this.characters) {
      if (c.type !== 'villager' || spots.length === 0) continue;
      c.targetSpot = spots.reduce((best, s) =>
        this.world.distance(c.col, c.row, s[0], s[1]) <
        this.world.distance(c.col, c.row, best[0], best[1])
          ? s
          : best
      );
    }
  }

  update(dt, time, isNight = false) {
    this.setNight(isNight);
    if (this.festivalActive) {
      this.festivalT -= dt;
      if (this.festivalT <= 0 || !isNight) this.festivalActive = false;
    }

    const ctx = { speed: this.settings.characterSpeed, isNight, festival: this.festivalActive };
    for (const c of this.characters) c.update(dt, time, this.world, ctx);

    this.updateGrowth(dt);
    this.updateEggs(dt);
    this.updateBirths(dt);
    this.updateJobs(dt, isNight);
    this.updateCrops(dt);
    this.updateGreetings(dt, time, isNight);

    // 歩ききった訪問者は去る。旅人は家に空きがあれば村にすみつく
    const leaving = this.characters.filter((c) => c.done);
    if (leaving.length > 0) {
      this.characters = this.characters.filter((c) => !c.done);
      const capacity = this.world.hutCenters().length * 2;
      for (const c of leaving) {
        this.scene.remove(c.mesh);
        disposeMesh(c.mesh);
        // 去るキャラの頭上に出ていた吹き出しも片づける(宙に残さない)
        for (const bubble of this.bubbles.filter((b) => b.char === c)) {
          this.scene.remove(bubble.sprite);
          bubble.sprite.material.dispose();
        }
        this.bubbles = this.bubbles.filter((b) => b.char !== c);
        if (c.type === 'traveler') {
          const villagers = this.characters.filter((v) => v.type === 'villager').length;
          if (villagers < capacity && Math.random() < 0.6) {
            const settled = this.spawnAt('villager', c.col, c.row);
            if (settled && this.onEvent) {
              this.onEvent(`🏡 たびびとが「${settled.name}」として むらに すみついた`);
            }
            continue;
          }
        }
        if (this.onEvent) {
          const farewell = {
            traveler: '🚶 たびびとは さっていった',
            deer: '🦌 しかは もりへ かえっていった',
            cat: '🐈 ねこは きまぐれに さっていった',
          }[c.type];
          if (farewell) this.onEvent(farewell);
        }
      }
    }
  }

  updateGrowth(dt) {
    for (const c of this.characters) {
      if (!c.baby) continue;
      c.age += dt;
      if (c.age >= GROW_TIME) {
        c.baby = false;
        c.mesh.scale.setScalar(this.scaleOf(c));
      }
    }
  }

  // にわとりはたまに卵を産み、しばらくするとひよこがかえる
  updateEggs(dt) {
    const chickens = this.characters.filter((c) => c.type === 'chicken' && !c.baby);
    if (
      this.eggs.length < 2 &&
      this.characters.length < MAX_CHARACTERS &&
      Math.random() < chickens.length * EGG_RATE * dt
    ) {
      const hen = chickens[Math.floor(Math.random() * chickens.length)];
      const mesh = new THREE.Mesh(this.eggGeo, this.eggMat);
      mesh.scale.y = 1.3;
      const p = this.world.positionOf(hen.col, hen.row);
      mesh.position.set(p.x + 0.1, this.world.topSurfaceY(hen.col, hen.row) + 0.06, p.z);
      this.scene.add(mesh);
      this.eggs.push({
        col: hen.col,
        row: hen.row,
        mesh,
        t: EGG_HATCH_TIME[0] + Math.random() * (EGG_HATCH_TIME[1] - EGG_HATCH_TIME[0]),
      });
    }
    for (const egg of [...this.eggs]) {
      egg.mesh.position.y = this.world.topSurfaceY(egg.col, egg.row) + 0.06;
      egg.t -= dt;
      if (egg.t > 0) continue;
      if (this.characters.length >= MAX_CHARACTERS) {
        egg.t = 30; // 満員なら少し待つ
        continue;
      }
      this.scene.remove(egg.mesh);
      this.eggs = this.eggs.filter((e) => e !== egg);
      // 産んだ後にそのマスが水没・削除されていたら、近くの歩けるマスでかえす
      let [hc, hr] = [egg.col, egg.row];
      if (!this.world.isWalkable(hc, hr)) {
        const near = this.world
          .columnsWhere((c, r) => this.world.isWalkable(c, r))
          .sort(
            (a, b) =>
              this.world.distance(hc, hr, a[0], a[1]) - this.world.distance(hc, hr, b[0], b[1])
          )[0];
        if (!near) continue; // 歩けるマスが無ければ、かえさず消す
        [hc, hr] = near;
      }
      const chick = this.spawnAt('chicken', hc, hr, { baby: true });
      if (chick && this.onEvent) this.onEvent(`🐣 ひよこの「${chick.name}」が かえった`);
    }
  }

  // ひつじが2頭以上いると、たまにこひつじがうまれる
  updateBirths(dt) {
    const sheep = this.characters.filter((c) => c.type === 'sheep' && !c.baby);
    if (sheep.length < 2 || this.characters.length >= MAX_CHARACTERS) return;
    if (Math.random() >= LAMB_RATE * dt) return;
    const parent = sheep[Math.floor(Math.random() * sheep.length)];
    const variant = Math.random() < BLACK_LAMB_CHANCE ? 'black' : null;
    const lamb = this.spawnAt('sheep', parent.col, parent.row, { baby: true, variant });
    if (!lamb || !this.onEvent) return;
    this.onEvent(
      variant === 'black'
        ? `🐑 めずらしい くろい こひつじ、「${lamb.name}」が うまれた!`
        : `🐑 こひつじの「${lamb.name}」が うまれた`
    );
  }

  // ---- あいさつ ----
  // 近くにいるキャラ同士が、たまに向き合ってあいさつする
  updateGreetings(dt, time, isNight) {
    // 吹き出しの追従とフェード
    for (const bubble of [...this.bubbles]) {
      bubble.t += dt;
      if (bubble.t >= BUBBLE_LIFE) {
        this.scene.remove(bubble.sprite);
        bubble.sprite.material.dispose(); // テクスチャは共有キャッシュなので残す
        this.bubbles = this.bubbles.filter((b) => b !== bubble);
        continue;
      }
      const char = bubble.char;
      const pop = Math.min(1, bubble.t * 6);
      bubble.sprite.scale.setScalar(0.34 * pop);
      bubble.sprite.material.opacity = bubble.t > 1.4 ? (BUBBLE_LIFE - bubble.t) / 0.5 : 1;
      bubble.sprite.position.set(
        char.mesh.position.x,
        char.mesh.position.y + 0.62 * char.mesh.scale.y + 0.15,
        char.mesh.position.z
      );
    }

    if (isNight || this.festivalActive) return;
    this.greetTimer -= dt;
    if (this.greetTimer > 0) return;
    this.greetTimer = 1.2;

    const idle = this.characters.filter((c) => c.state === 'idle');
    for (let i = 0; i < idle.length; i++) {
      for (let j = i + 1; j < idle.length; j++) {
        const a = idle[i];
        const b = idle[j];
        if (this.world.distance(a.col, a.row, b.col, b.row) > 1) continue;
        const key = [a.name + a.type, b.name + b.type].sort().join('|');
        const last = this.pairCooldowns.get(key) ?? -Infinity;
        if (time - last < GREET_COOLDOWN) continue;
        if (Math.random() < 0.5) continue; // 毎回はしない
        this.pairCooldowns.set(key, time);
        this.startGreeting(a, b);
        return; // 1スキャンで1組だけ
      }
    }
  }

  startGreeting(a, b) {
    for (const [me, other] of [[a, b], [b, a]]) {
      const p = this.world.positionOf(other.col, other.row);
      me.mesh.rotation.y = Math.atan2(p.x - me.mesh.position.x, p.z - me.mesh.position.z);
      if (me.type === 'cat') continue; // ねこは振り向くだけ
      me.state = 'greeting';
      me.progress = 0;
    }
    this.addBubble(a, GREET_EMOJI[a.type]);
    if (Math.random() < 0.6) this.addBubble(b, GREET_EMOJI[b.type]);
  }

  addBubble(char, emoji) {
    const sprite = new THREE.Sprite(bubbleMaterial(emoji));
    sprite.scale.setScalar(0.01);
    this.scene.add(sprite);
    this.bubbles.push({ sprite, char, t: 0 });
  }

  // ---- 昼のしごと ----
  updateJobs(dt, isNight) {
    // 伐採・植樹キューを1ブロックずつ反映
    this.jobStepTimer += dt;
    if (this.jobQueue.length > 0 && this.jobStepTimer >= 0.28) {
      this.jobStepTimer = 0;
      const b = this.jobQueue.shift();
      // 伐採で消す予定のマスは、まだ元のブロックが残っているときだけ消す
      // (作業中にユーザーが置き換えたものを巻き込まない)
      if (b.expect === undefined || this.world.stackAt(b.col, b.row)[b.y] === b.expect) {
        this.world.setBlock(b.col, b.row, b.y, b.type);
      }
    }

    for (const c of this.characters) {
      if (c.type !== 'villager') continue;
      if (c.taskDone) {
        this.applyTaskEffect(c);
        c.taskDone = false;
        c.task = null;
      }
      c.jobCooldown -= dt;
      if (
        !isNight &&
        !this.festivalActive &&
        !c.task &&
        c.state === 'idle' &&
        c.jobCooldown <= 0
      ) {
        this.assignTask(c);
      }
    }
  }

  assignTask(c) {
    if (c.job === 'きこり') {
      if (this.jobQueue.length > 0) return;
      const trunks = this.world.columnsWhere((tc, tr) => isTreeColumn(this.world, tc, tr));
      if (trunks.length < 5) {
        c.jobCooldown = 60;
        return;
      }
      trunks.sort(
        (a, b) =>
          this.world.distance(c.col, c.row, a[0], a[1]) -
          this.world.distance(c.col, c.row, b[0], b[1])
      );
      c.task = { kind: 'chop', target: trunks[0] };
      return;
    }
    if (c.job === 'のうふ') {
      const ripe = [...this.world.crops.entries()].filter(([, v]) => v.stage === 2);
      if (ripe.length > 0) {
        const [key] = ripe[Math.floor(Math.random() * ripe.length)];
        c.task = { kind: 'harvest', target: key.split(',').map(Number) };
        return;
      }
      const empty = this.world.columnsWhere(
        (tc, tr) =>
          this.world.topType(tc, tr) === 'farm' && !this.world.crops.has(`${tc},${tr}`)
      );
      if (empty.length > 0) {
        c.task = { kind: 'plantCrop', target: empty[Math.floor(Math.random() * empty.length)] };
        return;
      }
      // はたけが足りなければ、家のそばの草地をたがやす
      const farms = this.world.topsOfType('farm');
      if (farms.length < 4) {
        const huts = this.world.hutCenters();
        const spots = shuffle(
          this.world.columnsWhere(
            (tc, tr) =>
              this.world.topType(tc, tr) === 'grass' &&
              huts.some(([hc, hr]) => this.world.distance(tc, tr, hc, hr) <= 2)
          )
        );
        if (spots.length > 0) {
          c.task = { kind: 'plantFarm', target: spots[0] };
          return;
        }
      }
      c.jobCooldown = 30;
      return;
    }
    if (c.job === 'つりびと') {
      const spots = shuffle(
        this.world.columnsWhere(
          (tc, tr) =>
            this.world.isWalkable(tc, tr) &&
            this.world
              .neighbors(tc, tr)
              .some(([nc, nr]) => this.world.topType(nc, nr) === 'water')
        )
      );
      if (spots.length === 0) {
        c.jobCooldown = 90;
        return;
      }
      c.task = { kind: 'fish', target: spots[0] };
      return;
    }
    c.jobCooldown = 120; // むらびとはのんびり
  }

  applyTaskEffect(c) {
    const task = c.task;
    if (!task) return;
    const [tc, tr] = task.target;

    if (task.kind === 'chop') {
      if (!isTreeColumn(this.world, tc, tr)) return; // もう誰かが片づけた
      // 元の種類を expect に残し、ユーザーが触っていないブロックだけ消す
      this.jobQueue.push(
        ...treeRemovalPlan(this.world, tc, tr).map((b) => ({
          col: b.col,
          row: b.row,
          y: b.y,
          type: null,
          expect: b.type,
        }))
      );
      // 近くの草地に苗を植える
      const spots = shuffle(
        this.world.columnsWhere(
          (sc, sr) =>
            this.world.topType(sc, sr) === 'grass' &&
            this.world.distance(sc, sr, tc, tr) <= 3 &&
            this.world
              .neighbors(sc, sr)
              .every(([nc, nr]) => !this.world.stackAt(nc, nr).includes('wood'))
        )
      );
      for (const [sc, sr] of spots) {
        const plan = treePlan(this.world, sc, sr);
        if (plan) {
          this.jobQueue.push(...plan);
          break;
        }
      }
      c.jobCooldown = 150 + Math.random() * 150;
      if (this.onEvent) this.onEvent(`🪓 ${c.name}が きをきって、あたらしい なえを うえた`);
      return;
    }
    if (task.kind === 'plantFarm') {
      if (this.world.topType(tc, tr) === 'grass') {
        this.world.replaceTop(tc, tr, 'farm');
        if (this.onEvent) this.onEvent(`🧑‍🌾 ${c.name}が はたけを たがやした`);
      }
      c.jobCooldown = 40 + Math.random() * 40;
      return;
    }
    if (task.kind === 'plantCrop') {
      this.world.plantCrop(tc, tr);
      c.jobCooldown = 40 + Math.random() * 40;
      return;
    }
    if (task.kind === 'harvest') {
      if (this.world.removeCrop(tc, tr) && this.onEvent) {
        this.onEvent(`🌾 ${c.name}が こむぎを しゅうかくした`);
      }
      c.jobCooldown = 40 + Math.random() * 40;
      return;
    }
    if (task.kind === 'fish') {
      const roll = Math.random();
      if (roll < 0.03 && this.onEvent) {
        this.onEvent(`✨ ${c.name}が きんいろの さかなを つりあげた!!`);
      } else if (roll < 0.38 && this.onEvent) {
        this.onEvent(`🐟 ${c.name}が さかなを つりあげた`);
      }
      c.jobCooldown = 70 + Math.random() * 80;
    }
  }

  // 作物は季節のはやさで育つ(冬は育たない)
  updateCrops(dt) {
    const season = this.calendar ? this.calendar.season.key : 'spring';
    const mult = { spring: 1.2, summer: 1.5, autumn: 0.8, winter: 0 }[season];
    if (mult === 0) return;
    for (const crop of this.world.crops.values()) {
      crop.t += dt * mult;
      const stage = crop.t > 140 ? 2 : crop.t > 60 ? 1 : 0;
      if (stage !== crop.stage) {
        crop.stage = stage;
        this.world.version++;
      }
    }
  }

  // 設定パネルの「なかま」一覧
  roster() {
    const emoji = { villager: '🧑', sheep: '🐑', chicken: '🐔', traveler: '🚶', deer: '🦌', cat: '🐈' };
    return this.characters.map((c) => {
      const tags = [];
      if (c.baby) tags.push('こども');
      if (c.variant === 'black') tags.push('くろ');
      if (c.job) tags.push(c.job);
      tags.push(c.trait.label);
      return `${emoji[c.type] || '❓'} ${c.name}(${tags.join('・')})`;
    });
  }

  serialize() {
    // 訪問者は保存しない(通りすがりなので)
    return this.characters
      .filter((c) => !VISITOR_TYPES.has(c.type))
      .map((c) => ({
        type: c.type,
        col: c.col,
        row: c.row,
        baby: c.baby,
        age: Math.round(c.age),
        name: c.name,
        job: c.job,
        trait: c.trait.label,
        variant: c.variant,
      }));
  }

  deserialize(list) {
    for (const item of list || []) {
      if (MAKERS[item.type] && this.world.inBounds(item.col, item.row)) {
        this.spawnAt(item.type, item.col, item.row, {
          baby: Boolean(item.baby),
          age: item.age || 0,
          name: item.name,
          job: item.job,
          trait: TRAITS.find((t) => t.label === item.trait),
          variant: item.variant || null,
        });
      }
    }
  }
}
