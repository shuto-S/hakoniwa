// README 用のデモGIFを撮る開発ツール。
//   npx electron scripts/capture-gif.js
// 一時的な userData にデモ用の世界(職業つきの住民・はやい自動発展・短い天気サイクル)を
// 仕込んで起動し、ブロック設置や視点回転を自動操作しながら capturePage で撮影して
// docs/demo.gif に書き出す。画面収録権限も ffmpeg も不要。
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const ROOT = path.join(__dirname, '..');
const FPS = 10;
const SECONDS = 15;
const OUT_WIDTH = 440; // GIFの横幅(サイズ抑制のため縮小)
const WARMUP_MS = 5000; // 世界が立ち上がるまでの待ち

// ユーザーのセーブを汚さないよう、使い捨ての userData を使う
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tsuminiwa-demo-')));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// デモ用のセーブデータ: 見栄えする住民をそろえ、時間の流れをはやめる
async function buildDemoSave() {
  const { generateWorld } = await import(
    pathToFileURL(path.join(ROOT, 'src/renderer/terrain.js'))
  );
  const world = generateWorld(15, 15, 8);
  const spots = world
    .columnsWhere((c, r) => world.isWalkable(c, r))
    .filter(([c, r]) => c > 2 && c < 12 && r > 2 && r < 12); // 見える中央あたり
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const cast = [
    { type: 'villager', name: 'そら', job: 'きこり', trait: 'せっかち' },
    { type: 'villager', name: 'ゆず', job: 'のうふ', trait: 'げんき' },
    { type: 'villager', name: 'うみ', job: 'つりびと', trait: 'まいぺーす' },
    { type: 'sheep', name: 'モコ' },
    { type: 'sheep', name: 'フワ', baby: true },
    { type: 'chicken', name: 'ピヨ' },
    { type: 'chicken', name: 'マメ', baby: true },
  ];
  const characters = cast.map((c, i) => ({ ...c, col: spots[i][0], row: spots[i][1] }));
  return JSON.stringify({
    world: world.serialize(),
    characters,
    auto: true, // 自動発展オン
    settings: {
      autoSpeed: 3,
      characterSpeed: 1.2,
      dayLength: 120,
      weatherInterval: 9, // 撮影中に天気が変わるように
      sound: false,
    },
    dayTime: 0.2, // あかるい朝
    day: 0,
  });
}

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
// swatch: 0草 1土 2石 3砂 4木 5葉 6レンガ 7雪 8水 9たきび 10灰 11畑
const SCENARIO = [
  [0.6, selectSwatch(2)], // いしで小さな山をつくって…
  [1.0, placeAt(0.4, 0.45)],
  [1.7, placeAt(0.4, 0.45)],
  [2.6, selectSwatch(8)], // てっぺんから水を流す
  [3.0, placeAt(0.4, 0.45)],
  [4.4, selectSwatch(6)], // レンガの塔
  [4.8, placeAt(0.56, 0.5)],
  [5.5, placeAt(0.56, 0.5)],
  [6.4, selectSwatch(9)], // たきびを灯す
  [6.9, placeAt(0.62, 0.6)],
  [8.2, rotate()],
  [11.5, rotate()],
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
  const demoSave = await buildDemoSave();
  ipcMain.handle('world:load', () => demoSave);
  ipcMain.handle('world:save', () => true);
  ipcMain.handle('shot:save', () => null);
  ipcMain.handle('shot:share', () => false);
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('window:pin', () => {});
  ipcMain.on('app:autolaunch', () => {});

  const win = new BrowserWindow({
    width: 480,
    height: 540,
    transparent: true,
    frame: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadFile(path.join(ROOT, 'index.html'));
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
    // 撮影の途中経過を確認できるよう、数枚だけ静止画も残す
    if (i === 45 || i === 80 || i === 130) {
      fs.writeFileSync(path.join(os.tmpdir(), `tsuminiwa-frame-${i}.png`), image.toPNG());
    }
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

  const out = path.join(ROOT, 'docs', 'demo.gif');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(gif.bytes()));
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
  app.quit();
});
