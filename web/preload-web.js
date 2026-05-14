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
  getAppVersion: () => ipcRenderer.sendSync("get-app-version"),
  getNibAnalyticsConfig: () => ipcRenderer.sendSync("get-nib-analytics-config"),
  getPlatform: () => process.platform,
  getHostname: () => require("os").hostname(),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  installUpdate: () => ipcRenderer.send("install-update"),
  onOpenSettings: (callback) => {
    ipcRenderer.on("open-settings", () => callback());
  },
  onMinuteTick: (callback) => {
    ipcRenderer.on("minute:tick", (_event, ts) => callback(ts));
  },

  // ── IDE workspace IPC ────────────────────────────────────────────────
  // Wave 1 declares; Wave 2 agents fill the main-side implementations.
  // Stubs in main-web.js return safe defaults so the renderer doesn't
  // crash if a handler isn't implemented yet.

  // Filesystem
  fsWalk: (path, opts) => ipcRenderer.invoke("fs:walk", path, opts),
  fsRead: (path) => ipcRenderer.invoke("fs:read", path),
  fsWatchStart: (path) => ipcRenderer.invoke("fs:watch-start", path),
  fsWatchStop: (watchId) => ipcRenderer.invoke("fs:watch-stop", watchId),
  onFsChange: (callback) => {
    const listener = (_event, evt) => callback(evt);
    ipcRenderer.on("fs:change", listener);
    return () => ipcRenderer.removeListener("fs:change", listener);
  },

  // Git
  gitStatus: (cwd) => ipcRenderer.invoke("git:status", cwd),
  gitDiff: (cwd, opts) => ipcRenderer.invoke("git:diff", cwd, opts),
  gitBranches: (cwd) => ipcRenderer.invoke("git:branches", cwd),
  gitLog: (cwd, opts) => ipcRenderer.invoke("git:log", cwd, opts),
  gitBlame: (cwd, path) => ipcRenderer.invoke("git:blame", cwd, path),

  // PTY
  ptyOpen: (opts) => ipcRenderer.invoke("pty:open", opts),
  ptyInput: (id, data) => ipcRenderer.invoke("pty:input", id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.invoke("pty:resize", id, cols, rows),
  ptyClose: (id) => ipcRenderer.invoke("pty:close", id),
  onPtyOutput: (callback) => {
    const listener = (_event, evt) => callback(evt);
    ipcRenderer.on("pty:output", listener);
    return () => ipcRenderer.removeListener("pty:output", listener);
  },
  onPtyExit: (callback) => {
    const listener = (_event, evt) => callback(evt);
    ipcRenderer.on("pty:exit", listener);
    return () => ipcRenderer.removeListener("pty:exit", listener);
  },
});
