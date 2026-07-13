import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  screen,
  clipboard,
  nativeImage,
  shell,
  type Rectangle,
  type IpcMainInvokeEvent,
  type IpcMainEvent,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { storeKey, clearKey, hasKey, testConnection, generate } from './ai-service.ts';
import { loadWorldFiles, saveWorldAtomic } from './storage.ts';
import type { AiAuthMode, AiGenerateOptions } from '../shared/ipc.ts';

const SHARE_TEXT =
  'デスクトップのすみで、ちいさな世界が育っています 🌱 #つみにわ\nhttps://github.com/shuto-S/tsuminiwa';

const MARGIN = 16;
const SMOKE_TEST = process.argv.includes('--smoke-test');
const smokeUserData = SMOKE_TEST
  ? fs.mkdtempSync(path.join(app.getPath('temp'), 'tsuminiwa-smoke-'))
  : null;
if (smokeUserData) app.setPath('userData', smokeUserData);
let win: BrowserWindow | null = null;
let boundsSaveTimer: ReturnType<typeof setTimeout> | undefined;

function savePath(): string {
  return path.join(app.getPath('userData'), 'world.json');
}

function backupPath(): string {
  return path.join(app.getPath('userData'), 'world.backup.json');
}

function windowStatePath(): string {
  return path.join(app.getPath('userData'), 'window.json');
}

function restoredBounds(): Rectangle | null {
  try {
    const bounds = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8')) as Rectangle;
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null;
    if (bounds.width < 320 || bounds.height < 360) return null;
    const visible = screen.getAllDisplays().some(({ workArea }) => {
      const width =
        Math.min(workArea.x + workArea.width, bounds.x + bounds.width) -
        Math.max(workArea.x, bounds.x);
      const height =
        Math.min(workArea.y + workArea.height, bounds.y + bounds.height) -
        Math.max(workArea.y, bounds.y);
      return width >= 80 && height >= 80;
    });
    return visible ? bounds : null;
  } catch {
    return null;
  }
}

function scheduleBoundsSave(): void {
  clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    fs.promises
      .writeFile(windowStatePath(), JSON.stringify(win.getBounds()), 'utf8')
      .catch(() => {});
  }, 400);
}

function createWindow(): void {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 480;
  const height = 540;
  const restored = restoredBounds();

  win = new BrowserWindow({
    width: restored?.width ?? width,
    height: restored?.height ?? height,
    x: restored?.x ?? workArea.x + workArea.width - width - MARGIN,
    y: restored?.y ?? workArea.y + workArea.height - height - MARGIN,
    minWidth: 320,
    minHeight: 360,
    transparent: !SMOKE_TEST,
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

  if (!SMOKE_TEST) {
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  win.on('move', scheduleBoundsSave);
  win.on('resize', scheduleBoundsSave);
  win.on('closed', () => {
    clearTimeout(boundsSaveTimer);
    win = null;
  });
  if (SMOKE_TEST) win.webContents.once('did-finish-load', () => void runSmokeTest(win!));
  win.loadFile('index.html');
}

async function runSmokeTest(window: BrowserWindow): Promise<void> {
  try {
    await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = Date.now() + 10000;
        const waitFor = (predicate, timeout = 3000) => new Promise((resolve, reject) => {
          const deadline = Date.now() + timeout;
          const poll = () => {
            if (predicate()) resolve(true);
            else if (Date.now() >= deadline) reject(new Error('condition timed out'));
            else setTimeout(poll, 25);
          };
          poll();
        });
        const check = () => {
          const palette = document.getElementById('palette');
          if (document.querySelector('#viewport canvas') && palette?.children.length >= 14) {
            (async () => {
             try {
              const required = ['btn-settings', 'btn-log', 'settings-panel', 'log-panel', 'event-log'];
              if (required.some((id) => !document.getElementById(id))) throw new Error('required UI missing');
              if (![...palette.children].every((el) => el.tagName === 'BUTTON')) {
                throw new Error('palette controls are not buttons');
              }
              if (getComputedStyle(palette).overflowX !== 'auto') throw new Error('palette is not responsive');
              document.getElementById('btn-settings').click();
              const settings = document.getElementById('settings-panel');
              if (settings.classList.contains('hidden')) throw new Error('settings did not open');
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
              if (!settings.classList.contains('hidden')) throw new Error('Escape did not close settings');
              document.getElementById('btn-log').click();
              if (document.getElementById('log-panel').classList.contains('hidden')) {
                throw new Error('event log did not open');
              }
              window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

              document.getElementById('btn-settings').click();
              document.getElementById('tab-world').click();
              const grid = document.getElementById('grid-size');
              const originalGrid = grid.value;
              const firstGrid = String(Number(originalGrid) + 2);
              grid.value = firstGrid;
              grid.dispatchEvent(new Event('input', { bubbles: true }));
              grid.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise((done) => setTimeout(done, 80));
              if (document.querySelector('.toast-action')) {
                throw new Error('input regenerated the world before change');
              }
              grid.dispatchEvent(new Event('change', { bubbles: true }));
              await waitFor(() => document.querySelectorAll('.toast-action').length === 1);
              if (grid.value !== firstGrid) throw new Error('grid change was not applied');

              const charSpeed = document.getElementById('char-speed');
              const originalSpeed = charSpeed.value;
              charSpeed.value = '1.7';
              charSpeed.dispatchEvent(new Event('input', { bubbles: true }));
              document.querySelector('.toast-action button').click();
              await waitFor(() => grid.value === originalGrid && !document.querySelector('.toast-action'));
              if (charSpeed.value !== originalSpeed) throw new Error('settings were not restored by undo');

              grid.value = firstGrid;
              grid.dispatchEvent(new Event('change', { bubbles: true }));
              await waitFor(() => document.querySelector('.toast-action'));
              const secondGrid = String(Number(firstGrid) + 2);
              grid.value = secondGrid;
              grid.dispatchEvent(new Event('change', { bubbles: true }));
              await waitFor(() => grid.value === secondGrid && document.querySelectorAll('.toast-action').length === 1);
              document.querySelector('.toast-action button').click();
              await waitFor(() => grid.value === firstGrid && !document.querySelector('.toast-action'));

              await new Promise((done) => setTimeout(done, 1400));
              const saved = await window.tsuminiwa.loadWorld();
              const session = JSON.parse(saved.json);
              if (session.world.cols !== Number(firstGrid)) throw new Error('undone world was not saved');
              if (session.settings.characterSpeed !== Number(originalSpeed)) {
                throw new Error('undone settings were not saved');
              }
              if (!Array.isArray(session.characters) || session.characters.length === 0) {
                throw new Error('characters were not restored');
              }
              if (!Array.isArray(session.waterDist) || typeof session.day !== 'number') {
                throw new Error('time or water state was not restored');
              }

              document.getElementById('tab-ai').click();
              const aiEnabled = document.getElementById('opt-ai-enabled');
              aiEnabled.checked = true;
              aiEnabled.dispatchEvent(new Event('change', { bubbles: true }));
              const aiConsent = document.getElementById('opt-ai-consent');
              aiConsent.checked = true;
              aiConsent.dispatchEvent(new Event('change', { bubbles: true }));
              await new Promise((done) => setTimeout(done, 1400));
              const beforeAi = JSON.parse((await window.tsuminiwa.loadWorld()).json);
              const beforeAiWorld = JSON.stringify(beforeAi.world.stacks);
              document.getElementById('ai-worldgen-input').value = 'snowy island';
              document.getElementById('ai-worldgen-go').click();
              await waitFor(() => document.querySelector('.toast-action'));
              document.querySelector('.toast-action button').click();
              await waitFor(() => !document.querySelector('.toast-action'));
              await new Promise((done) => setTimeout(done, 1400));
              const aiUndone = JSON.parse((await window.tsuminiwa.loadWorld()).json);
              if (JSON.stringify(aiUndone.world.stacks) !== beforeAiWorld) {
                throw new Error('AI-generated world was not restored by undo');
              }
              resolve(true);
            } catch (error) {
              reject(error);
            }
            })();
            return;
          }
          if (Date.now() >= deadline) reject(new Error('renderer startup timed out'));
          else setTimeout(check, 50);
        };
        check();
      })
    `);
    console.log('Electron UI smoke test passed');
    app.exit(0);
  } catch (error) {
    console.error('Electron UI smoke test failed:', error);
    app.exit(1);
  }
}

ipcMain.handle('world:load', async () => {
  return loadWorldFiles(savePath(), backupPath());
});

ipcMain.handle('world:save', async (_event: IpcMainInvokeEvent, json: string) => {
  return saveWorldAtomic(savePath(), backupPath(), json);
});

ipcMain.on('app:quit', () => app.quit());

// ---- AI(Gemini)。キーの保存・接続テスト・生成はすべてメインプロセスで ----
ipcMain.handle('ai:setKey', (_event: IpcMainInvokeEvent, key: string) => storeKey(key));
ipcMain.handle('ai:clearKey', () => {
  clearKey();
  return true;
});
ipcMain.handle('ai:hasKey', () => (SMOKE_TEST ? true : hasKey()));
ipcMain.handle(
  'ai:test',
  (_event: IpcMainInvokeEvent, opts: { authMode: AiAuthMode; model: string }) =>
    testConnection(opts || {}),
);
ipcMain.handle('ai:generate', (_event: IpcMainInvokeEvent, opts: AiGenerateOptions) => {
  if (SMOKE_TEST) {
    return {
      ok: true,
      text: JSON.stringify({
        waterLevel: 0.05,
        hilliness: 1.8,
        treeDensity: 0,
        flowerDensity: 0,
        snow: 1,
        sandiness: 0,
      }),
    };
  }
  return generate(opts || {});
});

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
  if (app.isPackaged && !SMOKE_TEST) app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
});

ipcMain.on('window:pin', (_event: IpcMainEvent, pinned: boolean) => {
  if (win) win.setAlwaysOnTop(Boolean(pinned), 'floating');
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  if (smokeUserData) fs.rmSync(smokeUserData, { recursive: true, force: true });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
