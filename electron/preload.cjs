const { contextBridge, ipcRenderer } = require('electron');
const invoke = (name, ...args) => ipcRenderer.invoke(`tomp3:${name}`, ...args).then(result => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
});
contextBridge.exposeInMainWorld('tomp3', {
  getState: () => invoke('state'),
  pasteUrl: () => invoke('paste'),
  inspect: url => invoke('inspect', url),
  download: (url, options) => invoke('download', url, options),
  cancel: id => invoke('cancel', id),
  retry: id => invoke('retry', id),
  chooseFolder: () => invoke('folder'),
  reveal: id => invoke('reveal', id),
  openFolder: () => invoke('open-folder'),
  openContact: target => invoke('contact', target),
  clearHistory: () => invoke('clear'),
  onState: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('tomp3:state-changed', handler);
    return () => ipcRenderer.removeListener('tomp3:state-changed', handler);
  }
});
