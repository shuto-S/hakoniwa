// README 用のデモGIFを撮る開発ツール。
//   npx electron scripts/capture-gif.js
// 一時的な userData で新しい世界を立ち上げ(ユーザーのセーブには触れない)、
// ブロック設置や視点回転を自動操作しながら capturePage で撮影して
// docs/demo.gif に書き出す。画面収録権限も ffmpeg も不要。
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const FPS = 10;
const SECONDS = 12;
const OUT_WIDTH = 440; // GIFの横幅(サイズ抑制のため縮小)
const WARMUP_MS = 4000; // 世界が立ち上がるまでの待ち

// ユーザーのセーブを汚さないよう、使い捨ての userData を使う
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'hakoniwa-demo-')));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// キャンバスの相対座標に pointer イベントを送ってブロックを置く
const placeAt = (fx, fy) => `(() => {
  const c = document.querySelector('#viewport canvas');
  const r = c.getBoundingClientRect();
  const x = r.left + r.width * ${fx};
  const y = r.top + r.height * ${fy};
  c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
  c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
})()`;
const selectSwatch = (i) => `document.querySelectorAll('.swatch')[${i}].click()`;
const rotate = () => `document.getElementById('btn-rotate-right').click()`;

// 撮影中の自動操作(秒 → スクリプト)
const SCENARIO = [
  [0.8, selectSwatch(6)], // レンガを選ぶ
  [1.2, placeAt(0.47, 0.5)],
  [2.0, placeAt(0.53, 0.46)],
  [2.8, placeAt(0.5, 0.56)],
  [3.6, selectSwatch(9)], // たきびを選ぶ
  [4.2, placeAt(0.58, 0.6)],
  [6.0, rotate()],
  [9.0, rotate()],
];

// 透明ウィンドウの撮影結果を、空色のグラデーションに合成する
function compositeFrame(bitmap, width, height) {
  const top = { r: 0xb8, g: 0xd4, b: 0xea };
  const bottom = { r: 0x8b, g: 0xa8, b: 0xc4 };
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = y / height;
    const bgR = top.r + (bottom.r - top.r) * t;
    const bgG = top.g + (bottom.g - top.g) * t;
    const bgB = top.b + (bottom.b - top.b) * t;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // macOS の toBitmap は BGRA(アルファ乗算済み)
      const a = bitmap[i + 3] / 255;
      rgba[i] = bitmap[i + 2] + bgR * (1 - a);
      rgba[i + 1] = bitmap[i + 1] + bgG * (1 - a);
      rgba[i + 2] = bitmap[i] + bgB * (1 - a);
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

app.whenReady().then(async () => {
  // preload が呼ぶ IPC のスタブ(撮影中は保存しない)
  ipcMain.handle('world:load', () => null);
  ipcMain.handle('world:save', () => true);
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('window:pin', () => {});

  const win = new BrowserWindow({
    width: 480,
    height: 540,
    transparent: true,
    frame: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await sleep(WARMUP_MS);

  const frames = [];
  const totalFrames = FPS * SECONDS;
  const fired = new Set();
  const start = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const elapsed = (Date.now() - start) / 1000;
    for (const [at, script] of SCENARIO) {
      if (elapsed >= at && !fired.has(at)) {
        fired.add(at);
        win.webContents.executeJavaScript(script).catch(() => {});
      }
    }
    let image = await win.webContents.capturePage();
    if (image.getSize().width > OUT_WIDTH) image = image.resize({ width: OUT_WIDTH });
    frames.push({ bitmap: image.toBitmap(), ...image.getSize() });
    const nextAt = start + ((i + 1) * 1000) / FPS;
    await sleep(Math.max(0, nextAt - Date.now()));
  }

  console.log(`captured ${frames.length} frames, encoding...`);
  const gif = GIFEncoder();
  for (const frame of frames) {
    const rgba = compositeFrame(frame.bitmap, frame.width, frame.height);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, frame.width, frame.height, { palette, delay: 1000 / FPS });
  }
  gif.finish();

  const out = path.join(__dirname, '..', 'docs', 'demo.gif');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(gif.bytes()));
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
  app.quit();
});
