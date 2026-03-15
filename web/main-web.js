/**
 * Electron main process for the Next.js web version.
 * Opens a single BrowserWindow pointing at localhost:3000.
 */
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const os = require("os");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Open Claude Cowork",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: require("path").join(__dirname, "preload-web.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadURL("http://localhost:3000");

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

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
  const binaryExts = [...imageExts, ".pdf", ".xlsx", ".docx"];
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
