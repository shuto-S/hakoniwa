// README/SNS 用のデモ映像を撮る開発ツール。
//   npx electron scripts/capture-gif.js
// 使い捨ての userData にデモ用の世界(職業つき住民・はやい自動発展・短い天気サイクル)を
// 仕込んで起動し、ブロック設置や視点回転を自動操作しながら capturePage で撮影する。
// 出力:
//   docs/demo.gif  … README 埋め込み用(軽量・幅を縮小)
//   docs/demo.mp4  … X/SNS 用(高画質・要 ffmpeg)
// 画面収録権限は不要。mp4 化にだけ ffmpeg を使う(無ければ GIF だけ出す)。
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const ROOT = path.join(__dirname, '..');
const FPS = 12;
const SECONDS = 18;
const GIF_WIDTH = 460; // GIF の横幅(サイズ抑制のため縮小)
const WARMUP_MS = 5000; // 世界が立ち上がるまでの待ち

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tsuminiwa-demo-')));
const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuminiwa-frames-'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// デモ用のセーブデータ: 見栄えする住民をそろえ、時間の流れをはやめる
async function buildDemoSave() {
  const { generateWorld } = await import(pathToFileURL(path.join(ROOT, 'src/renderer/terrain.js')));
  const world = generateWorld(15, 15, 8);
  const spots = world
    .columnsWhere((c, r) => world.isWalkable(c, r))
    .filter(([c, r]) => c > 2 && c < 12 && r > 2 && r < 12);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const cast = [
    { type: 'villager', name: 'そら', job: 'lumberjack', trait: 'hasty' },
    { type: 'villager', name: 'ゆず', job: 'farmer', trait: 'lively' },
    { type: 'villager', name: 'うみ', job: 'fisher', trait: 'mypace' },
    { type: 'sheep', name: 'モコ' },
    { type: 'sheep', name: 'フワ', baby: true },
    { type: 'chicken', name: 'ピヨ' },
    { type: 'chicken', name: 'マメ', baby: true },
  ];
  const characters = cast.map((c, i) => ({ ...c, col: spots[i][0], row: spots[i][1] }));
  return JSON.stringify({
    world: world.serialize(),
    characters,
    auto: true,
    settings: {
      language: 'ja',
      autoSpeed: 3,
      characterSpeed: 1.2,
      dayLength: 120,
      weatherInterval: 9,
      sound: false,
    },
    dayTime: 0.2,
    day: 0,
  });
}

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

// swatch: 0草 1土 2石 3砂 4木 5葉 6レンガ 7雪 8水 9たきび 10灰 11畑
const SCENARIO = [
  [0.6, selectSwatch(2)], // いしで小さな山
  [1.0, placeAt(0.4, 0.45)],
  [1.7, placeAt(0.4, 0.45)],
  [2.6, selectSwatch(8)], // 水を流す
  [3.0, placeAt(0.4, 0.45)],
  [4.4, selectSwatch(6)], // レンガの塔
  [4.8, placeAt(0.56, 0.5)],
  [5.5, placeAt(0.56, 0.5)],
  [6.4, selectSwatch(9)], // たきび
  [6.9, placeAt(0.62, 0.6)],
  [8.5, rotate()],
  [13.5, rotate()],
];

// 空色のグラデーション背景(RGBA を返す)
function skyPixel(y, height) {
  const t = y / height;
  return [
    Math.round(0xb8 + (0x8b - 0xb8) * t),
    Math.round(0xd4 + (0xa8 - 0xd4) * t),
    Math.round(0xea + (0xc4 - 0xea) * t),
  ];
}

// 透明ウィンドウの BGRA ビットマップを空色に合成。out='rgba'|'bgra'
function composite(bitmap, width, height, out) {
  const dst = Buffer.allocUnsafe(width * height * 4);
  for (let y = 0; y < height; y++) {
    const [sr, sg, sb] = skyPixel(y, height);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = bitmap[i + 3] / 255; // アルファ乗算済み
      const r = bitmap[i + 2] + sr * (1 - a);
      const g = bitmap[i + 1] + sg * (1 - a);
      const b = bitmap[i] + sb * (1 - a);
      if (out === 'bgra') {
        dst[i] = b;
        dst[i + 1] = g;
        dst[i + 2] = r;
        dst[i + 3] = 255;
      } else {
        dst[i] = r;
        dst[i + 1] = g;
        dst[i + 2] = b;
        dst[i + 3] = 255;
      }
    }
  }
  return dst;
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

  const gifFrames = [];
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

    const image = await win.webContents.capturePage(); // retina 解像度
    const full = image.getSize();

    // mp4 用: フル解像度の PNG フレームをディスクへ
    const bmp = image.toBitmap();
    const bgra = composite(bmp, full.width, full.height, 'bgra');
    const png = nativeImage
      .createFromBitmap(bgra, { width: full.width, height: full.height })
      .toPNG();
    fs.writeFileSync(path.join(framesDir, `f-${String(i + 1).padStart(4, '0')}.png`), png);

    // GIF 用: 縮小して合成
    const small = image.resize({ width: GIF_WIDTH });
    const s = small.getSize();
    gifFrames.push({ rgba: composite(small.toBitmap(), s.width, s.height, 'rgba'), ...s });

    const nextAt = start + ((i + 1) * 1000) / FPS;
    await sleep(Math.max(0, nextAt - Date.now()));
  }

  // ---- GIF を書き出す ----
  console.log(`captured ${gifFrames.length} frames, encoding GIF...`);
  const gif = GIFEncoder();
  for (const frame of gifFrames) {
    const palette = quantize(frame.rgba, 256);
    const index = applyPalette(frame.rgba, palette);
    gif.writeFrame(index, frame.width, frame.height, { palette, delay: 1000 / FPS });
  }
  gif.finish();
  const gifOut = path.join(ROOT, 'docs', 'demo.gif');
  fs.mkdirSync(path.dirname(gifOut), { recursive: true });
  fs.writeFileSync(gifOut, Buffer.from(gif.bytes()));
  console.log(`wrote ${gifOut} (${(fs.statSync(gifOut).size / 1024 / 1024).toFixed(2)} MB)`);

  // ---- mp4 を書き出す(ffmpeg があれば) ----
  const mp4Out = path.join(ROOT, 'docs', 'demo.mp4');
  const ff = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(FPS),
      '-i',
      path.join(framesDir, 'f-%04d.png'),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '20',
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-movflags',
      '+faststart',
      mp4Out,
    ],
    { stdio: 'ignore' },
  );
  if (ff.status === 0) {
    console.log(`wrote ${mp4Out} (${(fs.statSync(mp4Out).size / 1024 / 1024).toFixed(2)} MB)`);
  } else {
    console.log('ffmpeg が無い/失敗のため mp4 はスキップ(GIF のみ)');
  }

  fs.rmSync(framesDir, { recursive: true, force: true });
  app.quit();
});
