const { app, BrowserWindow, ipcMain, screen, clipboard, nativeImage, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const ai = require('./ai/main-service.js');

const SHARE_TEXT = 'デスクトップのすみで、ちいさな世界が育っています 🌱 #つみにわ\nhttps://github.com/shuto-S/tsuminiwa';

const MARGIN = 16;
let win = null;

function savePath() {
  return path.join(app.getPath('userData'), 'world.json');
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 480;
  const height = 540;

  win = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - MARGIN,
    y: workArea.y + workArea.height - height - MARGIN,
    minWidth: 320,
    minHeight: 360,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile('index.html');
}

ipcMain.handle('world:load', async () => {
  try {
    return await fs.promises.readFile(savePath(), 'utf8');
  } catch {
    return null;
  }
});

ipcMain.handle('world:save', async (_event, json) => {
  try {
    await fs.promises.writeFile(savePath(), json, 'utf8');
    return true;
  } catch {
    return false;
  }
});

ipcMain.on('app:quit', () => app.quit());

// ---- AI(Gemini)。キーの保存・接続テスト・生成はすべてメインプロセスで ----
ipcMain.handle('ai:setKey', (_event, key) => ai.storeKey(key));
ipcMain.handle('ai:clearKey', () => {
  ai.clearKey();
  return true;
});
ipcMain.handle('ai:hasKey', () => ai.hasKey());
ipcMain.handle('ai:test', (_event, opts) => ai.testConnection(opts || {}));
ipcMain.handle('ai:generate', (_event, opts) => ai.generate(opts || {}));

function pngBuffer(dataUrl) {
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

// スクリーンショットをピクチャ/つみにわ に保存
ipcMain.handle('shot:save', async (_event, dataUrl) => {
  try {
    const dir = path.join(app.getPath('pictures'), 'つみにわ');
    await fs.promises.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, `tsuminiwa-${stamp}.png`);
    await fs.promises.writeFile(file, pngBuffer(dataUrl));
    return file;
  } catch {
    return null;
  }
});

// 画像をクリップボードに入れて、Xの投稿画面を開く
// (Xのweb intentは画像を添付できないため、貼り付けてもらう方式)
ipcMain.handle('shot:share', async (_event, dataUrl) => {
  try {
    clipboard.writeImage(nativeImage.createFromBuffer(pngBuffer(dataUrl)));
    await shell.openExternal(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}`
    );
    return true;
  } catch {
    return false;
  }
});

// ログイン時に自動起動(パッケージ版のみ。開発時はelectron本体を登録してしまうため無視)
ipcMain.on('app:autolaunch', (_event, enabled) => {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
});

ipcMain.on('window:pin', (_event, pinned) => {
  if (win) win.setAlwaysOnTop(Boolean(pinned), 'floating');
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
