// 環境音。音声ファイルは使わず、すべて Web Audio で生成する。
// - 雨: ローパスをかけたノイズ
// - 風: さらに低いノイズ(くもり・雪で強まる)
// - 鳥のさえずり: 昼、短い正弦波のチャープ
// - 虫の声: 夜、高い正弦波のパルス
// - たきび: 短いノイズバーストのパチパチ
export class AmbientAudio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.birdTimer = 4;
    this.cricketTimer = 1;
    this.crackleTimer = 0.5;
  }

  ensureContext() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // 2秒ぶんのホワイトノイズをループして使い回す
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.rain = this.makeNoiseLayer(1000);
    this.wind = this.makeNoiseLayer(280);

    // 単発音(鳥・虫・パチパチ)のバス
    this.chirpBus = ctx.createGain();
    this.chirpBus.gain.value = 1;
    this.chirpBus.connect(this.master);
  }

  makeNoiseLayer(cutoff) {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    return gain;
  }

  lerpGain(gain, target, dt, speed = 1.2) {
    gain.gain.value += (target - gain.gain.value) * Math.min(1, dt * speed);
  }

  // 鳥のさえずり: 下がり調子のチャープを2〜4回
  playBirdBurst() {
    const ctx = this.ctx;
    const chirps = 2 + Math.floor(Math.random() * 3);
    const base = 2200 + Math.random() * 1500;
    for (let i = 0; i < chirps; i++) {
      const t = ctx.currentTime + i * (0.12 + Math.random() * 0.08);
      const osc = ctx.createOscillator();
      const freq = base * (0.9 + Math.random() * 0.2);
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.72, t + 0.09);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.12, t + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(env).connect(this.chirpBus);
      osc.start(t);
      osc.stop(t + 0.13);
    }
  }

  // 虫の声: 高い音の短いパルスを3連
  playCricket() {
    const ctx = this.ctx;
    const freq = 4100 + Math.random() * 400;
    for (let i = 0; i < 3; i++) {
      const t = ctx.currentTime + i * 0.065;
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.035, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      osc.connect(env).connect(this.chirpBus);
      osc.start(t);
      osc.stop(t + 0.05);
    }
  }

  // たきびのパチッ
  playCrackle() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.8 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1800;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.05, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    source.connect(filter).connect(env).connect(this.chirpBus);
    source.start(t);
    source.stop(t + 0.07);
  }

  // env: { weatherState, daylight, isNight, season, campfires }
  update(dt, env) {
    if (!this.settings.sound) {
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
      return;
    }
    this.ensureContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();

    this.lerpGain(this.master, this.settings.volume * 0.6, dt, 2);

    const w = env.weatherState;
    this.lerpGain(this.rain, w === 'rain' ? 0.5 : 0, dt);
    const windTarget = { sunny: 0.05, cloudy: 0.16, rain: 0.12, snow: 0.26 }[w] || 0.05;
    this.lerpGain(this.wind, windTarget, dt);

    const calm = w === 'sunny' || w === 'cloudy';

    // 鳥: 明るい昼だけ
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && calm && env.daylight > 0.3) {
      this.playBirdBurst();
      this.birdTimer = 4 + Math.random() * 9;
    }

    // 虫: 冬以外の夜
    this.cricketTimer -= dt;
    if (this.cricketTimer <= 0 && calm && env.isNight && env.season !== 'winter') {
      this.playCricket();
      this.cricketTimer = 0.5 + Math.random() * 0.4;
    }

    // たきび: 数が多いほどよく鳴る
    this.crackleTimer -= dt;
    if (this.crackleTimer <= 0 && env.campfires > 0) {
      this.playCrackle();
      this.crackleTimer = (0.15 + Math.random() * 0.7) / Math.min(3, env.campfires);
    }
  }
}
