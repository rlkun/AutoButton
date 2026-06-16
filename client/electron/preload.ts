const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  verifyLicense: () => ipcRenderer.invoke('verify-license'),
  startTask: (config: any) => ipcRenderer.invoke('start-task', config),
  stopTask: () => ipcRenderer.invoke('stop-task'),
  openOverlay: () => ipcRenderer.invoke('open-overlay'),
  minimize: () => ipcRenderer.send('window-minimize'),
  pin: () => ipcRenderer.invoke('window-pin'), // Change maximize to pin
  close: () => ipcRenderer.send('window-close'),
  onTaskUpdate: (callback: (data: any) => void) => {
    const subscription = (_event: any, value: any) => callback(value);
    ipcRenderer.on('task-update', subscription);
    return () => ipcRenderer.removeListener('task-update', subscription);
  },
  onOverlaySelected: (callback: (rect: any) => void) => {
    const subscription = (_event: any, value: any) => callback(value);
    ipcRenderer.on('overlay-selected', subscription);
    return () => ipcRenderer.removeListener('overlay-selected', subscription);
  },
  sendSelectedRect: (rect: any) => ipcRenderer.send('overlay-rect-selected', rect),
  captureRect: (rect: any) => ipcRenderer.invoke('capture-rect', rect),
});
