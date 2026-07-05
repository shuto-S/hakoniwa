// 季節や時間帯が合ったときにだけ現れる、空と大気のできごと。
// 具体的な内容はユーザ向けドキュメントには書かない(発見の楽しみのため)。
import * as THREE from 'three';
import { HEX_RADIUS, BLOCK_HEIGHT } from './config.ts';
import type { Settings } from './config.ts';
import type { World } from './world.ts';
import type { WeatherSystem } from './weather.ts';
import type { DayNight } from './daynight.ts';
import { clearGroup } from './three-utils.ts';

interface SparkleDatum {
  x: number;
  y: number;
  z: number;
  speed: number;
  phase: number;
}

function radialGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.6, outer);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function auroraTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 64, 0, 0);
  gradient.addColorStop(0, 'rgba(90, 230, 160, 0)');
  gradient.addColorStop(0.25, 'rgba(90, 230, 160, 0.8)');
  gradient.addColorStop(0.7, 'rgba(110, 160, 240, 0.4)');
  gradient.addColorStop(1, 'rgba(160, 110, 240, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 64);
  return new THREE.CanvasTexture(canvas);
}

export class SeasonalEvents {
  scene: THREE.Scene;
  weather: WeatherSystem;
  daynight: DayNight;
  settings: Settings;
  onRare: ((key: string) => void) | null;
  time: number;
  group: THREE.Group;
  moonTexture: THREE.CanvasTexture;
  auroraTexture: THREE.CanvasTexture;
  world: World;
  span: number;
  skyY: number;
  auroraT: number;
  moon: THREE.Sprite;
  auroraRibbons: THREE.Mesh[];
  mistLayers: THREE.Mesh[];
  sparkleData: SparkleDatum[];
  sparkles: THREE.Points;

  constructor(
    scene: THREE.Scene,
    world: World,
    weather: WeatherSystem,
    daynight: DayNight,
    settings: Settings,
  ) {
    this.scene = scene;
    this.weather = weather;
    this.daynight = daynight;
    this.settings = settings;
    // レアなできごとは意味キーで一元通知する(翻訳・AI連携は main が担当)
    this.onRare = null;
    this.time = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.moonTexture = radialGlowTexture('rgba(250, 240, 205, 1)', 'rgba(245, 230, 180, 0.55)');
    this.auroraTexture = auroraTexture();
    this.setWorld(world);
  }

  // レアなできごとを意味キーで通知(表示メッセージ・AI連携は main の emitRare が担当)
  emitRare(key: string): void {
    if (this.onRare) this.onRare(key);
  }

  get calm(): boolean {
    return this.weather.state === 'sunny' || this.weather.state === 'cloudy';
  }

  setWorld(world: World): void {
    this.world = world;
    const spanX = world.cols * HEX_RADIUS * Math.sqrt(3);
    const spanZ = world.rows * HEX_RADIUS * 1.5;
    this.span = Math.max(spanX, spanZ);
    this.skyY = world.maxHeight * BLOCK_HEIGHT + 1.6;
    // 共有テクスチャ(moonTexture/auroraTexture)は material.dispose() では
    // 解放されないので、作り直しても残る。ジオメトリ・マテリアルだけ解放する
    clearGroup(this.group);
    this.auroraT = 0;
    this.buildMoon();
    this.buildAurora();
    this.buildMist();
    this.buildSparkles();
  }

  // ---- 秋の晴れた夜だけのぼる、大きな月 ----
  buildMoon(): void {
    this.moon = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.moonTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.moon.scale.setScalar(2.4);
    this.moon.position.set(this.span * 0.32, this.skyY + 2.6, -this.span * 0.4);
    this.group.add(this.moon);
  }

  updateMoon(dt: number): void {
    const active =
      this.settings.skyShows &&
      this.daynight.season.key === 'autumn' &&
      this.daynight.isNight &&
      this.weather.state === 'sunny';
    const material = this.moon.material;
    material.opacity += ((active ? 0.9 : 0) - material.opacity) * Math.min(1, dt * 0.8);
    this.moon.visible = material.opacity > 0.02;
    if (this.moon.visible) {
      this.moon.position.y = this.skyY + 2.4 + Math.sin(this.time * 0.15) * 0.2; // ゆっくり揺蕩う
    }
  }

  // ---- 冬の晴れた夜、ごくまれにゆらめくオーロラ ----
  buildAurora(): void {
    this.auroraRibbons = [];
    for (let i = 0; i < 2; i++) {
      const ribbon = new THREE.Mesh(
        new THREE.PlaneGeometry(this.span * (0.8 + i * 0.25), 2 + i * 0.6),
        new THREE.MeshBasicMaterial({
          map: this.auroraTexture,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      ribbon.position.set(
        (i - 0.5) * this.span * 0.2,
        this.skyY + 2.2 + i * 0.9,
        -this.span * 0.45,
      );
      ribbon.rotation.z = (i - 0.5) * 0.12;
      this.auroraRibbons.push(ribbon);
      this.group.add(ribbon);
    }
  }

  updateAurora(dt: number): void {
    const conditions =
      this.settings.skyShows &&
      this.daynight.season.key === 'winter' &&
      this.daynight.isNight &&
      this.weather.state === 'sunny';

    if (this.auroraT <= 0 && conditions && Math.random() < dt / 1500) {
      this.auroraT = 45;
      this.emitRare('aurora');
    }
    if (this.auroraT > 0) this.auroraT -= dt;

    const target = this.auroraT > 0 && conditions ? 0.4 : 0;
    this.auroraRibbons.forEach((ribbon, i) => {
      const material = ribbon.material as THREE.Material;
      material.opacity += (target - material.opacity) * Math.min(1, dt * 0.6);
      ribbon.visible = material.opacity > 0.01;
      if (ribbon.visible) {
        ribbon.position.x = (i - 0.5) * this.span * 0.2 + Math.sin(this.time * 0.3 + i * 2) * 0.8;
        ribbon.rotation.z = (i - 0.5) * 0.12 + Math.sin(this.time * 0.2 + i) * 0.05;
      }
    });
  }

  // ---- 春と秋の明けがた、うっすらとかかる朝もや ----
  buildMist(): void {
    this.mistLayers = [];
    for (let i = 0; i < 2; i++) {
      const mist = new THREE.Mesh(
        new THREE.PlaneGeometry(this.span + 3, this.span + 3),
        new THREE.MeshBasicMaterial({
          color: 0xe8eef4,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      mist.rotation.x = -Math.PI / 2;
      mist.position.y = 0.55 + i * 0.5;
      this.mistLayers.push(mist);
      this.group.add(mist);
    }
  }

  updateMist(dt: number): void {
    const season = this.daynight.season.key;
    const dawn = this.daynight.t < 0.05 && this.daynight.daylight > 0.01;
    const active = dawn && this.calm && (season === 'spring' || season === 'autumn');
    this.mistLayers.forEach((mist, i) => {
      const material = mist.material as THREE.Material;
      material.opacity +=
        ((active ? 0.13 - i * 0.04 : 0) - material.opacity) * Math.min(1, dt * 0.5);
      mist.visible = material.opacity > 0.01;
      if (mist.visible) {
        mist.position.x = Math.sin(this.time * 0.1 + i * 3) * 0.5;
        mist.position.z = Math.cos(this.time * 0.08 + i) * 0.4;
      }
    });
  }

  // ---- 冬の晴れた昼、空気がきらきら光る ----
  buildSparkles(): void {
    const count = 50;
    this.sparkleData = [];
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.sparkleData.push({
        x: (Math.random() - 0.5) * this.span,
        y: 0.6 + Math.random() * 2,
        z: (Math.random() - 0.5) * this.span,
        speed: 0.1 + Math.random() * 0.15,
        phase: Math.random() * Math.PI * 2,
      });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.sparkles = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 2.2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.sparkles.visible = false;
    this.sparkles.frustumCulled = false;
    this.group.add(this.sparkles);
  }

  updateSparkles(dt: number): void {
    const active =
      this.daynight.season.key === 'winter' &&
      this.daynight.daylight > 0.4 &&
      this.weather.state === 'sunny';
    const material = this.sparkles.material as THREE.Material;
    material.opacity += ((active ? 0.75 : 0) - material.opacity) * Math.min(1, dt * 1.5);
    this.sparkles.visible = material.opacity > 0.02;
    if (!this.sparkles.visible) return;
    const positions = this.sparkles.geometry.attributes.position.array;
    this.sparkleData.forEach((sparkle, i) => {
      sparkle.y -= sparkle.speed * dt;
      if (sparkle.y < 0.4) sparkle.y = 2.6;
      // またたき(見える瞬間だけ座標に置き、消える瞬間は遠くへ)
      const twinkle = Math.sin(this.time * 4 + sparkle.phase) > 0.2;
      positions[i * 3] = sparkle.x;
      positions[i * 3 + 1] = twinkle ? sparkle.y : -100;
      positions[i * 3 + 2] = sparkle.z;
    });
    this.sparkles.geometry.attributes.position.needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.updateMoon(dt);
    this.updateAurora(dt);
    this.updateMist(dt);
    this.updateSparkles(dt);
  }
}
