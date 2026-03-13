/**
 * Minimal preload for the Next.js Electron wrapper.
 * Exposes selectFolder, getUserName, openPath, and openAuthWindow IPC calls.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  getUserName: () => ipcRenderer.invoke("get-user-name"),
  openPath: (path) => ipcRenderer.invoke("open-path", path),
  openAuthWindow: (url) => ipcRenderer.invoke("open-auth-window", url),
  onGithubAuthResult: (callback) => {
    ipcRenderer.on("github-auth-result", (_event, data) => callback(data));
  },
});
