// Expose only the path of a File already selected by the user. No filesystem,
// Node.js, IPC, arbitrary path reads or network APIs are exposed to the renderer.
const {contextBridge, webUtils} = require('electron');
contextBridge.exposeInMainWorld('flipperDesktop', {
  getPathForFile: file => webUtils.getPathForFile(file),
});
