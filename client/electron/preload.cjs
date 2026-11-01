const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getSources: () => ipcRenderer.invoke('get-sources'),
  startAudioLoopback: (params) => ipcRenderer.invoke('start-audio-loopback', params),
  stopAudioLoopback: () => ipcRenderer.invoke('stop-audio-loopback'),
  onAudioPcmChunk: (callback) => {
    const handler = (_event, buffer) => callback(buffer);
    ipcRenderer.on('audio-pcm-chunk', handler);
    return () => ipcRenderer.removeListener('audio-pcm-chunk', handler);
  },
  setInCall: (inCall) => ipcRenderer.invoke('set-in-call', inCall),
  // null para de vigiar; o callback recebe o id da fonte quando a janela compartilhada fecha
  watchShareSource: (sourceId) => ipcRenderer.invoke('watch-share-source', sourceId),
  onShareSourceClosed: (callback) => {
    const handler = (_event, sourceId) => callback(sourceId);
    ipcRenderer.on('share-source-closed', handler);
    return () => ipcRenderer.removeListener('share-source-closed', handler);
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // Bandeja e comportamento da janela
  getDesktopSettings: () => ipcRenderer.invoke('desktop-settings-get'),
  setDesktopSettings: (patch) => ipcRenderer.invoke('desktop-settings-set', patch),
  sendTrayState: (state) => ipcRenderer.send('tray-state', state),
  onTrayAction: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('tray-action', handler);
    return () => ipcRenderer.removeListener('tray-action', handler);
  },
  setTitleBarColors: (colors) => ipcRenderer.invoke('set-title-bar-colors', colors),
  // Links resenha://convite/<código>: o pendente (app aberto pelo link) e os que chegarem depois
  getPendingDeepLink: () => ipcRenderer.invoke('deep-link-pending'),
  onDeepLink: (callback) => {
    const handler = (_event, link) => callback(link);
    ipcRenderer.on('deep-link', handler);
    return () => ipcRenderer.removeListener('deep-link', handler);
  },
  getUpdateState: () => ipcRenderer.invoke('update-get-state'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  checkForUpdates: () => ipcRenderer.invoke('update-check'),
  onUpdateStatus: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  }
});
