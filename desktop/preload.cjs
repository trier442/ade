const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ADEDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  versions: Object.freeze({
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }),
}));
