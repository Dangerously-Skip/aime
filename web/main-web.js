/**
 * Electron main process for the Next.js web version.
 * Opens a single BrowserWindow pointing at a dynamically selected localhost port.
 */
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");
const net = require("net");

// --- File Logger ---
// Captures console output to a rotating log file for diagnostics.
const LOG_DIR = path.join(app.getPath("userData"), "logs");
const LOG_FILE = path.join(LOG_DIR, "quarry.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB — rotate when exceeded

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function rotateLogIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_LOG_SIZE) {
      const rotated = path.join(LOG_DIR, "quarry.log.1");
      fs.renameSync(LOG_FILE, rotated);
    }
  } catch {}
}

let logStream = null;
function initLogger() {
  ensureLogDir();
  rotateLogIfNeeded();
  logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

  const timestamp = () => new Date().toISOString();
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = (...args) => {
    const line = `[${timestamp()}] [LOG] ${args.map(String).join(" ")}\n`;
    logStream.write(line);
    origLog.apply(console, args);
  };
  console.error = (...args) => {
    const line = `[${timestamp()}] [ERR] ${args.map(String).join(" ")}\n`;
    logStream.write(line);
    origError.apply(console, args);
  };
  console.warn = (...args) => {
    const line = `[${timestamp()}] [WRN] ${args.map(String).join(" ")}\n`;
    logStream.write(line);
    origWarn.apply(console, args);
  };
}
initLogger();

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
        { type: "separator" },
        {
          label: "View Logs",
          accelerator: "CmdOrCtrl+Shift+L",
          click: () => shell.openPath(LOG_FILE),
        },
        {
          label: "Open Logs Folder",
          click: () => shell.openPath(LOG_DIR),
        },
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
    // Windows / Linux Help menu — gives users a manual "Check for Updates"
    // affordance. macOS already has it under the app menu (above).
    ...(isMac
      ? []
      : [
          {
            label: "Help",
            submenu: [
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
              { label: "About Quarry", click: () => app.showAboutPanel?.() },
            ],
          },
        ]),
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
      partition: "persist:quarry",
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
      identity: {
        app: 'quarry',
        app_version: pkg.version ?? '1.0.0',
        platform: process.platform,
        hostname: os.hostname(),
      },
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

/**
 * Patch known-broken MCP URLs in ~/.claude/.quarry-mcp.json so users don't
 * have to manually reconnect when we find and fix URL bugs in the registry.
 */
function migrateMcpConfig() {
  try {
    const fs = require("fs");
    const path = require("path");
    const configPath = path.join(os.homedir(), ".claude", ".quarry-mcp.json");
    if (!fs.existsSync(configPath)) return;

    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    if (!config.mcpServers) return;

    let changed = false;
    const servers = config.mcpServers;

    // Fix Miro — the actual MCP JSON-RPC endpoint is at / not /mcp
    if (servers["nib-mcp-miro"]?.url === "https://mcp.miro.com/mcp") {
      servers["nib-mcp-miro"].url = "https://mcp.miro.com/";
      changed = true;
      console.log("[Quarry] Migrated Miro MCP URL (/mcp -> /)");
    }

    // Fix AWS — switch from non-existent npm package to AWS Labs' Python MCP via uvx
    const aws = servers["nib-connector-aws"];
    if (aws && Array.isArray(aws.args) && aws.args.some((a) => typeof a === "string" && a.includes("@aws/mcp-server-aws"))) {
      aws.command = "uvx";
      aws.args = ["awslabs.core-mcp-server@latest"];
      changed = true;
      console.log("[Quarry] Migrated AWS MCP to awslabs.core-mcp-server via uvx");
    }

    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    }
  } catch (err) {
    console.warn("[Quarry] MCP config migration failed:", err.message);
  }
}

/**
 * Copy bundled Quarry skills plugin to ~/.claude/plugins/quarry-skills so the
 * Agent SDK picks them up. Runs on every app start so updates ship with releases.
 * Skipped silently if the source doesn't exist (e.g. local dev without bundled resources).
 */
function installBundledSkills() {
  try {
    const fs = require("fs");
    const path = require("path");
    const srcDir = app.isPackaged
      ? path.join(process.resourcesPath, "quarry-skills")
      : path.join(__dirname, "resources", "quarry-skills");

    if (!fs.existsSync(srcDir)) return;

    const destDir = path.join(os.homedir(), ".claude", "plugins", "quarry-skills");
    fs.mkdirSync(path.dirname(destDir), { recursive: true });

    // Remove and recopy so updates land every launch
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.cpSync(srcDir, destDir, { recursive: true });
    console.log("[Quarry] Installed bundled skills at:", destDir);
  } catch (err) {
    console.warn("[Quarry] Failed to install bundled skills:", err.message);
  }
}

app.whenReady().then(async () => {
  migrateMcpConfig();
  installBundledSkills();

  // Determine the port: dev-with-port.js sets PORT in env; for packaged builds we find one here.
  let port = parseInt(process.env.PORT || '0', 10);
  if (!port) {
    // Use a fixed port for packaged builds so localStorage persists across launches.
    // Fall back to a random port if the preferred one is in use.
    if (app.isPackaged) {
      const preferred = 19532;
      try {
        await new Promise((resolve, reject) => {
          const s = net.createServer().listen(preferred, '127.0.0.1', () => {
            s.close(() => resolve(undefined));
          });
          s.on('error', reject);
        });
        port = preferred;
      } catch {
        port = await findFreePort();
      }
    } else {
      port = await findFreePort();
    }
  }
  // Make PORT available to child processes and sendLifecycleEvent
  process.env.PORT = String(port);

  // In packaged builds, spawn the Next.js standalone server ourselves.
  if (app.isPackaged) {
    const fs = require("fs");
    const { utilityProcess } = require("electron");
    const standaloneDir = path.join(process.resourcesPath, '.next', 'standalone', 'web');
    const serverScript = path.join(standaloneDir, 'server.js');

    // Debug: verify paths exist
    console.log('[Quarry] resourcesPath:', process.resourcesPath);
    console.log('[Quarry] standaloneDir:', standaloneDir);
    console.log('[Quarry] serverScript:', serverScript);
    console.log('[Quarry] serverScript exists:', fs.existsSync(serverScript));
    console.log('[Quarry] standaloneDir contents:', fs.existsSync(standaloneDir) ? fs.readdirSync(standaloneDir).slice(0, 20) : 'DIR NOT FOUND');
    console.log('[Quarry] .next dir exists:', fs.existsSync(path.join(standaloneDir, '.next')));
    console.log('[Quarry] starting server on port:', port);

    if (!fs.existsSync(serverScript)) {
      // Try to find server.js anywhere in resources
      const findServer = (dir, depth = 0) => {
        if (depth > 3) return [];
        const results = [];
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'server.js' && entry.isFile()) results.push(path.join(dir, entry.name));
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
              results.push(...findServer(path.join(dir, entry.name), depth + 1));
            }
          }
        } catch {}
        return results;
      };
      console.log('[Quarry] server.js NOT FOUND at expected path. Searching...');
      console.log('[Quarry] found:', findServer(process.resourcesPath));
      dialog.showErrorBox('Quarry - Server Not Found', `Could not find server.js at:\n${serverScript}\n\nresourcesPath: ${process.resourcesPath}`);
      app.quit();
      return;
    }

    // Resolve where to point the Claude Agent SDK at cli.js.
    //
    // macOS: Gatekeeper/SIP can block executing JS that's inside a signed
    // .app bundle in some configurations, so we copy cli.js + its vendor
    // dir to userData/claude-sdk/ first.
    //
    // Windows/Linux: no equivalent restriction — execute directly from the
    // bundled location. The previous unconditional copy was failing on
    // Windows (likely AV/permissions) but the env var still pointed at the
    // missing destination, producing "Claude Code executable not found".
    const sdkSrcPath = path.join(standaloneDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js');
    const sdkDestDir = path.join(app.getPath('userData'), 'claude-sdk');
    const sdkDestPath = path.join(sdkDestDir, 'cli.js');
    const sdkMarkerPath = path.join(app.getPath('userData'), '.quarry-sdk-path');

    let sdkCliPath = sdkSrcPath;
    if (process.platform === 'darwin') {
      try {
        fs.mkdirSync(sdkDestDir, { recursive: true });
        fs.copyFileSync(sdkSrcPath, sdkDestPath);
        fs.chmodSync(sdkDestPath, 0o755);
        const vendorSrc = path.join(standaloneDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor');
        const vendorDest = path.join(sdkDestDir, 'vendor');
        if (fs.existsSync(vendorSrc) && !fs.existsSync(vendorDest)) {
          fs.cpSync(vendorSrc, vendorDest, { recursive: true });
        }
        sdkCliPath = sdkDestPath;
        console.log('[Quarry] SDK cli.js copied to:', sdkDestPath);
      } catch (e) {
        console.warn('[Quarry] SDK copy failed, falling back to in-bundle path:', e.message);
      }
    }

    // Final sanity check — only export the path if the file actually exists,
    // otherwise let the SDK's own resolution kick in (which may still fail,
    // but with a more useful error than a stale env var).
    if (!fs.existsSync(sdkCliPath)) {
      console.warn('[Quarry] Claude SDK cli.js not found at:', sdkCliPath);
      sdkCliPath = '';
    }
    fs.writeFileSync(sdkMarkerPath, sdkCliPath || sdkSrcPath, 'utf-8');

    const child = utilityProcess.fork(serverScript, [], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
        QUARRY_RESOURCES_PATH: process.resourcesPath,
        ...(sdkCliPath ? { QUARRY_SDK_CLI_PATH: sdkCliPath } : {}),
        // Point the SDK's config dir to Quarry's own directory so it doesn't
        // write to ~/.claude/settings.json (which belongs to Claude Code).
        CLAUDE_CONFIG_DIR: path.join(os.homedir(), '.quarry'),
        // Use platform-correct PATH separator (`:` on Unix, `;` on Windows)
        // and only prepend the Unix Homebrew/system paths on Unix.
        PATH: (process.platform === 'win32'
          ? [process.env.PATH]
          : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', process.env.PATH]
        ).filter(Boolean).join(path.delimiter),
      },
      stdio: 'pipe',
    });

    child.stderr.on('data', (data) => console.error('[Next.js server]', data.toString()));
    child.stdout.on('data', (data) => console.log('[Next.js server]', data.toString()));
    child.on('exit', (code) => console.error('[Quarry] Next.js server exited with code:', code));

    try {
      await waitForPort(port);
    } catch (err) {
      console.error('Failed to start production server:', err.message);
      dialog.showErrorBox('Quarry - Server Failed', `The Next.js server failed to start on port ${port}.\n\nCheck Console.app for logs.`);
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
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

  // Create a persistent partition for the browser webview so it behaves like a real browser
  const browserSession = session.fromPartition("persist:browser");
  browserSession.setUserAgent(CHROME_UA);
  browserSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(true));
  browserSession.setPermissionCheckHandler(() => true);
  // Spoof client hints so Google OAuth doesn't reject us as an embedded browser
  browserSession.webRequest.onBeforeSendHeaders({ urls: ["*://*.google.com/*", "*://*.googleapis.com/*", "*://*.gstatic.com/*"] }, (details, callback) => {
    details.requestHeaders["sec-ch-ua"] = '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"';
    details.requestHeaders["sec-ch-ua-mobile"] = "?0";
    details.requestHeaders["sec-ch-ua-platform"] = '"macOS"';
    callback({ requestHeaders: details.requestHeaders });
  });

  // Also configure the default session and the main window partition
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(true));
  const mainSession = session.fromPartition("persist:quarry");
  mainSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(true));

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
      // Handle new-window requests (target=_blank, window.open, OAuth popups).
      // Open in a real BrowserWindow so multi-window flows (training modules,
      // OAuth) work properly. Use the same persistent session for cookie sharing.
      contents.setWindowOpenHandler(({ url }) => {
        const { BrowserWindow: BW } = require("electron");
        const popup = new BW({
          width: 1024,
          height: 768,
          parent: mainWindow,
          webPreferences: {
            partition: "persist:browser",
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        popup.loadURL(url);
        popup.webContents.setUserAgent(CHROME_UA);
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

app.on("activate", async () => {
  await app.whenReady();
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(parseInt(process.env.PORT || '3000', 10));
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

ipcMain.on("get-app-version", (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.on("get-nib-analytics-config", (event) => {
  const fs = require("fs");
  const path = require("path");
  const conf = path.join(os.homedir(), ".claude", "nib-analytics.conf");
  const result = {};
  try {
    const text = fs.readFileSync(conf, "utf-8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    // file missing or unreadable — return empty config
  }
  event.returnValue = result;
});

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
    // Use a unique partition per auth attempt so each connect starts with a clean
    // session (no cached cookies from previous logins). This ensures the user can
    // pick a different account or site when reconnecting.
    const authWindow = new BrowserWindow({
      width: 600,
      height: 700,
      parent: mainWindow,
      modal: false,
      title: "Connect Account",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: `connector-auth-${Date.now()}`,
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
