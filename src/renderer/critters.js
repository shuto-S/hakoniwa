import * as THREE from 'three';
import { BLOCK_HEIGHT, HEX_RADIUS } from './config.js';

const BUTTERFLY_COLORS = [0xf2a0c0, 0xf2d54e, 0x9ad4f2, 0xd0a0f2];

function basicMesh(geometry, color, opts = {}) {
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...opts })
  );
}

// 眺めて楽しいだけの生き物たち: 鳥の群れ・蝶・池の魚・夜のほたら
export class CritterSystem {
  constructor(scene, world, weather, daynight, settings) {
    this.scene = scene;
    this.weather = weather;
    this.daynight = daynight;
    this.settings = settings;
    this.onEvent = null;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.setWorld(world);
  }

  setWorld(world) {
    this.world = world;
    const spanX = world.cols * HEX_RADIUS * Math.sqrt(3);
    const spanZ = world.rows * HEX_RADIUS * 1.5;
    this.span = Math.max(spanX, spanZ);
    this.skyY = world.maxHeight * BLOCK_HEIGHT + 1.6;

    this.group.clear();
    this.buildBirds();
    this.buildButterflies();
    this.buildFish();
    this.buildFireflies();
    this.buildFallingLeaves();
    this.buildDuck();
    this.buildShootingStar();
    this.buildWhale();
    this.showerT = 0; // 流星群の残り時間
  }

  // ---- そらクジラ(超低確率。空をゆっくり泳いでいく) ----
  buildWhale() {
    this.whale = new THREE.Group();
    const body = basicMesh(new THREE.SphereGeometry(0.5, 10, 8), 0x7f96bd);
    body.scale.set(1.7, 0.85, 0.9);
    this.whale.add(body);
    const belly = basicMesh(new THREE.SphereGeometry(0.42, 10, 8), 0xc2cfe2);
    belly.scale.set(1.6, 0.7, 0.8);
    belly.position.y = -0.16;
    this.whale.add(belly);
    const tail = basicMesh(new THREE.SphereGeometry(0.22, 6, 5), 0x7f96bd);
    tail.scale.set(1.1, 0.18, 0.9);
    tail.position.set(-0.95, 0.12, 0);
    this.whale.add(tail);
    for (const side of [-1, 1]) {
      const fin = basicMesh(new THREE.SphereGeometry(0.16, 6, 5), 0x7f96bd);
      fin.scale.set(1, 0.2, 0.6);
      fin.position.set(0.15, -0.2, side * 0.42);
      this.whale.add(fin);
    }
    this.whale.visible = false;
    this.group.add(this.whale);
    this.whaleFlight = null;
  }

  updateWhale(dt) {
    if (!this.whaleFlight) {
      const calm = this.weather.state === 'sunny' || this.weather.state === 'cloudy';
      if (!this.settings.skyShows || !calm) return;
      if (Math.random() >= dt / 9000) return; // だいたい2〜3時間にいちど
      this.whaleFlight = { t: 0 };
      this.whale.visible = true;
      this.whale.position.set(-this.span / 2 - 2.5, this.skyY + 2.2, -this.span * 0.15);
      if (this.onEvent) this.onEvent('🐋 そらクジラが ゆっくりと およいでいく…');
      return;
    }
    this.whaleFlight.t += dt / 30; // 30秒かけて横切る
    const t = this.whaleFlight.t;
    this.whale.position.x = -this.span / 2 - 2.5 + t * (this.span + 5);
    this.whale.position.y = this.skyY + 2.2 + Math.sin(this.time * 0.8) * 0.25;
    if (t >= 1) {
      this.whale.visible = false;
      this.whaleFlight = null;
    }
  }

  // ---- ながれぼし(晴れた夜、すっと流れる) ----
  buildShootingStar() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.55, 0.28, -0.1]), 3)
    );
    this.star = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      })
    );
    this.star.visible = false;
    this.star.frustumCulled = false;
    this.group.add(this.star);
    this.starTimer = 12 + Math.random() * 30;
    this.starFlight = null;
  }

  updateShootingStar(dt) {
    // 流星群(超低確率): しばらく星が続けて流れる
    if (this.showerT > 0) this.showerT -= dt;
    const active =
      this.settings.skyShows && this.daynight.isNight && this.weather.state === 'sunny';
    if (active && this.showerT <= 0 && Math.random() < dt / 2400) {
      this.showerT = 25;
      if (this.onEvent) this.onEvent('🌠 りゅうせいぐん!');
    }

    if (!this.starFlight) {
      if (!active) return;
      this.starTimer -= dt;
      if (this.starTimer > 0) return;
      this.starTimer = this.showerT > 0 ? 0.4 + Math.random() * 0.8 : 18 + Math.random() * 40;
      this.starFlight = { life: 0.8 };
      this.star.position.set(
        (Math.random() - 0.2) * this.span,
        this.skyY + 1.8 + Math.random(),
        (Math.random() - 0.5) * this.span * 0.6
      );
      this.star.visible = true;
      return;
    }
    this.starFlight.life -= dt;
    this.star.position.x -= 3.6 * dt;
    this.star.position.y -= 1.8 * dt;
    this.star.material.opacity = Math.sin(Math.max(0, this.starFlight.life / 0.8) * Math.PI) * 0.9;
    if (this.starFlight.life <= 0) {
      this.star.visible = false;
      this.starFlight = null;
    }
  }

  // ---- 鳥の群れ(ときどき空を横切る) ----
  buildBirds() {
    this.birdFlock = new THREE.Group();
    this.birds = [];
    for (let i = 0; i < 4; i++) {
      const bird = basicMesh(new THREE.ConeGeometry(0.06, 0.22, 4), 0x4a5568);
      bird.rotation.z = -Math.PI / 2; // +X 方向へ飛ぶ
      // V字隊列
      bird.position.set(-Math.abs(i - 1.5) * 0.35, (i % 2) * 0.1, (i - 1.5) * 0.3);
      this.birdFlock.add(bird);
      this.birds.push(bird);
    }
    this.birdFlock.visible = false;
    this.birdTimer = 8 + Math.random() * 20;
    this.group.add(this.birdFlock);
  }

  updateBirds(dt) {
    if (!this.birdFlock.visible) {
      this.birdTimer -= dt;
      if (this.birdTimer <= 0 && !this.daynight.isNight) {
        this.birdFlock.visible = true;
        this.birdFlock.position.set(
          -this.span / 2 - 1.5,
          this.skyY + Math.random() * 1.2,
          (Math.random() - 0.5) * this.span * 0.7
        );
      }
      return;
    }
    this.birdFlock.position.x += 2.2 * dt;
    this.birds.forEach((bird, i) => {
      bird.position.y = (i % 2) * 0.1 + Math.sin(this.time * 10 + i) * 0.05; // はばたき
    });
    if (this.birdFlock.position.x > this.span / 2 + 1.5) {
      this.birdFlock.visible = false;
      this.birdTimer = 20 + Math.random() * 45;
    }
  }

  // ---- 蝶(晴れた昼、花のまわりを舞う) ----
  buildButterflies() {
    this.butterflies = [];
    for (let i = 0; i < 5; i++) {
      const mesh = basicMesh(
        new THREE.OctahedronGeometry(0.05, 0),
        BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length]
      );
      mesh.scale.set(1.6, 0.5, 1);
      mesh.visible = false;
      this.butterflies.push({ mesh, anchor: null, retarget: 0, phase: Math.random() * 7 });
      this.group.add(mesh);
    }
  }

  updateButterflies(dt) {
    // 季節で数が変わる(夏がいちばん多く、冬はいない)
    const limits = { spring: 4, summer: 5, autumn: 2, winter: 0 };
    const limit = limits[this.daynight.season.key];
    const active = this.weather.state === 'sunny' && this.daynight.daylight > 0.3;
    for (const [i, b] of this.butterflies.entries()) {
      b.mesh.visible = active && i < limit;
      if (!b.mesh.visible) continue;
      b.retarget -= dt;
      if (!b.anchor || b.retarget <= 0) {
        b.anchor = this.pickButterflySpot();
        b.retarget = 10 + Math.random() * 12;
      }
      if (!b.anchor) {
        b.mesh.visible = false;
        continue;
      }
      const t = this.time + b.phase;
      b.mesh.position.set(
        b.anchor.x + Math.sin(t * 0.7) * 0.5,
        b.anchor.y + 0.35 + Math.sin(t * 2.3) * 0.15,
        b.anchor.z + Math.cos(t * 0.9) * 0.5
      );
      b.mesh.rotation.y = t * 0.8;
      b.mesh.scale.x = 1.6 * (0.6 + 0.4 * Math.abs(Math.sin(t * 12))); // 羽ばたき
    }
  }

  pickButterflySpot() {
    // 花があれば花のそば、なければ草の上
    const flowers = [...this.world.flowers];
    let col, row;
    if (flowers.length > 0) {
      [col, row] = flowers[Math.floor(Math.random() * flowers.length)].split(',').map(Number);
    } else {
      const grass = this.world.topsOfType('grass');
      if (grass.length === 0) return null;
      [col, row] = grass[Math.floor(Math.random() * grass.length)];
    }
    const p = this.world.positionOf(col, row);
    return { x: p.x, y: this.world.topSurfaceY(col, row), z: p.z };
  }

  // ---- 魚(池からぴょんと跳ねる) ----
  buildFish() {
    this.fish = basicMesh(new THREE.ConeGeometry(0.05, 0.18, 5), 0xe89a4a);
    this.fish.visible = false;
    this.group.add(this.fish);
    this.fishTimer = 5 + Math.random() * 8;
    this.fishJump = null;
  }

  updateFish(dt) {
    if (this.world.frozen) {
      // 凍った池では跳ねない
      this.fish.visible = false;
      this.fishJump = null;
      return;
    }
    if (!this.fishJump) {
      this.fishTimer -= dt;
      if (this.fishTimer > 0) return;
      const ponds = this.world.topsOfType('water');
      this.fishTimer = 6 + Math.random() * 10;
      if (ponds.length === 0) return;
      const [col, row] = ponds[Math.floor(Math.random() * ponds.length)];
      const p = this.world.positionOf(col, row);
      this.fishJump = { x: p.x, z: p.z, surfaceY: this.world.topSurfaceY(col, row), t: 0 };
      // 低確率で金色のさかな
      const golden = Math.random() < 0.05;
      this.fish.material.color.setHex(golden ? 0xf2c33d : 0xe89a4a);
      if (golden && this.onEvent) this.onEvent('✨ きんいろの さかなが はねた!');
      this.fish.visible = true;
      return;
    }
    this.fishJump.t += dt / 0.9;
    const t = this.fishJump.t;
    if (t >= 1) {
      this.fish.visible = false;
      this.fishJump = null;
      return;
    }
    this.fish.position.set(
      this.fishJump.x + t * 0.3,
      this.fishJump.surfaceY - 0.15 + Math.sin(t * Math.PI) * 0.6,
      this.fishJump.z
    );
    this.fish.rotation.z = Math.PI - t * Math.PI * 2; // 弧を描いて回る
  }

  // ---- ほたる(晴れた夜、ふわふわ光る) ----
  buildFireflies() {
    const count = 26;
    this.fireflyData = [];
    const land = this.world.columnsWhere((c, r) => this.world.isWalkable(c, r));
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const [col, row] = land[Math.floor(Math.random() * Math.max(1, land.length))] || [0, 0];
      const p = this.world.positionOf(col, row);
      this.fireflyData.push({
        x: p.x,
        y: this.world.topSurfaceY(col, row) + 0.4 + Math.random() * 0.9,
        z: p.z,
        phase: Math.random() * Math.PI * 2,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.fireflies = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xd8f27a,
        size: 3,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.fireflies.visible = false;
    this.fireflies.frustumCulled = false;
    this.group.add(this.fireflies);
  }

  updateFireflies(dt) {
    // 夏の夜がいちばん多く、冬はいない
    const strengths = { spring: 0.55, summer: 0.95, autumn: 0.55, winter: 0 };
    const active =
      this.daynight.isNight && (this.weather.state === 'sunny' || this.weather.state === 'cloudy');
    const target = active ? strengths[this.daynight.season.key] : 0;
    const material = this.fireflies.material;
    material.opacity += (target - material.opacity) * Math.min(1, dt * 2);
    this.fireflies.visible = material.opacity > 0.02;
    if (!this.fireflies.visible) return;

    const positions = this.fireflies.geometry.attributes.position.array;
    this.fireflyData.forEach((fly, i) => {
      const t = this.time * 0.5 + fly.phase;
      positions[i * 3] = fly.x + Math.sin(t * 1.3) * 0.4;
      positions[i * 3 + 1] = fly.y + Math.sin(t * 2.1) * 0.2;
      positions[i * 3 + 2] = fly.z + Math.cos(t * 1.7) * 0.4;
    });
    this.fireflies.geometry.attributes.position.needsUpdate = true;
  }

  // ---- 秋の落ち葉(ひらひら舞い落ちる) ----
  buildFallingLeaves() {
    const count = 90;
    this.leafData = [];
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.leafData.push({
        x: (Math.random() - 0.5) * this.span,
        y: Math.random() * this.skyY,
        z: (Math.random() - 0.5) * this.span,
        speed: 0.35 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.fallingLeaves = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xd07a2e,
        size: 3.5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.85,
      })
    );
    this.fallingLeaves.visible = false;
    this.fallingLeaves.frustumCulled = false;
    this.group.add(this.fallingLeaves);
  }

  updateFallingLeaves(dt) {
    this.fallingLeaves.visible =
      this.daynight.season.key === 'autumn' &&
      (this.weather.state === 'sunny' || this.weather.state === 'cloudy');
    if (!this.fallingLeaves.visible) return;
    const positions = this.fallingLeaves.geometry.attributes.position.array;
    this.leafData.forEach((leaf, i) => {
      leaf.y -= leaf.speed * dt;
      if (leaf.y < 0) {
        leaf.y = this.skyY;
        leaf.x = (Math.random() - 0.5) * this.span;
        leaf.z = (Math.random() - 0.5) * this.span;
      }
      positions[i * 3] = leaf.x + Math.sin(this.time * 1.1 + leaf.phase) * 0.4;
      positions[i * 3 + 1] = leaf.y;
      positions[i * 3 + 2] = leaf.z + Math.cos(this.time * 0.9 + leaf.phase) * 0.2;
    });
    this.fallingLeaves.geometry.attributes.position.needsUpdate = true;
  }

  // ---- 水鳥(池をすいすい泳ぐ) ----
  buildDuck() {
    this.duck = new THREE.Group();
    const body = basicMesh(new THREE.SphereGeometry(0.09, 8, 6), 0xf0ead8);
    body.scale.set(0.9, 0.7, 1.2);
    body.position.y = 0.04;
    const head = basicMesh(new THREE.SphereGeometry(0.05, 6, 5), 0x4a7a4f);
    head.position.set(0, 0.15, 0.09);
    const beak = basicMesh(new THREE.ConeGeometry(0.02, 0.05, 4), 0xe8a33d);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.15, 0.15);
    this.duck.add(body, head, beak);
    this.duck.visible = false;
    this.group.add(this.duck);
    this.duckMove = null;
    this.duckTimer = 3;
  }

  waterColumns() {
    return this.world.topsOfType('water');
  }

  updateDuck(dt) {
    const ponds = this.waterColumns();
    const active = ponds.length >= 3 && !this.world.frozen;
    // 足元が埋め立てられたら、いったん引き上げて浮かべ直す
    if (this.duck.visible && this.world.topType(this.duckCol, this.duckRow) !== 'water') {
      this.duck.visible = false;
      this.duckMove = null;
    }
    if (!active) {
      this.duck.visible = false;
      this.duckMove = null;
      return;
    }
    if (!this.duck.visible) {
      // 池に浮かべる
      const [c, r] = ponds[Math.floor(Math.random() * ponds.length)];
      const p = this.world.positionOf(c, r);
      this.duck.position.set(p.x, this.world.topSurfaceY(c, r) - 0.05, p.z);
      this.duckCol = c;
      this.duckRow = r;
      this.duck.visible = true;
    }
    this.duck.position.y =
      this.world.topSurfaceY(this.duckCol, this.duckRow) - 0.05 + Math.sin(this.time * 1.6) * 0.015;

    if (this.duckMove) {
      this.duckMove.t += dt / 3.5;
      const t = Math.min(1, this.duckMove.t);
      this.duck.position.x = this.duckMove.fx + (this.duckMove.tx - this.duckMove.fx) * t;
      this.duck.position.z = this.duckMove.fz + (this.duckMove.tz - this.duckMove.fz) * t;
      if (t >= 1) {
        this.duckCol = this.duckMove.col;
        this.duckRow = this.duckMove.row;
        this.duckMove = null;
        this.duckTimer = 2 + Math.random() * 6;
      }
      return;
    }
    this.duckTimer -= dt;
    if (this.duckTimer > 0) return;
    const next = this.world
      .neighbors(this.duckCol, this.duckRow)
      .filter(([c, r]) => this.world.topType(c, r) === 'water');
    if (next.length === 0) {
      this.duckTimer = 3;
      return;
    }
    const [c, r] = next[Math.floor(Math.random() * next.length)];
    const to = this.world.positionOf(c, r);
    this.duckMove = {
      col: c,
      row: r,
      fx: this.duck.position.x,
      fz: this.duck.position.z,
      tx: to.x,
      tz: to.z,
      t: 0,
    };
    this.duck.rotation.y = Math.atan2(to.x - this.duck.position.x, to.z - this.duck.position.z);
  }

  update(dt) {
    this.time += dt;
    this.updateBirds(dt);
    this.updateButterflies(dt);
    this.updateFish(dt);
    this.updateFireflies(dt);
    this.updateFallingLeaves(dt);
    this.updateDuck(dt);
    this.updateShootingStar(dt);
    this.updateWhale(dt);
  }
}
