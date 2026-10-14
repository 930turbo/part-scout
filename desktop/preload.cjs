const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('scoutDesktop', {
  openSeller: (url) => ipcRenderer.invoke('scout:open-seller', url),
  openExternal: (url) => ipcRenderer.invoke('scout:open-external', url),
  dataFolder: () => ipcRenderer.invoke('scout:data-folder'),
  appearance: (value) => ipcRenderer.invoke('scout:appearance', value),
});
