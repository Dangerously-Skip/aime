/**
 * Minimal preload for the Next.js Electron wrapper.
 * Exposes selectFolder, getUserName, openPath, and openAuthWindow IPC calls.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  getUserName: () => ipcRenderer.invoke("get-user-name"),
  getHomeDir: () => ipcRenderer.invoke("get-home-dir"),
  openPath: (path) => ipcRenderer.invoke("open-path", path),
  readFile: (path) => ipcRenderer.invoke("read-file", path),
  writeFile: (path, content) => ipcRenderer.invoke("write-file", path, content),
  saveFileDialog: (defaultName, filters) => ipcRenderer.invoke("save-file-dialog", defaultName, filters),
  ensureDir: (dirPath) => ipcRenderer.invoke("ensure-dir", dirPath),
  fileExists: (filePath) => ipcRenderer.invoke("file-exists", filePath),
  openAuthWindow: (url) => ipcRenderer.invoke("open-auth-window", url),
  onGithubAuthResult: (callback) => {
    ipcRenderer.on("github-auth-result", (_event, data) => callback(data));
  },
});
