/**
 * Minimal preload for the Next.js Electron wrapper.
 * Exposes selectFolder, getUserName, openPath, and openAuthWindow IPC calls.
 */

// Suppress GUEST_VIEW_MANAGER_CALL errors in the renderer console.
// These are benign Electron internal webview IPC errors triggered by redirects.
const _origErr = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('GUEST_VIEW_MANAGER_CALL')) return;
  _origErr.apply(console, args);
};

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
  showNotification: (title, body) => ipcRenderer.invoke("show-notification", title, body),
  openAuthWindow: (url) => ipcRenderer.invoke("open-auth-window", url),
  openConnectorAuthWindow: (url, callbackPath) => ipcRenderer.invoke("open-connector-auth-window", url, callbackPath),
  onGithubAuthResult: (callback) => {
    ipcRenderer.on("github-auth-result", (_event, data) => callback(data));
  },
  onUpdateState: (callback) => {
    ipcRenderer.on("update-state", (_event, data) => callback(data));
  },
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  installUpdate: () => ipcRenderer.send("install-update"),
  onOpenSettings: (callback) => {
    ipcRenderer.on("open-settings", () => callback());
  },
  onMinuteTick: (callback) => {
    ipcRenderer.on("minute:tick", (_event, ts) => callback(ts));
  },
});
