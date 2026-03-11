/**
 * main-new.js - Multi-panel Electron main process using BaseWindow + WebContentsView
 *
 * Replaces the single BrowserWindow architecture with a composable surface layout:
 *   - BaseWindow: frameless shell (macOS) with native traffic lights
 *   - 6 WebContentsView instances: sidebar, tabbar, chat, cowork, code, browser
 *   - Only one "surface" view (chat/cowork/code/browser) is visible at a time
 *   - Sidebar and tabbar are always visible (sidebar is toggleable)
 *
 * IPC channels:
 *   tabbar:switch          - Switch active surface
 *   tabbar:toggle-sidebar  - Show/hide sidebar
 *   tabbar:navigate-back   - Go back in active surface history
 *   tabbar:navigate-forward - Go forward in active surface history
 *   surface:get-active     - Returns current active surface name
 *   app:get-user-name      - Returns OS username
 *   dialog:select-folder   - Opens native folder picker
 *
 * Keyboard shortcuts:
 *   Cmd+1..4               - Switch surfaces (chat, cowork, code, browser)
 *   Cmd+Shift+S            - Toggle sidebar
 *
 * @module main-new
 */

const {
  app,
  BaseWindow,
  WebContentsView,
  ipcMain,
  shell,
  dialog,
  globalShortcut,
  Menu,
} = require('electron');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Development mode setup
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV === 'development';

if (isDev) {
  try {
    require('electron-reload')(__dirname, {
      electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
      ignored: /server|node_modules/,
    });
  } catch (err) {
    console.warn('Live reload unavailable:', err);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIDEBAR_WIDTH = 250;
const TABBAR_HEIGHT = 44;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 900;

const SURFACE_NAMES = ['chat', 'cowork', 'code', 'browser'];
const DEFAULT_SURFACE = 'chat';

const PRELOAD_PATH = path.join(__dirname, 'preload-new.js');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {BaseWindow|null} */
let mainWindow = null;

/** @type {Record<string, WebContentsView>} */
const views = {};

/** @type {string} Current active surface name */
let activeSurface = DEFAULT_SURFACE;

/** @type {boolean} Whether the sidebar is visible */
let sidebarVisible = true;

// ---------------------------------------------------------------------------
// View factory
// ---------------------------------------------------------------------------

/**
 * Create a WebContentsView that loads the given HTML file.
 *
 * @param {string} htmlPath - Absolute path to the HTML entry point
 * @returns {WebContentsView}
 */
function createView(htmlPath) {
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: PRELOAD_PATH,
      enableWebSQL: false,
      webSecurity: true,
    },
  });

  view.webContents.loadFile(htmlPath);

  // Open external links in system browser
  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  view.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return view;
}

// ---------------------------------------------------------------------------
// Layout calculation
// ---------------------------------------------------------------------------

/**
 * Recalculate and apply bounds for all views based on current window size
 * and sidebar visibility state.
 */
function updateLayout() {
  if (!mainWindow) return;

  const { width: windowWidth, height: windowHeight } = mainWindow.getContentBounds();
  const sw = sidebarVisible ? SIDEBAR_WIDTH : 0;

  // Sidebar: full height, left edge
  if (views.sidebar) {
    views.sidebar.setBounds({
      x: 0,
      y: 0,
      width: sw,
      height: windowHeight,
    });
    // Show/hide the sidebar view itself
    views.sidebar.setVisible(sidebarVisible);
  }

  // Tabbar: top of remaining area, full remaining width
  if (views.tabbar) {
    views.tabbar.setBounds({
      x: sw,
      y: 0,
      width: windowWidth - sw,
      height: TABBAR_HEIGHT,
    });
  }

  // Surface panels: below tabbar, filling remaining space
  const panelBounds = {
    x: sw,
    y: TABBAR_HEIGHT,
    width: windowWidth - sw,
    height: windowHeight - TABBAR_HEIGHT,
  };

  for (const name of SURFACE_NAMES) {
    if (views[name]) {
      views[name].setBounds(panelBounds);
      views[name].setVisible(name === activeSurface);
    }
  }
}

// ---------------------------------------------------------------------------
// Surface switching
// ---------------------------------------------------------------------------

/**
 * Switch to the named surface view, hiding all others.
 *
 * @param {string} name - Surface name: 'chat' | 'cowork' | 'code' | 'browser'
 */
function switchSurface(name) {
  if (!SURFACE_NAMES.includes(name)) {
    console.warn(`[main] Unknown surface: ${name}`);
    return;
  }

  activeSurface = name;

  // Update visibility for all surface views
  for (const surfaceName of SURFACE_NAMES) {
    if (views[surfaceName]) {
      views[surfaceName].setVisible(surfaceName === name);
    }
  }

  // Notify all views about the surface change
  for (const [, view] of Object.entries(views)) {
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send('surface:changed', name);
    }
  }

  console.log(`[main] Switched to surface: ${name}`);
}

// ---------------------------------------------------------------------------
// Sidebar toggle
// ---------------------------------------------------------------------------

/**
 * Toggle sidebar visibility and recalculate layout.
 */
function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  updateLayout();

  // Notify all views about sidebar state change
  for (const [, view] of Object.entries(views)) {
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send('sidebar:toggled', sidebarVisible);
    }
  }

  console.log(`[main] Sidebar ${sidebarVisible ? 'shown' : 'hidden'}`);
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

/**
 * Create the main BaseWindow and all WebContentsView instances.
 */
function createMainWindow() {
  const isMac = process.platform === 'darwin';

  // Create the BaseWindow shell
  mainWindow = new BaseWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 16, y: 12 },
        }
      : {}),
  });

  // --- Create all 6 WebContentsView instances ---

  const rendererDir = path.join(__dirname, 'renderer');

  views.sidebar = createView(path.join(rendererDir, 'sidebar', 'index.html'));
  views.tabbar = createView(path.join(rendererDir, 'tabbar', 'index.html'));
  views.chat = createView(path.join(rendererDir, 'chat', 'index.html'));
  views.cowork = createView(path.join(rendererDir, 'cowork', 'index.html'));
  views.code = createView(path.join(rendererDir, 'code', 'index.html'));
  views.browser = createView(path.join(rendererDir, 'browser', 'index.html'));

  // Add all views to the window's content view
  // Order matters: later views render on top. Sidebar and tabbar go last
  // so they are always visible above surface panels.
  for (const name of SURFACE_NAMES) {
    mainWindow.contentView.addChildView(views[name]);
  }
  mainWindow.contentView.addChildView(views.sidebar);
  mainWindow.contentView.addChildView(views.tabbar);

  // Set initial layout
  updateLayout();

  // --- Wait for all views to load before showing ---

  const allViews = Object.values(views);
  const loadPromises = allViews.map(
    (view) =>
      new Promise((resolve) => {
        if (view.webContents.isLoading()) {
          view.webContents.once('did-finish-load', resolve);
        } else {
          resolve();
        }
      })
  );

  Promise.all(loadPromises).then(() => {
    mainWindow.show();
    console.log('[main] All views loaded, window shown');
  });

  // --- Window event handlers ---

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Clear view references
    for (const key of Object.keys(views)) {
      delete views[key];
    }
  });

  // Recalculate layout on resize
  mainWindow.on('resize', () => {
    updateLayout();
  });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  // Tab switching
  ipcMain.on('tabbar:switch', (_event, name) => {
    switchSurface(name);
  });

  // Sidebar toggle
  ipcMain.on('tabbar:toggle-sidebar', () => {
    toggleSidebar();
  });

  // Navigate back in active surface
  ipcMain.on('tabbar:navigate-back', () => {
    const view = views[activeSurface];
    if (view && view.webContents.canGoBack()) {
      view.webContents.goBack();
    }
  });

  // Navigate forward in active surface
  ipcMain.on('tabbar:navigate-forward', () => {
    const view = views[activeSurface];
    if (view && view.webContents.canGoForward()) {
      view.webContents.goForward();
    }
  });

  // Get active surface name
  ipcMain.handle('surface:get-active', () => {
    return activeSurface;
  });

  // Get OS username for greeting
  ipcMain.handle('app:get-user-name', () => {
    return os.userInfo().username;
  });

  // Folder selection dialog
  ipcMain.handle('dialog:select-folder', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Working Directory',
    });
    return result.canceled ? null : result.filePaths[0];
  });
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

function registerShortcuts() {
  // Build application menu with keyboard shortcuts
  const isMac = process.platform === 'darwin';

  const template = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),

    // Edit menu (for copy/paste support)
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },

    // View menu with surface switching
    {
      label: 'View',
      submenu: [
        {
          label: 'Chat',
          accelerator: 'CmdOrCtrl+1',
          click: () => switchSurface('chat'),
        },
        {
          label: 'Cowork',
          accelerator: 'CmdOrCtrl+2',
          click: () => switchSurface('cowork'),
        },
        {
          label: 'Code',
          accelerator: 'CmdOrCtrl+3',
          click: () => switchSurface('code'),
        },
        {
          label: 'Browser',
          accelerator: 'CmdOrCtrl+4',
          click: () => switchSurface('browser'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => toggleSidebar(),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' },
            ]
          : [{ role: 'close' }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.on('ready', () => {
  console.log('[main] Electron app ready');
  registerIpcHandlers();
  registerShortcuts();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

app.on('will-quit', () => {
  // Unregister all global shortcuts on quit
  globalShortcut.unregisterAll();
});
