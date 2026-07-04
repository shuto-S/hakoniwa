const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tsuminiwa', {
  loadWorld: () => ipcRenderer.invoke('world:load'),
  saveWorld: (json) => ipcRenderer.invoke('world:save', json),
  quit: () => ipcRenderer.send('app:quit'),
  setPinned: (pinned) => ipcRenderer.send('window:pin', pinned),
  saveScreenshot: (dataUrl) => ipcRenderer.invoke('shot:save', dataUrl),
  shareToX: (dataUrl) => ipcRenderer.invoke('shot:share', dataUrl),
  setAutoLaunch: (enabled) => ipcRenderer.send('app:autolaunch', enabled),
});
