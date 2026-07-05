import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  clipboard,
  nativeImage,
  shell,
  type IpcMainInvokeEvent,
  type IpcMainEvent,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { storeKey, clearKey, hasKey, testConnection, generate } from './ai-service.ts';
import type { AiAuthMode, AiGenerateOptions } from '../shared/ipc.ts';

const SHARE_TEXT =
  'デスクトップのすみで、ちいさな世界が育っています 🌱 #つみにわ\nhttps://github.com/shuto-S/tsuminiwa';

const MARGIN = 16;
let win: BrowserWindow | null = null;

function savePath(): string {
  return path.join(app.getPath('userData'), 'world.json');
}

function createWindow(): void {
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

ipcMain.handle('world:save', async (_event: IpcMainInvokeEvent, json: string) => {
  try {
    await fs.promises.writeFile(savePath(), json, 'utf8');
    return true;
  } catch {
    return false;
  }
});

ipcMain.on('app:quit', () => app.quit());

// ---- AI(Gemini)。キーの保存・接続テスト・生成はすべてメインプロセスで ----
ipcMain.handle('ai:setKey', (_event: IpcMainInvokeEvent, key: string) => storeKey(key));
ipcMain.handle('ai:clearKey', () => {
  clearKey();
  return true;
});
ipcMain.handle('ai:hasKey', () => hasKey());
ipcMain.handle(
  'ai:test',
  (_event: IpcMainInvokeEvent, opts: { authMode: AiAuthMode; model: string }) =>
    testConnection(opts || {}),
);
ipcMain.handle('ai:generate', (_event: IpcMainInvokeEvent, opts: AiGenerateOptions) =>
  generate(opts || {}),
);

function pngBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

// スクリーンショットを保存。保存先は macOS 標準の保存ダイアログで毎回選んでもらう
ipcMain.handle('shot:save', async (_event: IpcMainInvokeEvent, dataUrl: string) => {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dialogOptions = {
      defaultPath: path.join(app.getPath('pictures'), `tsuminiwa-${stamp}.png`),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    };
    // 親ウィンドウがあれば紐づけて表示(なければ単体ダイアログ)
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    if (canceled || !filePath) return { canceled: true };
    await fs.promises.writeFile(filePath, pngBuffer(dataUrl));
    return { ok: true, path: filePath };
  } catch {
    return { ok: false };
  }
});

// 画像をクリップボードに入れて、Xの投稿画面を開く
// (Xのweb intentは画像を添付できないため、貼り付けてもらう方式)
ipcMain.handle('shot:share', async (_event: IpcMainInvokeEvent, dataUrl: string) => {
  try {
    clipboard.writeImage(nativeImage.createFromBuffer(pngBuffer(dataUrl)));
    await shell.openExternal(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}`,
    );
    return true;
  } catch {
    return false;
  }
});

// ログイン時に自動起動(パッケージ版のみ。開発時はelectron本体を登録してしまうため無視)
ipcMain.on('app:autolaunch', (_event: IpcMainEvent, enabled: boolean) => {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
});

ipcMain.on('window:pin', (_event: IpcMainEvent, pinned: boolean) => {
  if (win) win.setAlwaysOnTop(Boolean(pinned), 'floating');
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
