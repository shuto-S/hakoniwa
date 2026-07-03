import * as THREE from 'three';
import { MAX_CHARACTERS } from './config.js';
import { shuffle } from './terrain.js';

const SHIRT_COLORS = [0xe6704b, 0x4b8fe6, 0x53b86a, 0xd9a441, 0x9a6fd0];

function part(geometry, color, x, y, z) {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true })
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

// モデルはすべて +Z が正面
function makeVillagerMesh() {
  const group = new THREE.Group();
  const shirt = SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)];
  group.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), 0x5a4632, -0.05, 0.05, 0));
  group.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), 0x5a4632, 0.05, 0.05, 0));
  group.add(part(new THREE.CylinderGeometry(0.1, 0.12, 0.22, 6), shirt, 0, 0.21, 0));
  group.add(part(new THREE.SphereGeometry(0.1, 8, 6), 0xf0c8a0, 0, 0.42, 0));
  group.add(part(new THREE.ConeGeometry(0.11, 0.12, 6), shirt, 0, 0.53, 0));
  return group;
}

function makeSheepMesh() {
  const group = new THREE.Group();
  for (const [x, z] of [[-0.08, -0.07], [0.08, -0.07], [-0.08, 0.07], [0.08, 0.07]]) {
    group.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 5), 0x4a4040, x, 0.05, z));
  }
  const body = part(new THREE.SphereGeometry(0.15, 8, 6), 0xf2efe6, 0, 0.2, 0);
  body.scale.set(1, 0.85, 1.25);
  group.add(body);
  group.add(part(new THREE.BoxGeometry(0.11, 0.11, 0.1), 0x4a4040, 0, 0.24, 0.19));
  group.add(part(new THREE.SphereGeometry(0.07, 6, 5), 0xf2efe6, 0, 0.31, 0.13));
  return group;
}

function makeChickenMesh() {
  const group = new THREE.Group();
  const body = part(new THREE.SphereGeometry(0.1, 8, 6), 0xfaf7ef, 0, 0.12, 0);
  body.scale.set(0.9, 1, 1.15);
  group.add(body);
  group.add(part(new THREE.SphereGeometry(0.06, 6, 5), 0xfaf7ef, 0, 0.24, 0.06));
  group.add(part(new THREE.ConeGeometry(0.025, 0.06, 4), 0xe8a33d, 0, 0.24, 0.14).rotateX(Math.PI / 2));
  group.add(part(new THREE.BoxGeometry(0.02, 0.05, 0.04), 0xd8453c, 0, 0.31, 0.05));
  return group;
}

// 旅人: マップを通り過ぎていく、蓑と笠のひと
function makeTravelerMesh() {
  const group = new THREE.Group();
  group.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), 0x4a3f30, -0.05, 0.05, 0));
  group.add(part(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), 0x4a3f30, 0.05, 0.05, 0));
  group.add(part(new THREE.CylinderGeometry(0.09, 0.14, 0.24, 6), 0x8a7f6a, 0, 0.22, 0));
  group.add(part(new THREE.SphereGeometry(0.09, 8, 6), 0xe8bd93, 0, 0.42, 0));
  group.add(part(new THREE.ConeGeometry(0.17, 0.09, 8), 0xb09a5f, 0, 0.51, 0));
  group.add(part(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), 0x6a5236, 0.14, 0.25, 0.03));
  return group;
}

const MAKERS = {
  villager: makeVillagerMesh,
  sheep: makeSheepMesh,
  chicken: makeChickenMesh,
  traveler: makeTravelerMesh,
};

const MOVE_DURATION = { villager: 0.55, sheep: 0.7, chicken: 0.45, traveler: 0.5 };

const BABY_SCALE = 0.55;
const GROW_TIME = 240; // 子どもがおとなになるまで(秒)
const EGG_HATCH_TIME = [90, 180]; // 卵がかえるまで
const EGG_RATE = 1 / 240; // にわとり1羽あたり毎秒の産卵確率
const LAMB_RATE = 1 / 300; // ひつじが2頭以上いるときの毎秒の出産確率

class Character {
  constructor(type, col, row, world, scale, baby = false) {
    this.type = type;
    this.col = col;
    this.row = row;
    this.baby = baby;
    this.age = 0;
    this.targetSpot = null; // 夜に向かう家やたきび
    this.mesh = MAKERS[type]();
    this.mesh.scale.setScalar(scale * (baby ? BABY_SCALE : 1));
    this.state = 'idle';
    this.idleTimer = Math.random() * 2;
    this.phase = Math.random() * Math.PI * 2;
    this.progress = 0;
    this.from = null;
    this.to = null;
    // 旅人は決まった歩数だけ歩いて去っていく
    this.stepsRemaining = type === 'traveler' ? 25 + Math.floor(Math.random() * 20) : Infinity;
    this.done = false;
    const p = world.positionOf(col, row);
    this.mesh.position.set(p.x, world.topSurfaceY(col, row), p.z);
    this.mesh.rotation.y = Math.random() * Math.PI * 2;
  }

  update(dt, time, world, speed, isNight) {
    if (this.state === 'sleeping') {
      // 朝になったら起きる
      if (!isNight) {
        this.state = 'idle';
        this.idleTimer = 0.5 + Math.random() * 2;
        return;
      }
      const targetY = world.topSurfaceY(this.col, this.row);
      this.mesh.position.y += (targetY - this.mesh.position.y) * Math.min(1, dt * 10);
      this.mesh.position.y += Math.sin(time * 1.2 + this.phase) * 0.01; // 寝息
      return;
    }
    if (this.state === 'idle') {
      this.idleTimer -= dt * speed;
      // 足元の高さが変わったら追従する
      const targetY = world.topSurfaceY(this.col, this.row);
      this.mesh.position.y += (targetY - this.mesh.position.y) * Math.min(1, dt * 10);
      this.mesh.position.y += Math.sin(time * 3 + this.phase) * 0.006;
      if (this.idleTimer <= 0) {
        if (isNight && this.type !== 'traveler') {
          this.nightMove(world);
        } else {
          this.startWalk(world);
        }
      }
    } else if (this.state === 'eating') {
      // 頭を下げてもぐもぐ
      this.progress += (dt * speed) / 1.4;
      this.mesh.rotation.x = Math.sin(Math.min(1, this.progress) * Math.PI) * 0.35;
      if (this.progress >= 1) {
        this.mesh.rotation.x = 0;
        world.replaceTop(this.col, this.row, 'dirt');
        this.state = 'idle';
        this.idleTimer = 1 + Math.random() * 2;
      }
    } else {
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
        this.idleTimer =
          this.type === 'traveler' ? 0.2 + Math.random() * 0.6 : 0.6 + Math.random() * 3;
      }
    }
  }

  // 夜: ひとは家やたきびへ向かい、着いたら眠る。動物はその場で眠る
  nightMove(world) {
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
    this.eggGeo = new THREE.SphereGeometry(0.06, 8, 6);
    this.eggMat = new THREE.MeshStandardMaterial({ color: 0xfaf3e0, roughness: 0.6 });
  }

  setWorld(world) {
    this.world = world;
    for (const c of this.characters) this.scene.remove(c.mesh);
    for (const egg of this.eggs) this.scene.remove(egg.mesh);
    this.characters = [];
    this.eggs = [];
  }

  scaleOf(character) {
    return this.settings.characterScale * (character.baby ? BABY_SCALE : 1);
  }

  spawn(type) {
    if (this.characters.length >= MAX_CHARACTERS) return false;
    const spots = shuffle(
      [...this.world.columns()].filter(([c, r]) => this.world.isWalkable(c, r))
    );
    if (spots.length === 0) return false;
    const [col, row] = spots[0];
    return this.spawnAt(type, col, row);
  }

  spawnAt(type, col, row, baby = false, age = 0) {
    if (this.characters.length >= MAX_CHARACTERS) return false;
    const character = new Character(type, col, row, this.world, this.settings.characterScale, baby);
    character.age = age;
    this.characters.push(character);
    this.scene.add(character.mesh);
    return true;
  }

  applyScale() {
    for (const c of this.characters) c.mesh.scale.setScalar(this.scaleOf(c));
  }

  // マップの端から旅人がやってくる
  spawnTraveler() {
    const edges = [...this.world.columns()].filter(
      ([c, r]) =>
        (c === 0 || r === 0 || c === this.world.cols - 1 || r === this.world.rows - 1) &&
        this.world.isWalkable(c, r)
    );
    if (edges.length === 0) return false;
    const [col, row] = edges[Math.floor(Math.random() * edges.length)];
    return this.spawnAt('traveler', col, row);
  }

  // 夜のはじまりに、ひとへ家やたきびを割り当てる
  setNight(isNight) {
    if (isNight === this.isNight) return;
    this.isNight = isNight;
    if (isNight) {
      const spots = [
        ...this.world.hutCenters(),
        ...[...this.world.columns()].filter(([c, r]) => this.world.topType(c, r) === 'campfire'),
      ];
      for (const c of this.characters) {
        if (c.type !== 'villager' || spots.length === 0) continue;
        c.targetSpot = spots.reduce((best, s) =>
          this.world.distance(c.col, c.row, s[0], s[1]) <
          this.world.distance(c.col, c.row, best[0], best[1])
            ? s
            : best
        );
      }
    } else {
      for (const c of this.characters) c.targetSpot = null;
    }
  }

  update(dt, time, isNight = false) {
    this.setNight(isNight);
    for (const c of this.characters) {
      c.update(dt, time, this.world, this.settings.characterSpeed, isNight);
    }
    this.updateGrowth(dt);
    this.updateEggs(dt);
    this.updateBirths(dt);

    // 歩ききった旅人は、去るか、家に空きがあれば村にすみつく
    const leaving = this.characters.filter((c) => c.done);
    if (leaving.length > 0) {
      this.characters = this.characters.filter((c) => !c.done);
      const capacity = this.world.hutCenters().length * 2;
      for (const c of leaving) {
        this.scene.remove(c.mesh);
        const villagers = this.characters.filter((v) => v.type === 'villager').length;
        if (villagers < capacity && Math.random() < 0.6) {
          this.spawnAt('villager', c.col, c.row);
          if (this.onEvent) this.onEvent('🏡 たびびとが むらに すみついた');
        } else if (this.onTravelerLeft) {
          this.onTravelerLeft();
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
      this.spawnAt('chicken', egg.col, egg.row, true);
      if (this.onEvent) this.onEvent('🐣 ひよこが かえった');
    }
  }

  // ひつじが2頭以上いると、たまにこひつじがうまれる
  updateBirths(dt) {
    const sheep = this.characters.filter((c) => c.type === 'sheep' && !c.baby);
    if (sheep.length < 2 || this.characters.length >= MAX_CHARACTERS) return;
    if (Math.random() >= LAMB_RATE * dt) return;
    const parent = sheep[Math.floor(Math.random() * sheep.length)];
    this.spawnAt('sheep', parent.col, parent.row, true);
    if (this.onEvent) this.onEvent('🐑 こひつじが うまれた');
  }

  serialize() {
    // 旅人は保存しない(通りすがりなので)
    return this.characters
      .filter((c) => c.type !== 'traveler')
      .map((c) => ({ type: c.type, col: c.col, row: c.row, baby: c.baby, age: Math.round(c.age) }));
  }

  deserialize(list) {
    for (const item of list || []) {
      if (MAKERS[item.type] && this.world.inBounds(item.col, item.row)) {
        this.spawnAt(item.type, item.col, item.row, Boolean(item.baby), item.age || 0);
      }
    }
  }
}
