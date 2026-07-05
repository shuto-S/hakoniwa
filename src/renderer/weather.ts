import * as THREE from 'three';
import { BLOCK_HEIGHT, HEX_RADIUS } from './config.ts';
import type { WeatherState, Settings } from './config.ts';
import type { World } from './world.ts';
import type { SceneView } from './scene3d.ts';
import type { DayNight } from './daynight.ts';

// 天気ごとの見た目・光量パラメータ
interface WeatherKind {
  emoji: string;
  sun: number;
  ambient: number;
  cloud: number;
}

const PUDDLE_TOPS = new Set(['grass', 'dirt', 'stone', 'sand', 'ash']);
const RAINBOW_COLORS = [0xe85a5a, 0xe8a44a, 0xe8d54a, 0x6cc75a, 0x4aa8e8, 0x9a6fd0];
const RAINBOW_LIFE = 26; // 秒

interface RainDrop {
  x: number;
  y: number;
  z: number;
  speed: number;
}

interface SnowFlake {
  x: number;
  y: number;
  z: number;
  speed: number;
  phase: number;
}

interface Puddle {
  col: number;
  row: number;
  mesh: THREE.Mesh;
  size: number;
  height: number;
}

// 天気ごとの光と雲の目標値。表示名は i18n の weather.<state> で引く
const KINDS = {
  sunny: { emoji: '☀️', sun: 1.9, ambient: 0.85, cloud: 0 },
  cloudy: { emoji: '☁️', sun: 1.15, ambient: 0.75, cloud: 0.8 },
  rain: { emoji: '🌧️', sun: 0.75, ambient: 0.65, cloud: 0.9 },
  snow: { emoji: '🌨️', sun: 1.0, ambient: 0.8, cloud: 0.7 },
};

const WEIGHTS: [string, number][] = [
  ['sunny', 0.42],
  ['cloudy', 0.3],
  ['rain', 0.17],
  ['snow', 0.11],
];

const RAIN_DROPS = 260;
const SNOW_FLAKES = 200;

export class WeatherSystem {
  view: SceneView;
  settings: Settings;
  onChange: (state: WeatherState, kind: WeatherKind) => void;
  state: WeatherState;
  timer: number;
  time: number;
  calendar: DayNight | null;
  current: { sun: number; ambient: number };
  puddleGeo: THREE.CylinderGeometry;
  puddleMat: THREE.MeshStandardMaterial;
  group: THREE.Group;
  world: World;
  span: number;
  skyY: number;
  puddles: Puddle[];
  puddleTimer: number;
  rainbowLife: number;
  rainbow: THREE.Group;
  rainbowMats: THREE.MeshBasicMaterial[];
  cloudMaterial: THREE.MeshStandardMaterial;
  clouds: THREE.Group[];
  rainData: RainDrop[];
  rain: THREE.LineSegments;
  snowData: SnowFlake[];
  snow: THREE.Points;

  constructor(
    view: SceneView,
    world: World,
    settings: Settings,
    onChange: (state: WeatherState, kind: WeatherKind) => void,
  ) {
    this.view = view;
    this.settings = settings;
    this.onChange = onChange;
    this.state = 'sunny';
    this.timer = 0;
    this.time = 0;
    this.calendar = null; // main で注入。季節で天気の出やすさが変わる
    // 現在の明るさ(昼夜サイクルと掛け合わせるため、ライトには直接触らない)
    this.current = { sun: KINDS.sunny.sun, ambient: KINDS.sunny.ambient };

    this.puddleGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.012, 6);
    this.puddleMat = new THREE.MeshStandardMaterial({
      color: 0x4aa8e8,
      roughness: 0.15,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });

    this.group = new THREE.Group();
    view.scene.add(this.group);
    this.setWorld(world);
    this.onChange(this.state, KINDS[this.state]);
  }

  get emoji() {
    return KINDS[this.state].emoji;
  }

  setWorld(world: World) {
    this.world = world;
    const spanX = world.cols * HEX_RADIUS * Math.sqrt(3);
    const spanZ = world.rows * HEX_RADIUS * 1.5;
    this.span = Math.max(spanX, spanZ) + 2;
    this.skyY = world.maxHeight * BLOCK_HEIGHT + 2.2;
    this.group.clear();
    this.puddles = [];
    this.puddleTimer = 0;
    this.rainbowLife = 0;
    this.buildClouds();
    this.buildRain();
    this.buildSnow();
    this.buildRainbow();
  }

  buildRainbow() {
    this.rainbow = new THREE.Group();
    this.rainbowMats = [];
    RAINBOW_COLORS.forEach((color, i) => {
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(this.span * 0.4 + i * 0.08, 0.045, 6, 48, Math.PI),
        material,
      );
      this.rainbowMats.push(material);
      this.rainbow.add(arc);
    });
    this.rainbow.rotation.y = -Math.PI / 5; // 視界を横切る向きに
    this.rainbow.visible = false;
    this.group.add(this.rainbow);
  }

  buildClouds() {
    this.cloudMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.clouds = [];
    for (let i = 0; i < 4; i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffs; p++) {
        const puff = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.45 + Math.random() * 0.5, 0),
          this.cloudMaterial,
        );
        puff.position.set((p - puffs / 2) * 0.6, Math.random() * 0.2, (Math.random() - 0.5) * 0.5);
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      cloud.position.set(
        (Math.random() - 0.5) * this.span,
        this.skyY + Math.random() * 1.2,
        (Math.random() - 0.5) * this.span * 0.8,
      );
      cloud.userData.speed = 0.12 + Math.random() * 0.15;
      this.clouds.push(cloud);
      this.group.add(cloud);
    }
  }

  buildRain() {
    const positions = new Float32Array(RAIN_DROPS * 6);
    this.rainData = [];
    for (let i = 0; i < RAIN_DROPS; i++) {
      this.rainData.push({
        x: (Math.random() - 0.5) * this.span,
        y: Math.random() * this.skyY,
        z: (Math.random() - 0.5) * this.span,
        speed: 7 + Math.random() * 4,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rain = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x9dbce8, transparent: true, opacity: 0.55 }),
    );
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.group.add(this.rain);
  }

  buildSnow() {
    const positions = new Float32Array(SNOW_FLAKES * 3);
    this.snowData = [];
    for (let i = 0; i < SNOW_FLAKES; i++) {
      this.snowData.push({
        x: (Math.random() - 0.5) * this.span,
        y: Math.random() * this.skyY,
        z: (Math.random() - 0.5) * this.span,
        speed: 0.6 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.snow = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 3.5,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.snow.visible = false;
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
  }

  set(state: WeatherState) {
    if (this.state === state) return;
    const prev = this.state;
    this.state = state;
    this.timer = 0;
    // 雨あがりの晴れ間には、ときどき虹がかかる
    if (prev === 'rain' && state === 'sunny' && this.settings.skyShows && Math.random() < 0.5) {
      this.rainbowLife = RAINBOW_LIFE;
    }
    this.onChange(state, KINDS[state]);
  }

  pickNext(): WeatherState {
    // 季節ごとの出やすさ(夏は晴れ、冬は雪が多い)
    const weights: [string, number][] = this.calendar
      ? Object.entries(this.calendar.season.weights)
      : WEIGHTS;
    const options = weights.filter(([kind]) => kind !== this.state);
    const total = options.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;
    for (const [kind, w] of options) {
      roll -= w;
      if (roll <= 0) return kind as WeatherState;
    }
    return 'sunny';
  }

  update(dt: number) {
    this.time += dt;

    if (!this.settings.weather) {
      this.set('sunny');
    } else {
      // 一定間隔ごとにランダムな天気へ
      this.timer += dt;
      if (this.timer >= this.settings.weatherInterval) {
        this.timer = 0;
        this.set(this.pickNext());
      }
    }

    const target = KINDS[this.state];
    const ease = Math.min(1, dt * 1.5);
    this.current.sun += (target.sun - this.current.sun) * ease;
    this.current.ambient += (target.ambient - this.current.ambient) * ease;
    this.cloudMaterial.opacity += (target.cloud * 0.8 - this.cloudMaterial.opacity) * ease;

    for (const cloud of this.clouds) {
      cloud.visible = this.cloudMaterial.opacity > 0.02;
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > this.span / 2 + 1.5) cloud.position.x = -this.span / 2 - 1.5;
    }

    this.updateRain(dt);
    this.updateSnow(dt);
    this.updatePuddles(dt);
    this.updateRainbow(dt);
  }

  updateRainbow(dt: number) {
    if (!this.settings.skyShows) this.rainbowLife = 0;
    let target = 0;
    if (this.rainbowLife > 0) {
      this.rainbowLife -= dt;
      // ふわっと現れて、最後の8秒でゆっくり消える
      target =
        0.2 * Math.min(1, (RAINBOW_LIFE - this.rainbowLife) / 2, Math.max(0, this.rainbowLife) / 8);
    }
    for (const material of this.rainbowMats) {
      material.opacity += (target - material.opacity) * Math.min(1, dt * 2);
    }
    this.rainbow.visible = this.rainbowMats[0].opacity > 0.01;
  }

  // 雨の日は水たまりができて、あがると乾いていく
  updatePuddles(dt: number) {
    if (this.state === 'rain' && !this.world.frozen && this.puddles.length < 10) {
      this.puddleTimer += dt;
      if (this.puddleTimer > 2.5) {
        this.puddleTimer = 0;
        this.spawnPuddle();
      }
    }
    for (const puddle of [...this.puddles]) {
      // 地形が変わったらそこの水たまりは消す
      if (this.world.heightAt(puddle.col, puddle.row) !== puddle.height) {
        this.removePuddle(puddle);
        continue;
      }
      if (this.state === 'rain') {
        puddle.size = Math.min(1, puddle.size + dt * 0.35);
      } else {
        puddle.size -= dt * (this.state === 'sunny' ? 0.12 : 0.04);
      }
      if (puddle.size <= 0) {
        this.removePuddle(puddle);
        continue;
      }
      puddle.mesh.scale.setScalar(0.2 + puddle.size * 0.8);
    }
  }

  spawnPuddle() {
    const spots = this.world.columnsWhere(
      (c: number, r: number) =>
        PUDDLE_TOPS.has(this.world.topType(c, r) ?? '') &&
        !this.puddles.some((p) => p.col === c && p.row === r),
    );
    if (spots.length === 0) return;
    const [col, row] = spots[Math.floor(Math.random() * spots.length)];
    const mesh = new THREE.Mesh(this.puddleGeo, this.puddleMat);
    const { x, z } = this.world.positionOf(col, row);
    mesh.position.set(x, this.world.topSurfaceY(col, row) + 0.012, z);
    mesh.scale.setScalar(0.2);
    this.group.add(mesh);
    this.puddles.push({ col, row, mesh, size: 0.05, height: this.world.heightAt(col, row) });
  }

  removePuddle(puddle: Puddle) {
    this.group.remove(puddle.mesh);
    this.puddles = this.puddles.filter((p) => p !== puddle);
  }

  updateRain(dt: number) {
    this.rain.visible = this.state === 'rain';
    if (!this.rain.visible) return;
    const positions = this.rain.geometry.attributes.position.array;
    this.rainData.forEach((drop, i) => {
      drop.y -= drop.speed * dt;
      if (drop.y < 0) {
        drop.y = this.skyY;
        drop.x = (Math.random() - 0.5) * this.span;
        drop.z = (Math.random() - 0.5) * this.span;
      }
      positions[i * 6] = drop.x;
      positions[i * 6 + 1] = drop.y;
      positions[i * 6 + 2] = drop.z;
      positions[i * 6 + 3] = drop.x;
      positions[i * 6 + 4] = drop.y + 0.28;
      positions[i * 6 + 5] = drop.z;
    });
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  updateSnow(dt: number) {
    this.snow.visible = this.state === 'snow';
    if (!this.snow.visible) return;
    const positions = this.snow.geometry.attributes.position.array;
    this.snowData.forEach((flake, i) => {
      flake.y -= flake.speed * dt;
      if (flake.y < 0) {
        flake.y = this.skyY;
        flake.x = (Math.random() - 0.5) * this.span;
        flake.z = (Math.random() - 0.5) * this.span;
      }
      positions[i * 3] = flake.x + Math.sin(this.time * 1.4 + flake.phase) * 0.25;
      positions[i * 3 + 1] = flake.y;
      positions[i * 3 + 2] = flake.z;
    });
    this.snow.geometry.attributes.position.needsUpdate = true;
  }
}
