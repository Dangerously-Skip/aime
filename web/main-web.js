/**
 * Electron main process for the Next.js web version.
 * Opens a single BrowserWindow pointing at a dynamically selected localhost port.
 */
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require("electron");
const os = require("os");
const path = require("path");
const net = require("net");

/** Find an available TCP port by binding to port 0 and reading the OS assignment. */
function findFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Poll until the given port accepts a TCP connection (server is ready). */
function waitForPort(port, timeout = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.on('connect', () => { socket.destroy(); resolve(); });
      socket.on('error', () => {
        if (Date.now() - start > timeout) {
          return reject(new Error(`Timed out waiting for port ${port}`));
        }
        setTimeout(attempt, 300);
      });
    }
    attempt();
  });
}

// --- Auto Updater ---
// Only active in packaged builds; disabled in dev to avoid errors.
let autoUpdater = null;
const isDev = !app.isPackaged;

if (!isDev) {
  try {
    autoUpdater = require("electron-updater").autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
  } catch (e) {
    console.warn("electron-updater not available:", e.message);
  }
}

// Update menu state — mirrors Claude Desktop UX
let updateMenuState = "idle"; // idle | checking | available | downloading | ready | error
let updateStatusLabel = null; // e.g. "Last checked: 2 minutes ago" or error message
let updateCheckMenuItem = null;
let updateStatusMenuItem = null;

function buildAppMenu() {
  const isMac = process.platform === "darwin";

  const checkLabel = {
    idle: "Check for Updates…",
    checking: "Checking for Updates…",
    available: "Downloading Update…",
    downloading: "Downloading Update…",
    ready: "Restart to Install Update",
    error: "Check for Updates…",
  }[updateMenuState];

  const template = [
    // macOS app menu
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Settings…",
                accelerator: "CmdOrCtrl+,",
                click: () => {
                  if (mainWindow) mainWindow.webContents.send("open-settings");
                },
              },
              { type: "separator" },
              {
                label: checkLabel,
                enabled: updateMenuState === "idle" || updateMenuState === "error" || updateMenuState === "ready",
                click: () => {
                  if (updateMenuState === "ready" && autoUpdater) {
                    autoUpdater.quitAndInstall();
                  } else {
                    checkForUpdates(true);
                  }
                },
              },
              ...(updateStatusLabel
                ? [{ label: updateStatusLabel, enabled: false }]
                : []),
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(isMac
          ? [
              { role: "pasteAndMatchStyle" },
              { role: "delete" },
              { role: "selectAll" },
            ]
          : [{ role: "delete" }, { type: "separator" }, { role: "selectAll" }]),
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" }, { role: "front" }]
          : [{ role: "close" }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setUpdateState(state, statusLabel = null) {
  updateMenuState = state;
  updateStatusLabel = statusLabel;
  buildAppMenu();
  // Notify renderer so it can show in-app banners if needed
  if (mainWindow) {
    mainWindow.webContents.send("update-state", { state, statusLabel });
  }
}

function checkForUpdates(manual = false) {
  if (isDev || !autoUpdater) {
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Updates",
        message: "Auto-updates are only available in the packaged app.",
        detail: "Run `npm run dist` to build a distributable version.",
        buttons: ["OK"],
      });
    }
    return;
  }
  setUpdateState("checking");
  autoUpdater.checkForUpdates().catch((err) => {
    const msg = `Last update attempt failed: ${err.message}`;
    setUpdateState("error", msg);
  });
}

// Suppress GUEST_VIEW_MANAGER_CALL errors — these are benign Electron internal
// webview navigation failures (e.g. Google CAPTCHA redirects) that get logged
// by Electron's IPC dispatch but are not real crashes.
const _origConsoleError = console.error;
console.error = (...args) => {
  const msg = typeof args[0] === "string" ? args[0] : "";
  if (msg.includes("GUEST_VIEW_MANAGER_CALL")) return;
  _origConsoleError.apply(console, args);
};

app.setName("Quarry");

let mainWindow;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Quarry",
    titleBarStyle: "hiddenInset",
    icon: path.join(__dirname, "public", "app-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload-web.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Auto-updater event handlers
if (autoUpdater) {
  autoUpdater.on("checking-for-update", () => {
    setUpdateState("checking");
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState("available", `Downloading v${info.version}…`);
  });

  autoUpdater.on("update-not-available", () => {
    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setUpdateState("idle", `Last checked: ${now}`);
  });

  autoUpdater.on("download-progress", (progress) => {
    const pct = Math.round(progress.percent);
    setUpdateState("downloading", `Downloading update… ${pct}%`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState("ready", `v${info.version} ready — restart to install`);
    // Show native dialog offering to restart now
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update Ready",
        message: `Quarry ${info.version} is ready to install`,
        detail: "Restart now to apply the update, or install it the next time you quit.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on("error", (err) => {
    setUpdateState("error", `Last update attempt failed`);
    console.error("Auto-updater error:", err);
  });
}

/** Send an app_lifecycle telemetry event to the Next.js API. */
function sendLifecycleEvent(action) {
  const pkg = (() => { try { return require('./package.json'); } catch { return {}; } })();
  const payload = {
    events: [{
      schema_version: '1.0',
      event_type: 'app_lifecycle',
      timestamp: new Date().toISOString(),
      identity: { app_version: pkg.version ?? '1.0.0' },
      data: { action, app_version: pkg.version ?? '1.0.0' },
    }],
    flush: action === 'close',
  };
  // Fire-and-forget — use http to avoid ESM import issues in main process
  try {
    const http = require('http');
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: 'localhost',
      port: parseInt(process.env.PORT || '3000', 10),
      path: '/api/telemetry/events',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    });
    req.write(body);
    req.end();
  } catch {
    // Non-fatal
  }
}

app.whenReady().then(async () => {
  // Determine the port: dev-with-port.js sets PORT in env; for packaged builds we find one here.
  let port = parseInt(process.env.PORT || '0', 10);
  if (!port) {
    port = await findFreePort();
  }
  // Make PORT available to child processes and sendLifecycleEvent
  process.env.PORT = String(port);

  // In packaged builds, spawn the Next.js standalone server ourselves.
  if (app.isPackaged) {
    const { utilityProcess } = require("electron");
    const standaloneDir = path.join(process.resourcesPath, '.next', 'standalone', 'web');
    const serverScript = path.join(standaloneDir, 'server.js');
    utilityProcess.fork(serverScript, [], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
      },
    });
    try {
      await waitForPort(port);
    } catch (err) {
      console.error('Failed to start production server:', err.message);
      app.quit();
      return;
    }
  }

  // Build the app menu (includes "Check for Updates…")
  buildAppMenu();

  // Set dock icon on macOS
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "public", "app-icon.png"));
  }

  // Configure webview sessions
  const { session } = require("electron");
  const CHROME_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

  // Create a persistent partition for the browser webview so it behaves like a real browser
  const browserSession = session.fromPartition("persist:browser");
  browserSession.setUserAgent(CHROME_UA);
  browserSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(true));
  browserSession.setPermissionCheckHandler(() => true);

  // Also configure the default session
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(true));

  // Configure webview contents on creation
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") {
      contents.setUserAgent(CHROME_UA);

      // Suppress navigation errors (e.g. redirects, cancelled navigations) — let the page handle them
      contents.on("did-fail-load", (_failEvent, errorCode, _errorDescription, _validatedURL) => {
        // -3 = ERR_ABORTED (redirects, captchas, cancelled navigations)
        // -2 = ERR_FAILED (generic, often from blocked resources)
        if (errorCode === -3 || errorCode === -2) return;
      });
      // Allow new-window requests (target=_blank links) to load in the same webview
      contents.setWindowOpenHandler(({ url }) => {
        contents.loadURL(url);
        return { action: "deny" };
      });
    }
  });

  // Suppress GUEST_VIEW_MANAGER_CALL errors (benign Electron internal webview warnings)
  process.on("uncaughtException", (err) => {
    if (err.message && err.message.includes("GUEST_VIEW_MANAGER_CALL")) return;
    console.error("Uncaught exception:", err);
  });

  // Also catch unhandled rejections from webview internal navigation failures
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (msg.includes("GUEST_VIEW_MANAGER_CALL") || msg.includes("(-3)") || msg.includes("(-2)")) return;
    console.error("Unhandled rejection:", reason);
  });

  createWindow(port);

  // Fire app_lifecycle open event after window is ready (slight delay so Next.js is up)
  setTimeout(() => sendLifecycleEvent('open'), 5000);

  // Check for updates 3s after launch (gives window time to finish loading)
  setTimeout(() => checkForUpdates(false), 3000);

  // Minute ticker — drives heartbeat and cron job evaluation in the renderer
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('minute:tick', Date.now());
    }
  }, 60_000);
});

app.on("before-quit", () => {
  sendLifecycleEvent('close');
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("get-user-name", () => {
  return os.userInfo().username;
});

ipcMain.handle("get-home-dir", () => os.homedir());

ipcMain.handle("open-path", async (_event, filePath) => {
  return shell.openPath(filePath);
});

ipcMain.handle("read-file", async (_event, filePath) => {
  const fs = require("fs");
  const path = require("path");
  const stats = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"];
  const binaryExts = [...imageExts, ".pdf", ".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt"];
  const isBinary = binaryExts.includes(ext);

  return {
    name: path.basename(filePath),
    path: filePath,
    size: stats.size,
    ext,
    content: isBinary
      ? fs.readFileSync(filePath).toString("base64")
      : fs.readFileSync(filePath, "utf-8"),
    encoding: isBinary ? "base64" : "utf-8",
  };
});

ipcMain.handle("write-file", async (_event, filePath, content) => {
  const fs = require("fs");
  const path = require("path");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
  return { success: true, path: filePath };
});

ipcMain.handle("save-file-dialog", async (_event, defaultName, filters) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: filters || [{ name: "All Files", extensions: ["*"] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle("ensure-dir", async (_event, dirPath) => {
  const fs = require("fs");
  fs.mkdirSync(dirPath, { recursive: true });
  return { success: true };
});

ipcMain.handle("file-exists", async (_event, filePath) => {
  const fs = require("fs");
  return fs.existsSync(filePath);
});

ipcMain.on("check-for-updates", () => checkForUpdates(true));
ipcMain.on("install-update", () => {
  if (autoUpdater) autoUpdater.quitAndInstall();
});

ipcMain.handle("show-notification", async (_event, title, body) => {
  const { Notification } = require("electron");
  if (Notification.isSupported()) {
    const notif = new Notification({ title, body });
    notif.show();
    notif.on("click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  }
});

ipcMain.handle("open-auth-window", async (_event, url) => {
  const authWindow = new BrowserWindow({
    width: 600,
    height: 700,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  authWindow.loadURL(url);
  authWindow.webContents.on("will-redirect", (_e, redirectUrl) => {
    // When GitHub redirects back to our callback, the callback page
    // will postMessage to the opener. In Electron we forward this
    // to the main window.
    if (redirectUrl.includes("/api/auth/github/callback")) {
      authWindow.webContents.on("did-finish-load", () => {
        authWindow.webContents
          .executeJavaScript(
            `new Promise(resolve => {
              window.addEventListener('message', (e) => resolve(e.data), { once: true });
              // The callback page posts to opener; in Electron there's no opener,
              // so we intercept the script and post to self.
              setTimeout(() => resolve(null), 5000);
            })`
          )
          .then((data) => {
            if (data && mainWindow) {
              mainWindow.webContents.send("github-auth-result", data);
            }
            authWindow.close();
          })
          .catch(() => authWindow.close());
      });
    }
  });
});

// Generic OAuth connector auth window — intercepts the callback redirect,
// extracts the code/state/error from the URL, and returns them directly
// to the renderer without needing a running localhost server.
ipcMain.handle("open-connector-auth-window", async (_event, url, callbackPath) => {
  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindow({
      width: 600,
      height: 700,
      parent: mainWindow,
      modal: false,
      title: "Connect Account",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    let resolved = false;

    // Intercept all navigation — check if it's heading to our callback path
    const checkForCallback = (navUrl) => {
      if (resolved) return;
      try {
        const parsed = new URL(navUrl);
        if (parsed.pathname === callbackPath) {
          resolved = true;
          const code = parsed.searchParams.get("code");
          const state = parsed.searchParams.get("state");
          const error = parsed.searchParams.get("error");
          const errorDescription = parsed.searchParams.get("error_description");
          authWindow.close();
          resolve({ code, state, error: error || errorDescription || null });
        }
      } catch {
        // Not a valid URL, ignore
      }
    };

    authWindow.webContents.on("will-navigate", (_e, navUrl) => checkForCallback(navUrl));
    authWindow.webContents.on("will-redirect", (_e, navUrl) => checkForCallback(navUrl));

    authWindow.on("closed", () => {
      if (!resolved) {
        resolve({ code: null, state: null, error: "canceled" });
      }
    });

    authWindow.loadURL(url);
  });
});
