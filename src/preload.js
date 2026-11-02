'use strict';
const { contextBridge, ipcRenderer, pathToFileURL } = (() => {
  const e = require('electron');
  return { contextBridge: e.contextBridge, ipcRenderer: e.ipcRenderer, pathToFileURL: require('url').pathToFileURL };
})();

contextBridge.exposeInMainWorld('bm', {
  saveProject: (json, suggested) => ipcRenderer.invoke('bm:save-project', json, suggested),
  openProject: () => ipcRenderer.invoke('bm:open-project'),
  pickMedia: () => ipcRenderer.invoke('bm:pick-media'),
  probeMedia: (path) => ipcRenderer.invoke('bm:probe-media', path),
  videoThumbs: (path, times) => ipcRenderer.invoke('bm:video-thumbs', path, times),
  audioPeaks: (path, count) => ipcRenderer.invoke('bm:audio-peaks', path, count),
  exportStart: () => ipcRenderer.invoke('bm:export-start'),
  exportFrame: (dir, index, dataUrl) => ipcRenderer.invoke('bm:export-frame', dir, index, dataUrl),
  exportFinish: (dir, opts) => ipcRenderer.invoke('bm:export-finish', dir, opts),
  exportAbort: (dir) => ipcRenderer.invoke('bm:export-abort', dir),
  fileUrl: (p) => pathToFileURL(p).href
});
