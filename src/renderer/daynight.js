import * as THREE from 'three';
import { SEASONS, DAYS_PER_SEASON } from './config.js';

const DAY_SUN = new THREE.Color(0xfff3dd);
const DAWN_SUN = new THREE.Color(0xffb37a);
const DAY_AMBIENT = new THREE.Color(0xffffff);
const NIGHT_AMBIENT = new THREE.Color(0x7f8fc4);

// t: 0=日の出, 0.25=正午, 0.5=日の入り, 0.5〜1=夜
// day: 経過日数。DAYS_PER_SEASON 日ごとに季節がめぐる
export class DayNight {
  constructor(view, settings) {
    this.view = view;
    this.settings = settings;
    this.t = 0.1; // 朝からはじまる
    this.day = 0;
  }

  get daylight() {
    return THREE.MathUtils.clamp(Math.sin(this.t * Math.PI * 2) * 1.4, 0, 1);
  }

  get isNight() {
    return this.daylight < 0.08;
  }

  get seasonIndex() {
    return Math.floor(this.day / DAYS_PER_SEASON) % SEASONS.length;
  }

  get season() {
    return SEASONS[this.seasonIndex];
  }

  // weatherCurrent: WeatherSystem.current(天気ぶんの明るさ)
  update(dt, weatherCurrent) {
    if (this.settings.dayNight) {
      const next = this.t + dt / this.settings.dayLength;
      if (next >= 1) this.day++;
      this.t = next % 1;
    } else {
      this.t = 0.25; // 常に正午
    }

    const s = this.daylight;
    this.view.sun.intensity = weatherCurrent.sun * (0.12 + 0.88 * s);
    this.view.ambient.intensity = weatherCurrent.ambient * (0.42 + 0.58 * s);

    // 朝夕は太陽が橙色に、夜は環境光が青白く
    const warmth = THREE.MathUtils.clamp(1 - s / 0.45, 0, 1);
    this.view.sun.color.copy(DAY_SUN).lerp(DAWN_SUN, warmth);
    const nightness = THREE.MathUtils.clamp(1 - s / 0.3, 0, 1);
    this.view.ambient.color.copy(DAY_AMBIENT).lerp(NIGHT_AMBIENT, nightness);
  }
}
