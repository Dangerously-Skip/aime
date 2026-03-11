# Phase 0 Plan 2: BaseWindow + WebContentsView Multi-Panel Main Process

BaseWindow shell with 6 WebContentsView surfaces, IPC-driven tab switching, toggleable sidebar, and unified preload bridge.

## What Was Done

### Task 1: Create main-new.js and preload-new.js

**main-new.js** replaces the single `BrowserWindow` architecture with a composable multi-panel layout:

- `BaseWindow` (1400x900, frameless on macOS with `hiddenInset` titlebar, traffic lights at x:16 y:12)
- 6 `WebContentsView` instances: sidebar, tabbar, chat, cowork, code, browser
- Z-order: surface panels added first, sidebar and tabbar layered on top
- `switchSurface(name)` hides all surface views except the active one
- `updateLayout()` recalculates bounds on resize and sidebar toggle
- `toggleSidebar()` toggles between 250px and 0px sidebar width
- IPC handlers: `tabbar:switch`, `tabbar:toggle-sidebar`, `tabbar:navigate-back`, `tabbar:navigate-forward`, `surface:get-active`, `app:get-user-name`, `dialog:select-folder`
- Keyboard shortcuts via application menu (not globalShortcut): Cmd+1-4 for surfaces, Cmd+Shift+S for sidebar toggle
- Full app menu with Edit (copy/paste), View, Window menus
- Wait for all views to finish loading before showing window
- Development mode electron-reload support carried forward

**preload-new.js** exposes a unified `window.electronAPI` bridge:

- Tab/navigation: `switchTab`, `toggleSidebar`, `navigateBack`, `navigateForward`
- Async queries: `getActiveSurface`, `getUserName`, `selectFolder`
- Event listeners: `onSurfaceChanged`, `onSidebarToggled`
- Chat streaming: `sendMessage` with per-surface endpoint (`/api/chat/{surfaceId}`)
- Backend queries: `abortQuery`, `getProviders`, `getSurfaces`, `getModels`
- Cleanup: `removeAllListeners`
- Configurable server URL via `NIB_COWORK_PORT` env var

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Application menu for shortcuts instead of globalShortcut | Menu accelerators integrate with OS natively, appear in menu bar, don't conflict with other apps, and auto-unregister on blur |
| Z-order: surfaces first, then sidebar/tabbar | Ensures sidebar and tabbar always render above surface panels without explicit z-index management |
| Views wait for did-finish-load before window.show() | Prevents white flash / layout jank on startup |
| Keyboard shortcuts use CmdOrCtrl for cross-platform | Cmd on macOS, Ctrl on Windows/Linux |

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 8680c21 | feat(0-2): add BaseWindow + WebContentsView multi-panel main process |

## Key Files

### Created
- `main-new.js` - New multi-panel Electron main process (315 lines)
- `preload-new.js` - Unified preload bridge for all surfaces (185 lines)

### Not Modified (as specified)
- `main.js` - Original single-window main process preserved
- `preload.js` - Original preload script preserved

## Verification

- Both files pass `node -c` syntax check
- All Electron APIs used (BaseWindow, WebContentsView, ipcMain, shell, dialog, Menu) are available in Electron 41
- Existing main.js and preload.js remain untouched
- Six surfaces match the scaffolded renderer directories from Phase 0-1
