/**
 * Preload for the first-launch setup window (setup-window.html).
 *
 * That window used to run with `nodeIntegration: true, contextIsolation:
 * false`, so its page — and anything that page ever loaded — had `require`,
 * `child_process` and the whole filesystem. It needs four things: hear
 * progress, hear an error, say Retry, say Skip. This exposes exactly those,
 * and no IPC event objects (which carry the sender) cross the bridge.
 *
 * Sandbox-safe on purpose: it requires nothing but "electron", so the window
 * runs with `sandbox: true`. `createSetupBridge` is exported for tests; in a
 * plain Node process `require("electron")` is the binary's path, not the API,
 * so nothing is exposed there.
 */

function createSetupBridge(ipcRenderer) {
  return {
    /** `{ detail?: string, percent?: number }` for each progress report. */
    onProgress(callback) {
      ipcRenderer.on("setup:progress", (_event, msg) => {
        const m = msg && typeof msg === "object" ? msg : {};
        callback({
          detail: typeof m.detail === "string" ? m.detail : undefined,
          percent: typeof m.percent === "number" ? m.percent : undefined,
        });
      });
    },
    /** The failure message, as text. */
    onError(callback) {
      ipcRenderer.on("setup:error", (_event, message) => callback(String(message)));
    },
    retry() {
      ipcRenderer.send("setup:retry");
    },
    skip() {
      ipcRenderer.send("setup:skip");
    },
  };
}

const electron = require("electron");
if (electron && typeof electron === "object" && electron.contextBridge) {
  electron.contextBridge.exposeInMainWorld("setupAPI", createSetupBridge(electron.ipcRenderer));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createSetupBridge };
}
