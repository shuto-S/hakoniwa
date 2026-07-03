const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');

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

ipcMain.on('window:pin', (_event, pinned) => {
  if (win) win.setAlwaysOnTop(Boolean(pinned), 'floating');
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => app.quit());

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
