const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ADEDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  versions: Object.freeze({
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }),
  modelStatus: () => ipcRenderer.invoke('ade:model-status'),
  downloadModel: () => ipcRenderer.invoke('ade:model-download'),
  onModelProgress: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ade:model-progress', listener);
    return () => ipcRenderer.removeListener('ade:model-progress', listener);
  },
}));
