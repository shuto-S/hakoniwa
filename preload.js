const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hakoniwa', {
  loadWorld: () => ipcRenderer.invoke('world:load'),
  saveWorld: (json) => ipcRenderer.invoke('world:save', json),
  quit: () => ipcRenderer.send('app:quit'),
  setPinned: (pinned) => ipcRenderer.send('window:pin', pinned),
});
