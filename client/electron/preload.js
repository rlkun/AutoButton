const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  verifyLicense: () => ipcRenderer.invoke('verify-license'),
  startTask: (config) => ipcRenderer.invoke('start-task', config),
  stopTask: () => ipcRenderer.invoke('stop-task'),
  openOverlay: () => ipcRenderer.invoke('open-overlay'),
  minimize: () => ipcRenderer.send('window-minimize'),
  pin: () => ipcRenderer.invoke('window-pin'),
  close: () => ipcRenderer.send('window-close'),
  getWindowList: () => ipcRenderer.invoke('get-window-list'),
  hoverWindow: (rect) => ipcRenderer.send('window-hover', rect), // Send rect coordinates directly
  hoverWindowExit: () => ipcRenderer.send('window-hover-exit'), // Send hover exit
  onTaskUpdate: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('task-update', subscription);
    return () => ipcRenderer.removeListener('task-update', subscription);
  },
  onOverlaySelected: (callback) => {
    const subscription = (_event, value) => callback(value);
    ipcRenderer.on('overlay-selected', subscription);
    return () => ipcRenderer.removeListener('overlay-selected', subscription);
  },
  sendSelectedRect: (rect) => ipcRenderer.send('overlay-rect-selected', rect),
  captureRect: (rect) => ipcRenderer.invoke('capture-rect', rect),
});
