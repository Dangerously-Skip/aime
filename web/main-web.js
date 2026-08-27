/**
 * Electron main process for the Next.js web version.
 * Opens a single BrowserWindow pointing at a dynamically selected localhost port.
 */
const { app, BrowserWindow, dialog, ipcMain, shell, Menu, globalShortcut } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { pathToFileURL } = require("url");
const setupHandler = require("./setup-handler");
const ptyManager = require("./src/lib/code-workspace/pty-manager");

// Bash-produced artifact paths often contain a literal `~` (e.g. the nib-ppt
// generate_presentation.sh script writes to `~/foo.pptx`). Node fs APIs do not
// expand `~` — that's a shell concept — so passing the raw path to statSync
// errors with ENOENT. Expand it here so every IPC file handler is `~`-safe.
function expandHome(p) {
  if (typeof p !== "string") return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// --- File Logger ---
// Captures console output to a rotating log file for diagnostics.
// Migrate Electron userData from the pre-rename "Quarry" install (session
// partitions incl. renderer localStorage, logs, caches). Must run before
// anything touches userData. Best-effort same-volume rename.
try {
  const appData = app.getPath("appData");
  const legacyUserData = path.join(appData, "Quarry");
  const newUserData = path.join(appData, "AIME");
  if (!fs.existsSync(newUserData) && fs.existsSync(legacyUserData)) {
    fs.renameSync(legacyUserData, newUserData);
    console.log("[AIME] Migrated userData from", legacyUserData);
  }
} catch (err) {
  console.warn("[AIME] userData migration skipped:", err.message);
}

const LOG_DIR = path.join(app.getPath("userData"), "logs");
const LOG_FILE = path.join(LOG_DIR, "aime.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB — rotate when exceeded

// Master key for the server's BYOK credential store (AES-256-GCM). The 32-byte
// key is kept in the OS keychain via Electron safeStorage and injected into the
// Next server as AIME_CRED_KEY (hex). The server never sees the keychain; the
// renderer never sees the key. Falls back to a 0600 plaintext file only when no
// OS keyring is available (headless Linux) — logged so it's not silent.
let cachedCredentialKeyHex = null;

/**
 * The local API's launch token.
 *
 * Minted here, per launch, and never written to disk. It reaches the Next server
 * as AIME_API_TOKEN and the renderer as a one-time `?t=` on the initial load,
 * which the middleware exchanges for an HttpOnly SameSite=Strict cookie and then
 * strips from the URL.
 *
 * `process.env.AIME_API_TOKEN` wins when already set, because in development
 * `dev-with-port.js` starts the Next server and therefore mints it first — both
 * halves have to agree on the same value or the window can never authenticate.
 *
 * Loopback binding was never sufficient on its own: any page in any browser on
 * this machine can fetch `http://localhost:<port>/api/...`. See
 * `src/lib/auth/local-token.ts`.
 */
const API_TOKEN =
  process.env.AIME_API_TOKEN || require("crypto").randomBytes(32).toString("hex");
process.env.AIME_API_TOKEN = API_TOKEN;
function getCredentialKeyHex() {
  if (cachedCredentialKeyHex) return cachedCredentialKeyHex;
  try {
    const { safeStorage } = require("electron");
    const { readOrCreateKey } = require("./credential-key");
    cachedCredentialKeyHex = readOrCreateKey({
      keyPath: path.join(app.getPath("userData"), "credential-master.key"),
      safeStorage,
      warn: (msg) => console.warn(`[AIME] ${msg}`),
    });
  } catch (err) {
    console.error("[AIME] Could not provision credential master key:", err.message);
    cachedCredentialKeyHex = null;
  }
  return cachedCredentialKeyHex;
}

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function rotateLogIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_LOG_SIZE) {
      const rotated = path.join(LOG_DIR, "aime.log.1");
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

// --- Analytics config (opt-in) ---
// Telemetry is disabled unless ANALYTICS_API_URL is set in the environment
// (or ~/.claude/analytics.conf for packaged installs). No default endpoint.
function readAnalyticsConf() {
  const conf = path.join(os.homedir(), ".claude", "analytics.conf");
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
    // file missing or unreadable — caller treats as empty
  }
  return result;
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
              { label: "About AIME", click: () => app.showAboutPanel?.() },
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

app.setName("AIME");

let mainWindow;

// --- Single instance ---
// A second instance is not merely redundant, it is silently BROKEN. Chromium's
// Local Storage is a LevelDB with a single-writer lock, and every window here
// uses the on-disk `persist:quarry` partition — so the second process cannot
// open it, gets an empty in-memory store instead, and NOTHING it writes
// survives. The visible symptom is that onboarding can never be completed: the
// wizard finishes in memory, the next launch has no record of it, and the user
// is returned to the first step forever. Settings, conversations and connector
// state are lost the same way, just less visibly.
//
// Requested after setName() so the lock is keyed to the same userData directory
// the sessions use, and before any window or session is created.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.warn("[AIME] Another instance is already running — focusing it and exiting.");
  app.exit(0);
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "AIME",
    titleBarStyle: "hiddenInset",
    icon: path.join(__dirname, "public", "app-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload-web.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      partition: "persist:quarry", // KEEP: renaming would orphan renderer localStorage (conversations/settings) stored in this on-disk partition
    },
  });

  // `?t=` is exchanged by the middleware for an HttpOnly cookie and then
  // redirected away, so the token does not linger in window.location.
  mainWindow.loadURL(`http://localhost:${port}/?t=${API_TOKEN}`);

  // External http(s) links (target=_blank, window.open, shell.openExternal) open
  // in the user's default browser rather than a detached Electron BrowserWindow.
  // The user is almost always already signed in there (Jira/GitHub/Confluence/etc.),
  // and detached Electron windows don't share their session. Webview contents
  // inside preview-panel / browser-surface keep their own handler set elsewhere.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

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
        message: `AIME ${info.version} is ready to install`,
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

/**
 * Send an app_lifecycle telemetry event to the Next.js API.
 * Returns a Promise that resolves once the request completes (or after a
 * short timeout). Caller may ignore the promise for fire-and-forget use, or
 * await it (e.g. in `before-quit`) to ensure delivery before exit.
 */
function sendLifecycleEvent(action) {
  const pkg = (() => { try { return require('./package.json'); } catch { return {}; } })();
  const payload = {
    events: [{
      schema_version: '1.0',
      event_type: 'app_lifecycle',
      timestamp: new Date().toISOString(),
      identity: {
        app: 'aime',
        app_version: pkg.version ?? '1.0.0',
        platform: process.platform,
        hostname: os.hostname(),
      },
      data: { action, app_version: pkg.version ?? '1.0.0' },
    }],
    flush: action === 'close',
  };
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    // 2s budget — long enough for a healthy ingest, short enough that quitting
    // never feels stuck if the API or the local Next.js server is unreachable.
    const timer = setTimeout(finish, 2000);
    try {
      const http = require('http');
      const body = JSON.stringify(payload);
      const req = http.request({
        hostname: '127.0.0.1',
        port: parseInt(process.env.PORT || '3000', 10),
        path: '/api/telemetry/events',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        res.resume();
        res.on('end', () => { clearTimeout(timer); finish(); });
      });
      req.on('error', () => { clearTimeout(timer); finish(); });
      req.write(body);
      req.end();
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
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
      console.log("[AIME] Migrated Miro MCP URL (/mcp -> /)");
    }

    // Fix AWS — switch from non-existent npm package to AWS Labs' Python MCP via uvx
    const aws = servers["nib-connector-aws"];
    if (aws && Array.isArray(aws.args) && aws.args.some((a) => typeof a === "string" && a.includes("@aws/mcp-server-aws"))) {
      aws.command = "uvx";
      aws.args = ["awslabs.core-mcp-server@latest"];
      changed = true;
      console.log("[AIME] Migrated AWS MCP to awslabs.core-mcp-server via uvx");
    }

    if (changed) {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    }
  } catch (err) {
    console.warn("[AIME] MCP config migration failed:", err.message);
  }
}

/**
 * Copy the bundled AIME skills plugin to ~/.claude/plugins/quarry-skills so the
 * Agent SDK picks them up. Runs on every app start so updates ship with releases.
 * Skipped silently if the source doesn't exist (e.g. local dev without bundled resources).
 */
function installBundledSkills() {
  try {
    const fs = require("fs");
    const path = require("path");
    const srcDir = app.isPackaged
      ? path.join(process.resourcesPath, "aime-skills")
      : path.join(__dirname, "resources", "aime-skills");

    if (!fs.existsSync(srcDir)) return;

    const destDir = path.join(os.homedir(), ".claude", "plugins", "aime-skills");
    // Remove the pre-rename plugin dir so the SDK plugin scan does not load duplicates
    fs.rmSync(path.join(os.homedir(), ".claude", "plugins", "quarry-skills"), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destDir), { recursive: true });

    // Sync rather than wipe: this directory also holds things the USER creates
    // (a filled-in brand-guidelines, their own skills), and the old
    // remove-and-recopy deleted them on every launch. See bundled-install.js.
    const { syncBundledDir } = require("./bundled-install.js");
    const r = syncBundledDir(srcDir, destDir);
    console.log(
      `[AIME] Installed bundled skills at: ${destDir} ` +
        `(${r.written} bundled, ${r.removed} withdrawn, ${r.preserved} user files kept)`,
    );
  } catch (err) {
    console.warn("[AIME] Failed to install bundled skills:", err.message);
  }
}

/**
 * Copy the bundled ppt plugin to ~/.claude/plugins/ppt/ so its
 * SKILL.md (installed separately into ~/.claude/skills/) can resolve the
 * generate_presentation.sh script reference. Mirrors installBundledSkills.
 */
/**
 * Copy the bundled HTML-deck assets (MIT, from nexu-io/open-design) to
 * ~/.claude/plugins/html-deck/ so the `deck-html` skill can reference the
 * themes and runtime by absolute path.
 */
function installHtmlDeck() {
  try {
    const srcDir = app.isPackaged
      ? path.join(process.resourcesPath, "html-deck")
      : path.join(__dirname, "resources", "html-deck");
    if (!fs.existsSync(srcDir)) return;
    const destDir = path.join(os.homedir(), ".claude", "plugins", "html-deck");
    const { syncBundledDir } = require("./bundled-install.js");
    const r = syncBundledDir(srcDir, destDir);
    console.log(
      `[AIME] Installed html-deck at: ${destDir} ` +
        `(${r.written} bundled, ${r.preserved} user files kept)`,
    );
  } catch (err) {
    console.warn("[AIME] Failed to install html-deck:", err.message);
  }
}

/**
 * Copy the bundled web templates (Apache-2.0, from nexu-io/open-design) to
 * ~/.claude/plugins/web-templates/ for the `wireframe` and `web-prototype`
 * skills. Kept separate from html-deck because the licences differ.
 */
function installWebTemplates() {
  try {
    const srcDir = app.isPackaged
      ? path.join(process.resourcesPath, "web-templates")
      : path.join(__dirname, "resources", "web-templates");
    if (!fs.existsSync(srcDir)) return;
    const destDir = path.join(os.homedir(), ".claude", "plugins", "web-templates");
    const { syncBundledDir } = require("./bundled-install.js");
    const r = syncBundledDir(srcDir, destDir);
    console.log(
      `[AIME] Installed web-templates at: ${destDir} ` +
        `(${r.written} bundled, ${r.preserved} user files kept)`,
    );
  } catch (err) {
    console.warn("[AIME] Failed to install web-templates:", err.message);
  }
}

function installPptPlugin() {
  try {
    const srcDir = app.isPackaged
      ? path.join(process.resourcesPath, "ppt-plugin")
      : path.join(__dirname, "resources", "ppt-plugin");
    if (!fs.existsSync(srcDir)) return;

    const destDir = path.join(os.homedir(), ".claude", "plugins", "ppt");
    // Remove the pre-rename plugin dir so the SDK plugin scan does not load duplicates
    fs.rmSync(path.join(os.homedir(), ".claude", "plugins", "nib-ppt"), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    // Sync rather than wipe — `brands/` is where a user's own brand lives, and
    // remove-and-recopy deleted it every launch. See bundled-install.js.
    const { syncBundledDir } = require("./bundled-install.js");
    const syncResult = syncBundledDir(srcDir, destDir);
    // Make the shell script executable on POSIX (cpSync drops the +x bit
    // on some filesystems, e.g. when the source lives inside an asar).
    if (process.platform !== "win32") {
      const script = path.join(destDir, "generate_presentation.sh");
      if (fs.existsSync(script)) fs.chmodSync(script, 0o755);
    }
    console.log(
      `[AIME] Installed ppt plugin at: ${destDir} ` +
        `(${syncResult.written} bundled, ${syncResult.removed} withdrawn, ` +
        `${syncResult.preserved} user files kept)`,
    );
  } catch (err) {
    console.warn("[AIME] Failed to install ppt plugin:", err.message);
  }
}

/**
 * Show the first-launch setup modal and run the Python + deps install.
 * Resolves to true if Python is set up (now or already was) and false if
 * the user chose to skip. Called before the main window opens, so users
 * see progress instead of a blank screen.
 *
 * Skipped silently in unpackaged dev mode — dev users have their own setup.
 */
async function ensureSetup() {
  if (!app.isPackaged) return true;
  if (setupHandler.isSetupComplete()) return true;

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 320,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "Setting up AIME",
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    win.loadFile(path.join(__dirname, "setup-window.html"));

    const onProgress = (msg) => {
      if (!win.isDestroyed()) win.webContents.send("setup:progress", msg);
    };

    let resolved = false;
    const finish = (ok) => {
      if (resolved) return;
      resolved = true;
      ipcMain.removeAllListeners("setup:retry");
      ipcMain.removeAllListeners("setup:skip");
      if (!win.isDestroyed()) win.close();
      resolve(ok);
    };

    const start = () => {
      setupHandler
        .runSetup(onProgress)
        .then(() => finish(true))
        .catch((err) => {
          console.error("[AIME] Setup failed:", err);
          if (!win.isDestroyed()) {
            win.webContents.send("setup:error", err.message || String(err));
          }
          // Don't finish — leave the user on the error screen so they can
          // hit Retry or Skip themselves.
        });
    };

    ipcMain.on("setup:retry", start);
    ipcMain.on("setup:skip", () => finish(false));
    // X-button / Cmd+W on the setup window: treat the same as Skip.
    win.on("closed", () => finish(false));

    start();
  });
}

/**
 * After the Next.js server is up, fire the System 2 install endpoint that
 * copies SKILL.md files from web/public/bundled-skills/ → ~/.claude/skills/.
 * Fire-and-forget; failure just means nib-pdf / nib-ppt skills won't load
 * this session. Idempotent server-side, so retried on next launch.
 */
function triggerBundledSkillInstall(port) {
  const http = require("http");
  const req = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/customize/skills/install-bundled",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "0" },
    },
    (res) => {
      res.resume();
      res.on("end", () => console.log("[AIME] Bundled-skills install:", res.statusCode));
    }
  );
  req.on("error", (err) => console.warn("[AIME] Bundled-skills install failed:", err.message));
  req.end();
}

app.whenReady().then(async () => {
  migrateMcpConfig();
  installBundledSkills();
  installPptPlugin();
  installHtmlDeck();
  installWebTemplates();
  await ensureSetup();

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

    // Point the Claude Agent SDK at the in-bundle cli.js. Earlier versions
    // copied cli.js to userData/claude-sdk/cli.js to dodge a hypothetical
    // Gatekeeper/SIP issue on macOS, but that broke native-binary resolution:
    // cli.js does Node's normal `node_modules` walk-up to load its platform-
    // specific sibling (e.g. @anthropic-ai/claude-agent-sdk-darwin-arm64).
    // When run from userData the sibling isn't on any walk-up path, hence
    // "Native CLI binary for darwin-arm64 not found". Keeping cli.js inside
    // its own npm package directory fixes both macOS and Windows in one go.
    const sdkSrcPath = path.join(standaloneDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js');
    const sdkMarkerPath = path.join(app.getPath('userData'), '.aime-sdk-path');
    const sdkCliPath = fs.existsSync(sdkSrcPath) ? sdkSrcPath : '';
    if (!sdkCliPath) {
      console.warn('[Quarry] Claude SDK cli.js not found at:', sdkSrcPath);
    }
    fs.writeFileSync(sdkMarkerPath, sdkCliPath || sdkSrcPath, 'utf-8');

    // The Claude Agent SDK on Windows shells out to bash for tool execution
    // and refuses to start without it. We bundle PortableGit in extraResources
    // (resources/portablegit/bin/bash.exe — MinGit explicitly omits bash) so
    // users don't have to install Git for Windows themselves. If the bundle
    // went missing (e.g. AV quarantined it), fall back to letting cli.js
    // search PATH — which produces a clear error pointing to the installer.
    let gitBashPath = '';
    if (process.platform === 'win32') {
      const candidate = path.join(process.resourcesPath, 'portablegit', 'bin', 'bash.exe');
      if (fs.existsSync(candidate)) {
        gitBashPath = candidate;
      } else {
        console.warn('[Quarry] Bundled PortableGit bash.exe not found at:', candidate);
      }
    }

    // First-launch-installed Python + Playwright. If setup was skipped,
    // these paths simply don't exist and skill scripts fall through to
    // whatever's on the user's PATH (or fail gracefully).
    const managedPython = setupHandler.pythonExe();
    const managedPythonAvailable = fs.existsSync(managedPython);
    const pythonBinDir = process.platform === 'win32'
      ? setupHandler.PYTHON_DIR
      : path.join(setupHandler.PYTHON_DIR, 'bin');
    const pythonScriptsDir = process.platform === 'win32'
      ? path.join(setupHandler.PYTHON_DIR, 'Scripts')
      : null;

    // Resolve analytics endpoint with precedence:
    //   1. ~/.claude/analytics.conf `endpoint=` (per-user override)
    //   2. ANALYTICS_API_URL from the process env
    // No built-in default — telemetry is opt-in and off otherwise.
    const analyticsConf = readAnalyticsConf();
    // Normalise: managed confs may bake the full path in (`…/v1/events`),
    // but analytics-client appends `/v1/events` itself. Strip a trailing
    // `/v1/events` so we don't end up POSTing to `…/v1/events/v1/events` (404).
    const rawEndpoint = (analyticsConf.endpoint || process.env.ANALYTICS_API_URL || '').replace(/\/+$/, '');
    const normalisedEndpoint = rawEndpoint.replace(/\/v1\/events$/, '');

    const child = utilityProcess.fork(serverScript, [], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
        ...(normalisedEndpoint ? { ANALYTICS_API_URL: normalisedEndpoint } : {}),
        ...(analyticsConf.region || process.env.ANALYTICS_AWS_REGION
          ? { ANALYTICS_AWS_REGION: analyticsConf.region || process.env.ANALYTICS_AWS_REGION }
          : {}),
        AIME_API_TOKEN: API_TOKEN,
        AIME_RESOURCES_PATH: process.resourcesPath,
        AIME_USER_DATA_DIR: app.getPath('userData'),
        ...(getCredentialKeyHex() ? { AIME_CRED_KEY: getCredentialKeyHex() } : {}),
        ...(sdkCliPath ? { AIME_SDK_CLI_PATH: sdkCliPath } : {}),
        ...(gitBashPath ? { CLAUDE_CODE_GIT_BASH_PATH: gitBashPath } : {}),
        ...(managedPythonAvailable ? {
          AIME_PYTHON: managedPython,
          PLAYWRIGHT_BROWSERS_PATH: setupHandler.PLAYWRIGHT_DIR,
        } : {}),
        // Point the SDK's config dir to Quarry's own directory so it doesn't
        // write to ~/.claude/settings.json (which belongs to Claude Code).
        CLAUDE_CONFIG_DIR: path.join(os.homedir(), '.quarry'),
        // Use platform-correct PATH separator (`:` on Unix, `;` on Windows)
        // and prepend Quarry's bundled Python (so skill scripts can call
        // `python` / `python3` / `pip` without knowing about ~/.quarry/) and
        // PortableGit's bash dir (Windows only) before the user's PATH.
        PATH: (process.platform === 'win32'
          ? [
              ...(managedPythonAvailable ? [pythonBinDir, pythonScriptsDir] : []),
              ...(gitBashPath ? [path.dirname(gitBashPath)] : []),
              process.env.PATH,
            ]
          : [
              ...(managedPythonAvailable ? [pythonBinDir] : []),
              '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin',
              process.env.PATH,
            ]
        ).filter(Boolean).join(path.delimiter),
      },
      stdio: 'pipe',
    });

    child.stderr.on('data', (data) => console.error('[Next.js server]', data.toString()));
    child.stdout.on('data', (data) => console.log('[Next.js server]', data.toString()));
    child.on('exit', (code) => console.error('[Quarry] Next.js server exited with code:', code));

    try {
      await waitForPort(port);
      // Server is up — kick off the System 2 bundled-skill install so
      // nib-pdf's and nib-ppt's SKILL.md land in ~/.claude/skills/. Idempotent;
      // safe to fire on every launch.
      triggerBundledSkillInstall(port);
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

let isQuitting = false;
app.on("before-quit", async (event) => {
  if (isQuitting) return;
  // Defer the actual quit until the close event has been delivered (or timed
  // out). Without this the Next.js child gets killed before the HTTP POST
  // finishes, dropping the queued events with it.
  event.preventDefault();
  isQuitting = true;
  // Tear down any live PTYs so child shells don't linger after Quarry exits.
  try {
    ptyManager.closeAll();
  } catch (err) {
    console.warn("[pty] closeAll on quit failed:", err?.message);
  }
  try {
    await sendLifecycleEvent('close');
  } catch {}
  app.quit();
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
// ── Document rendering (P4.2) ──────────────────────────────────────────
// Print themed HTML to PDF with Chromium, which Electron already ships. No
// Python, no pip install, no extra binary — and real typography, including the
// page-break control a hand-rolled generator never gets right.
//
// Rendered in an offscreen window with node integration OFF, sandboxed, script
// disabled and no preload, so the document has no bridge to the app even though
// its content is escaped upstream. Defence in depth: the renderer guarantees no
// executable markup, and this guarantees there would be nothing to reach if that
// ever failed.
//
// Takes the PATH the document was written to, not the markup — see the note on
// loadURL below for why that is both cheaper and no less safe.
ipcMain.handle("documents:print-pdf", async (_event, { htmlPath, outputPath, printOptions } = {}) => {
  if (typeof htmlPath !== "string" || typeof outputPath !== "string") {
    return { ok: false, error: "htmlPath and outputPath are required" };
  }
  // The window this opens can only fetch what it is pointed at, so what it is
  // pointed at is worth constraining: an absolute path to a document THIS app
  // wrote, not an arbitrary file promoted into a PDF the user then shares.
  const source = expandHome(htmlPath);
  if (!path.isAbsolute(source) || !/\.html?$/i.test(source)) {
    return { ok: false, error: "htmlPath must be an absolute path to an .html file" };
  }

  let win = null;
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false },
    });

    // Opened from disk, where the DocumentCreate tool already wrote it.
    //
    // This used to be a data URL, justified as keeping "the document off disk
    // entirely" — which was never true: the tool writes the HTML two statements
    // before it asks for the print, and leaves it there as the fallback
    // deliverable. All the data URL actually bought was four copies of the
    // document (SSE frame, renderer, IPC message, then ~3x inflation through
    // encodeURIComponent), measured at ~76KB for a 19.8KB file and linear in
    // document size.
    //
    // ORIGIN. file:// gives the page a file origin where the data URL gave it an
    // opaque one. That matters only to something that can act, and nothing here
    // can: `javascript: false` means no script runs at all, and the generator
    // (lib/documents/render) escapes raw HTML to text, allows only `data:image/`
    // in `<img src>`, and inlines every style — so there is no element in the
    // document that could reference a local file in the first place. A file
    // origin with no script and no external references has no capability an
    // opaque one withheld.
    //
    // pathToFileURL, not string concatenation: it escapes spaces and `#`, and
    // gets `C:\…` right on Windows.
    await win.loadURL(pathToFileURL(source).toString());

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      ...(printOptions || {}),
    });
    fs.writeFileSync(outputPath, pdf, { mode: 0o600 });
    return { ok: true, path: outputPath, bytes: pdf.length };
  } catch (err) {
    console.error("[AIME] PDF render failed:", err.message);
    return { ok: false, error: "Could not render the PDF" };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
});

// ── Push-to-talk global shortcut (P4.1) ────────────────────────────────
// The renderer asks main to hold or release the combination. Registering here
// rather than in the renderer is not a preference: a global shortcut has to be
// claimed from the OS, which only the main process can do.
//
// Toggle semantics, not hold-to-talk: globalShortcut delivers a press only —
// there is no keyup — so press-to-start / press-to-stop is what actually works.
//
// The registration is OWNED. `heldAccelerator` alone was not enough: the
// renderer mounts every surface at once, and each one asked main to release the
// shortcut on the way past, so whichever asked last unregistered the hotkey the
// active surface was holding. Tracking who asked lets main refuse a release from
// anyone who is not the owner, whatever the renderer does.
const DEFAULT_PUSH_TO_TALK = "CommandOrControl+Shift+Space";
let heldAccelerator = null;
let heldBy = null;

function releasePushToTalk() {
  if (!heldAccelerator) return;
  try {
    globalShortcut.unregister(heldAccelerator);
  } catch (err) {
    console.warn("[AIME] Could not unregister push-to-talk:", err.message);
  }
  heldAccelerator = null;
  heldBy = null;
}

ipcMain.handle("voice:set-push-to-talk", (_event, { enabled, accelerator, ownerId } = {}) => {
  const wanted = typeof accelerator === "string" && accelerator ? accelerator : DEFAULT_PUSH_TO_TALK;
  const owner = typeof ownerId === "string" && ownerId ? ownerId : null;
  const notOwner = heldAccelerator && heldBy && owner && heldBy !== owner;

  if (!enabled) {
    if (notOwner) {
      // Somebody who never registered anything is asking us to let go.
      return { ok: false, accelerator: heldAccelerator, reason: "not-owner" };
    }
    releasePushToTalk();
    return { ok: true, accelerator: null };
  }
  if (heldAccelerator === wanted && heldBy === owner) {
    return { ok: true, accelerator: heldAccelerator };
  }
  if (notOwner) {
    return {
      ok: false,
      accelerator: null,
      reason: "owned-elsewhere",
      message: "Another window already holds the push-to-talk shortcut.",
    };
  }

  releasePushToTalk();
  try {
    // register() returns false when another application already owns the
    // combination — a silent no-op unless we check, so the renderer is told.
    const registered = globalShortcut.register(wanted, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("voice:toggle");
      }
    });
    if (!registered) {
      console.warn("[AIME] Push-to-talk shortcut is already taken:", wanted);
      return {
        ok: false,
        accelerator: null,
        reason: "taken",
        message: `${wanted} is already in use by another application.`,
      };
    }
    heldAccelerator = wanted;
    heldBy = owner;
    return { ok: true, accelerator: heldAccelerator };
  } catch (err) {
    // A malformed accelerator throws; the renderer validates first, but a stored
    // setting from an older build could still be bad.
    console.warn("[AIME] Invalid push-to-talk accelerator", wanted, err.message);
    return {
      ok: false,
      accelerator: null,
      reason: "invalid",
      message: `${wanted} is not a key combination this system accepts.`,
    };
  }
});

// Global shortcuts outlive the window, so they must be given back explicitly or
// the combination stays stolen until the process exits.
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  heldAccelerator = null;
  heldBy = null;
});

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("get-user-name", () => {
  return os.userInfo().username;
});

/*
 * The renderer's self-heal path for a dead API session (see
 * components/api-session-guard.tsx). The window's HttpOnly cookie goes stale
 * when halves of the app restart apart — a dev-server respawn minted a fresh
 * AIME_API_TOKEN while the window kept the old cookie, and every /api call
 * 401'd forever with no recovery. Handing the CURRENT token back to the
 * renderer lets it re-run the same ?t= exchange the launch path uses.
 *
 * No new exposure: the token already rides `?t=` into this window on every
 * launch, the preload bridge is the app's own code, and without this the only
 * recovery was a full restart the user had to discover for themselves.
 */
ipcMain.handle("get-api-token", () => {
  return API_TOKEN;
});

ipcMain.handle("get-home-dir", () => os.homedir());

ipcMain.on("get-app-version", (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.on("get-analytics-config", (event) => {
  event.returnValue = readAnalyticsConf();
});

ipcMain.handle("open-path", async (_event, filePath) => {
  return shell.openPath(expandHome(filePath));
});

ipcMain.handle("read-file", async (_event, filePath) => {
  const resolved = expandHome(filePath);
  const stats = fs.statSync(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"];
  const binaryExts = [...imageExts, ".pdf", ".xlsx", ".xls", ".docx", ".doc", ".pptx", ".ppt"];
  const isBinary = binaryExts.includes(ext);

  return {
    name: path.basename(resolved),
    path: resolved,
    size: stats.size,
    ext,
    content: isBinary
      ? fs.readFileSync(resolved).toString("base64")
      : fs.readFileSync(resolved, "utf-8"),
    encoding: isBinary ? "base64" : "utf-8",
  };
});

ipcMain.handle("write-file", async (_event, filePath, content) => {
  const resolved = expandHome(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, content, "utf-8");
  return { success: true, path: resolved };
});

ipcMain.handle("save-file-dialog", async (_event, defaultName, filters) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: filters || [{ name: "All Files", extensions: ["*"] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle("ensure-dir", async (_event, dirPath) => {
  fs.mkdirSync(expandHome(dirPath), { recursive: true });
  return { success: true };
});

ipcMain.handle("file-exists", async (_event, filePath) => {
  return fs.existsSync(expandHome(filePath));
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

// ──────────────────────────────────────────────────────────────────────
// IDE workspace — Wave 1 stubs.
//
// Wave 2 agents replace these handlers with real implementations:
//   - Agent A (Phase 1): fs:walk, fs:read, fs:watch-start, fs:watch-stop,
//     fs:change broadcast
//   - Agent B (Phase 2): git:status, git:diff
//   - Agent C (Phase 3): git:branches, git:log, git:blame
//   - Agent D (Phase 4): pty:open, pty:input, pty:resize, pty:close,
//     pty:output/exit broadcasts
//
// Each stub returns a safe default so the renderer doesn't crash if the
// real implementation hasn't landed.
// ──────────────────────────────────────────────────────────────────────

// ── Filesystem (Agent A / Phase 1) ────────────────────────────────────
//
// Walks directories one level at a time, reads files as utf-8 (binary
// detection returns null), and runs a chokidar watcher per workspace.
// fs:change events are broadcast to every BrowserWindow so multiple
// renderer subscribers can listen in.
const codeWorkspaceFs = require("./lib/code-workspace-fs");

ipcMain.handle("fs:walk", async (_event, dirPath, opts) => {
  if (!dirPath || typeof dirPath !== "string") return [];
  const expanded = expandHome(dirPath);
  // The first call from the renderer is always at the workspace root, so
  // we treat the requested path as the gitignore boundary for that call.
  // For deeper expansions the renderer still passes the original root via
  // opts.workspaceRoot if needed; default to the requested path.
  const root = (opts && typeof opts.workspaceRoot === "string")
    ? expandHome(opts.workspaceRoot)
    : expanded;
  const result = codeWorkspaceFs.walkOne(root, expanded, {
    respectGitignore: opts?.respectGitignore !== false,
  });
  if (result.error) {
    console.warn(`[fs:walk] ${expanded}:`, result.error);
    return [];
  }
  return result.nodes;
});

ipcMain.handle("fs:read", async (_event, filePath) => {
  if (!filePath || typeof filePath !== "string") return null;
  const expanded = expandHome(filePath);
  const result = codeWorkspaceFs.readFileSafe(expanded);
  if (result.error) {
    console.warn(`[fs:read] ${expanded}:`, result.error);
    return null;
  }
  if (result.binary) {
    return { content: "", encoding: "binary", binary: true, size: result.size ?? 0 };
  }
  return { content: result.content, encoding: result.encoding, size: result.size };
});

ipcMain.handle("fs:write", async (_event, filePath, content) => {
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, error: "Invalid path." };
  }
  const expanded = expandHome(filePath);
  const result = codeWorkspaceFs.writeFileSafe(expanded, content);
  if (!result.ok) {
    console.warn(`[fs:write] ${expanded}:`, result.error);
  }
  return result;
});

// Active watchers keyed by their generated id.
const fsWatchers = new Map();
let nextWatchId = 1;
// Lazy ESM import of chokidar 5 from CJS main.
let _chokidarPromise = null;
function loadChokidar() {
  if (!_chokidarPromise) _chokidarPromise = import("chokidar");
  return _chokidarPromise;
}

function broadcastFsChange(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try { win.webContents.send("fs:change", payload); } catch {}
    }
  }
}

ipcMain.handle("fs:watch-start", async (_event, watchPath) => {
  if (!watchPath || typeof watchPath !== "string") return null;
  const expanded = expandHome(watchPath);
  let chokidar;
  try {
    chokidar = await loadChokidar();
  } catch (err) {
    console.warn("[fs:watch-start] chokidar import failed:", err && err.message);
    return null;
  }

  const watchId = `w${nextWatchId++}`;
  let debounceTimer = null;
  let pending = [];
  const flush = () => {
    const batch = pending;
    pending = [];
    debounceTimer = null;
    for (const evt of batch) broadcastFsChange(evt);
  };
  const emit = (kind, changedPath) => {
    pending.push({ watchId, path: changedPath, kind });
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, 150);
  };

  let watcher;
  try {
    watcher = chokidar.watch(expanded, {
      ignored: (p) =>
        /(^|[\\/])(\.git|node_modules|\.next|dist|\.DS_Store)([\\/]|$)/.test(p),
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      depth: 99,
    });
  } catch (err) {
    console.warn(`[fs:watch-start] ${expanded}:`, err && err.message);
    return null;
  }

  watcher
    .on("add", (p) => emit("add", p))
    .on("change", (p) => emit("change", p))
    .on("unlink", (p) => emit("delete", p))
    .on("addDir", (p) => emit("add", p))
    .on("unlinkDir", (p) => emit("delete", p))
    .on("error", (err) => console.warn(`[fs:watch ${watchId}]`, err && err.message));

  fsWatchers.set(watchId, watcher);
  return watchId;
});

ipcMain.handle("fs:watch-stop", async (_event, watchId) => {
  const watcher = fsWatchers.get(watchId);
  if (!watcher) return;
  fsWatchers.delete(watchId);
  try { await watcher.close(); } catch {}
});

// ──────────────────────────────────────────────────────────────────────
// Git — shared `runGit` helper used by Agent B (status/diff) and Agent C
// (branches/log/blame/push) handlers below.
//
// Binary-safe: stdout returned as Buffer so callers like
// `git status --porcelain -z` and binary-file diffs don't get utf-8
// mangled. Throws on non-zero exit; tolerant callers wrap via runGitSafe.
//
// Mirrors the TypeScript helper at
// `web/src/lib/code-workspace/git-ops.ts` (kept inline because main-web.js
// is plain Node CJS and can't `require` a `.ts` file).
// ──────────────────────────────────────────────────────────────────────

const { spawn } = require("child_process");

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ timeoutMs?: number; maxBufferBytes?: number }} [opts]
 * @returns {Promise<{ stdout: Buffer, stderr: string, code: number }>}
 */
function runGit(cwd, args, opts = {}) {
  if (!cwd || typeof cwd !== "string") {
    return Promise.reject(new Error("runGit: cwd is required"));
  }
  if (!fs.existsSync(cwd)) {
    return Promise.reject(new Error(`runGit: cwd does not exist: ${cwd}`));
  }
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBufferBytes = opts.maxBufferBytes ?? 16 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_PAGER: "cat", GIT_TERMINAL_PROMPT: "0" },
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let truncated = false;
    child.stdout.on("data", (b) => {
      if (stdoutBytes + b.length > maxBufferBytes) {
        if (!truncated) {
          const remaining = Math.max(0, maxBufferBytes - stdoutBytes);
          if (remaining > 0) {
            stdoutChunks.push(b.slice(0, remaining));
            stdoutBytes += remaining;
          }
          truncated = true;
          try { child.kill("SIGTERM"); } catch {}
        }
        return;
      }
      stdoutChunks.push(b);
      stdoutBytes += b.length;
    });
    child.stderr.on("data", (b) => stderrChunks.push(b));
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error(`runGit: timed out after ${timeoutMs}ms — git ${args.join(" ")}`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (code !== 0) {
        reject(new Error(`git ${args.join(" ")} (exit ${code}): ${stderr.trim() || "no stderr"}`));
        return;
      }
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

/**
 * Tolerant wrapper used by Agent C's handlers. Never throws — returns
 * `{ ok, stdout (utf-8 string), stderr, code }` so callers can handle
 * "not a repo" / "no commits" without try/catch.
 */
async function runGitSafe(cwd, args, opts) {
  try {
    const { stdout, stderr, code } = await runGit(cwd, args, opts);
    return { ok: true, stdout: stdout.toString("utf-8"), stderr, code };
  } catch (err) {
    return { ok: false, stdout: "", stderr: err && err.message ? err.message : String(err), code: -1 };
  }
}

async function runGitText(cwd, args, opts) {
  const { stdout } = await runGit(cwd, args, opts);
  return stdout.toString("utf-8");
}

/**
 * Parse `git status --porcelain=v1 -z` output into structured entries.
 * The `-z` format is: `XY <path>\0` (renames are `XY <new>\0<old>\0`).
 * X is the index status, Y is the worktree status.
 */
function parsePorcelainZ(buf) {
  const text = buf.toString("utf-8");
  const records = text.split("\0");
  const out = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r) continue;
    if (r.length < 3) continue;
    const x = r[0];
    const y = r[1];
    const path = r.slice(3);
    // Renames carry the old path in the next NUL chunk; skip it so we don't
    // try to parse "old name" as a fresh entry.
    let isRename = false;
    if (x === "R" || y === "R" || x === "C" || y === "C") {
      isRename = true;
      i++; // consume old-name field
    }
    out.push({ x, y, path, isRename });
  }
  return out;
}

/** Map porcelain X/Y to our GitFileStatus enum. */
function statusFromPorcelain(x, y) {
  if (x === "?" && y === "?") return "untracked";
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
    return "conflicted";
  }
  if (x === "R" || y === "R") return "renamed";
  // Index has a change → staged. Worktree-only changes are "modified" /
  // "added" / "deleted".
  if (x !== " " && x !== "?") {
    if (x === "A") return "added";
    if (x === "D") return "deleted";
    return "staged";
  }
  if (y === "M") return "modified";
  if (y === "A") return "added";
  if (y === "D") return "deleted";
  return "modified";
}

// `git:status` — Wave 2 (Agent B)
//
// Caches the most recent result per cwd for 500ms — Agent A's file watcher
// fires rapidly during npm installs / bulk edits and we don't want to
// thrash git on every event.
const _gitStatusCache = new Map(); // cwd → { result, expiresAt, inflight }

ipcMain.handle("git:status", async (_event, cwd) => {
  if (!cwd) return null;
  const now = Date.now();
  const cached = _gitStatusCache.get(cwd);
  if (cached && cached.expiresAt > now) {
    if (cached.inflight) return cached.inflight; // share inflight promise
    return cached.result;
  }

  const work = (async () => {
    // Branch name. `--abbrev-ref HEAD` returns "HEAD" if detached.
    let branch = "";
    try {
      branch = (await runGitText(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    } catch {
      // Not a git repo, or git command failed
      return null;
    }

    // Upstream (may not exist for un-pushed branches)
    let upstream = null;
    try {
      upstream = (
        await runGitText(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "HEAD@{upstream}"])
      ).trim();
    } catch {
      upstream = null;
    }

    // Base ref for ahead/behind. Prefer the upstream; fall back to
    // `origin/HEAD` when there's no upstream set.
    let baseRef = upstream;
    if (!baseRef) {
      try {
        baseRef = (await runGitText(cwd, ["rev-parse", "--abbrev-ref", "origin/HEAD"])).trim();
        if (baseRef === "origin/HEAD" || baseRef.startsWith("HEAD") || !baseRef) baseRef = null;
      } catch {
        baseRef = null;
      }
    }

    // Ahead / behind. `--left-right --count base..HEAD` prints
    // "<behind>\t<ahead>" — behind is commits in base not in HEAD.
    let ahead = 0;
    let behind = 0;
    if (baseRef) {
      try {
        const counts = (
          await runGitText(cwd, ["rev-list", "--left-right", "--count", `${baseRef}...HEAD`])
        ).trim();
        const parts = counts.split(/\s+/);
        if (parts.length === 2) {
          behind = parseInt(parts[0], 10) || 0;
          ahead = parseInt(parts[1], 10) || 0;
        }
      } catch {
        // ignore — leave 0/0
      }
    }

    // File list via porcelain -z (binary-safe).
    let entries = [];
    try {
      const { stdout } = await runGit(cwd, ["status", "--porcelain=v1", "-z"]);
      entries = parsePorcelainZ(stdout);
    } catch {
      entries = [];
    }

    // Per-file numstat for additions/deletions on tracked changes.
    // `git diff --numstat` covers worktree-vs-HEAD; binary files appear as
    // "- - <path>".
    const numstat = new Map(); // path → { additions, deletions }
    try {
      const text = await runGitText(cwd, ["diff", "--numstat", "HEAD"]);
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const m = line.match(/^(\S+)\s+(\S+)\s+(.+)$/);
        if (!m) continue;
        const adds = m[1] === "-" ? undefined : parseInt(m[1], 10);
        const dels = m[2] === "-" ? undefined : parseInt(m[2], 10);
        numstat.set(m[3], { additions: adds, deletions: dels });
      }
    } catch {
      // No HEAD yet (fresh repo) — skip numstat silently.
    }

    const files = entries.map((e) => {
      const status = statusFromPorcelain(e.x, e.y);
      const ns = numstat.get(e.path);
      return {
        path: e.path,
        status,
        additions: ns?.additions,
        deletions: ns?.deletions,
      };
    });

    return {
      branch: branch || "HEAD",
      baseBranch: baseRef,
      ahead,
      behind,
      files,
    };
  })();

  // Share the inflight promise to dedupe concurrent callers
  _gitStatusCache.set(cwd, { inflight: work, expiresAt: now + 500, result: null });
  try {
    const result = await work;
    _gitStatusCache.set(cwd, { inflight: null, result, expiresAt: Date.now() + 500 });
    return result;
  } catch (err) {
    // On failure clear the cache so the next call retries
    _gitStatusCache.delete(cwd);
    console.warn("[git:status] failed:", err.message);
    return null;
  }
});

// `git:diff` — Wave 2 (Agent B)
//
// Args:
//   - opts.fromRef / opts.toRef: refs to diff between. If both omitted,
//     defaults to working-tree vs HEAD.
//   - opts.path: scope to a single file.
// Returns the raw unified diff string. Empty string when there's no diff.
ipcMain.handle("git:diff", async (_event, cwd, opts) => {
  if (!cwd) return "";
  const o = opts || {};
  const args = ["diff", "--no-color"];

  if (o.fromRef && o.toRef) {
    // Two-ref diff
    args.push(`${o.fromRef}..${o.toRef}`);
  } else if (o.fromRef && !o.toRef) {
    // From ref → working tree
    args.push(o.fromRef);
  } else if (!o.fromRef && o.toRef) {
    // HEAD → ref (committed only — keeps semantics predictable)
    args.push(`HEAD..${o.toRef}`);
  }
  // Else: no refs → default working-tree-vs-HEAD ("git diff" with no
  // refs already does this).

  if (o.path) {
    args.push("--", o.path);
  }

  try {
    return await runGitText(cwd, args, { timeoutMs: 15_000 });
  } catch (err) {
    console.warn("[git:diff] failed:", err.message);
    return "";
  }
});

// ── Agent C: git:branches / git:log / git:blame / git:push ────────────
// Uses runGitSafe (the tolerant wrapper above) so "not a repo" / "no commits"
// degrade gracefully without try/catch.

ipcMain.handle("git:branches", async (_event, cwd) => {
  if (!cwd) return [];
  const { ok, stdout } = await runGitSafe(cwd, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ]);
  if (!ok) return [];
  const seen = new Set();
  const out = [];
  for (const raw of stdout.split("\n")) {
    const name = raw.trim();
    if (!name) continue;
    if (name === "origin/HEAD" || name.endsWith("/HEAD")) continue;
    const base = name.replace(/^origin\//, "");
    if (seen.has(base)) continue;
    seen.add(base);
    out.push(name);
  }
  return out;
});

ipcMain.handle("git:log", async (_event, cwd, opts) => {
  if (!cwd) return [];
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 500));
  const SEP = "\x1f"; // ASCII US — separates fields
  const REC = "\x1e"; // ASCII RS — separates records
  const args = [
    "log",
    `-${limit}`,
    `--pretty=format:%H${SEP}%h${SEP}%an${SEP}%aI${SEP}%s${SEP}%b${REC}`,
  ];
  if (opts?.path) {
    args.push("--follow", "--", opts.path);
  }
  const { ok, stdout } = await runGitSafe(cwd, args);
  if (!ok) return [];
  const commits = [];
  for (const record of stdout.split(REC)) {
    const trimmed = record.replace(/^\n+/, "");
    if (!trimmed) continue;
    const parts = trimmed.split(SEP);
    if (parts.length < 5) continue;
    const [hash, shortHash, author, date, subject, body = ""] = parts;
    commits.push({
      hash,
      shortHash,
      author,
      date,
      subject,
      body: body.trim() || undefined,
    });
  }
  return commits;
});

ipcMain.handle("git:blame", async (_event, cwd, filePath) => {
  if (!cwd || !filePath) return [];
  const { ok, stdout } = await runGitSafe(cwd, [
    "blame",
    "--porcelain",
    "--",
    filePath,
  ]);
  if (!ok) return [];
  const meta = new Map();
  const out = [];
  const lines = stdout.split("\n");
  let curHash = "";
  let curAuthor = "";
  let curDate = "";
  let lineNumber = 0;
  for (let i = 0; i < lines.length && out.length < 5000; i++) {
    const line = lines[i];
    if (!line.length) continue;
    if (line.startsWith("\t")) {
      out.push({
        hash: curHash.slice(0, 8),
        author: curAuthor || "unknown",
        date: curDate ? new Date(parseInt(curDate, 10) * 1000).toISOString().slice(0, 10) : "",
        lineNumber: lineNumber++,
        content: line.slice(1),
      });
      continue;
    }
    const m = line.match(/^([0-9a-f]{40}) (\d+) (\d+)( \d+)?$/);
    if (m) {
      curHash = m[1];
      lineNumber = parseInt(m[3], 10);
      const cached = meta.get(curHash);
      if (cached) {
        curAuthor = cached.author;
        curDate = cached.date;
      } else {
        curAuthor = "";
        curDate = "";
      }
      continue;
    }
    if (line.startsWith("author ")) {
      curAuthor = line.slice("author ".length);
      meta.set(curHash, { ...(meta.get(curHash) || {}), author: curAuthor });
    } else if (line.startsWith("author-time ")) {
      curDate = line.slice("author-time ".length);
      meta.set(curHash, { ...(meta.get(curHash) || {}), date: curDate });
    }
  }
  return out;
});

ipcMain.handle("git:push", async (_event, cwd, branch) => {
  if (!cwd || !branch) return { ok: false, message: "cwd + branch required" };
  const { ok, stderr, stdout } = await runGitSafe(cwd, ["push", "-u", "origin", branch], {
    timeoutMs: 60000,
  });
  return {
    ok,
    message: ok ? (stdout || `Pushed ${branch} to origin`) : (stderr || stdout || "push failed").trim(),
  };
});

// Open an external URL in the user's default browser. The renderer needs this
// for the "Create PR" flow → open the PR URL after creation. Tightly scoped to
// http(s) only; anything else is rejected.
ipcMain.handle("open-external", async (_event, url) => {
  if (typeof url !== "string") return { ok: false };
  if (!/^https?:\/\//i.test(url)) return { ok: false };
  await shell.openExternal(url);
  return { ok: true };
});

// PTY — backed by src/lib/code-workspace/pty-manager.js (node-pty + xterm.js).
// pty-manager broadcasts pty:output / pty:exit events to every BrowserWindow
// itself; the handlers below just plumb the renderer-initiated lifecycle calls.
ipcMain.handle("pty:open", async (_event, opts) => {
  try {
    return ptyManager.open(opts || {});
  } catch (err) {
    console.error("[ipc] pty:open failed:", err);
    return null;
  }
});
ipcMain.handle("pty:input", async (_event, id, data) => {
  ptyManager.write(id, data);
});
ipcMain.handle("pty:resize", async (_event, id, cols, rows) => {
  ptyManager.resize(id, cols, rows);
});
ipcMain.handle("pty:close", async (_event, id) => {
  ptyManager.close(id);
});
