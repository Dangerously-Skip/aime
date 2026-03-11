/**
 * preload-new.js - Multi-surface preload bridge
 *
 * Exposes a unified `window.electronAPI` to all WebContentsView surfaces.
 * Handles tab/surface switching, sidebar toggle, navigation, chat streaming,
 * provider queries, folder selection, and listener lifecycle.
 *
 * IPC channels used:
 *   Send (fire-and-forget):
 *     tabbar:switch          - Switch active surface tab
 *     tabbar:toggle-sidebar  - Toggle sidebar visibility
 *     tabbar:navigate-back   - Navigate back in active surface
 *     tabbar:navigate-forward - Navigate forward in active surface
 *
 *   Invoke (request-response):
 *     surface:get-active     - Get current active surface name
 *     app:get-user-name      - Get OS username
 *     dialog:select-folder   - Open native folder picker
 *
 *   Listen (from main):
 *     surface:changed        - Active surface changed
 *     sidebar:toggled        - Sidebar visibility changed
 *
 * @module preload-new
 */

const { contextBridge, ipcRenderer } = require('electron');

// ---------------------------------------------------------------------------
// Server URL configuration
// ---------------------------------------------------------------------------

const SERVER_URL = process.env.NIB_COWORK_PORT
  ? `http://localhost:${process.env.NIB_COWORK_PORT}`
  : 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Expose API to renderer
// ---------------------------------------------------------------------------

contextBridge.exposeInMainWorld('electronAPI', {
  // === Tab/Navigation ===

  /**
   * Switch to a named surface tab.
   * @param {string} name - Surface name: 'chat' | 'cowork' | 'code' | 'browser'
   */
  switchTab: (name) => ipcRenderer.send('tabbar:switch', name),

  /** Toggle sidebar visibility. */
  toggleSidebar: () => ipcRenderer.send('tabbar:toggle-sidebar'),

  /** Navigate back in the active surface's webContents history. */
  navigateBack: () => ipcRenderer.send('tabbar:navigate-back'),

  /** Navigate forward in the active surface's webContents history. */
  navigateForward: () => ipcRenderer.send('tabbar:navigate-forward'),

  /**
   * Get the currently active surface name.
   * @returns {Promise<string>} Active surface name
   */
  getActiveSurface: () => ipcRenderer.invoke('surface:get-active'),

  /**
   * Get the OS username for greeting display.
   * @returns {Promise<string>} Username
   */
  getUserName: () => ipcRenderer.invoke('app:get-user-name'),

  // === Tab switching listener (for tabbar to know which tab is active) ===

  /**
   * Register a callback for surface change events from the main process.
   * @param {function(string): void} callback - Receives the new surface name
   */
  onSurfaceChanged: (callback) => {
    ipcRenderer.on('surface:changed', (_event, name) => callback(name));
  },

  // === Sidebar toggle listener ===

  /**
   * Register a callback for sidebar toggle events from the main process.
   * @param {function(boolean): void} callback - Receives sidebar visibility state
   */
  onSidebarToggled: (callback) => {
    ipcRenderer.on('sidebar:toggled', (_event, visible) => callback(visible));
  },

  // === Chat/Streaming (per-surface) ===

  /**
   * Send a chat message and receive an SSE stream reader.
   *
   * @param {string} message - User message text
   * @param {string} chatId - Chat session ID
   * @param {string} surfaceId - Surface identifier (e.g., 'chat', 'cowork')
   * @param {string|null} [model] - Optional model override
   * @returns {Promise<{read: function, abort: function, abortController: AbortController}>}
   */
  sendMessage: async (message, chatId, surfaceId, model) => {
    const abortController = new AbortController();

    const response = await fetch(`${SERVER_URL}/api/chat/${surfaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, chatId, surfaceId, model }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    return {
      read: async () => {
        const { value, done } = await reader.read();
        if (done) return { done: true, value: null };
        return { done: false, value: decoder.decode(value, { stream: true }) };
      },
      abort: () => {
        abortController.abort();
      },
      abortController,
    };
  },

  // === Abort ===

  /**
   * Abort an ongoing query on the backend for a given chat/surface.
   *
   * @param {string} chatId - Chat session ID
   * @param {string} surfaceId - Surface identifier
   * @returns {Promise<Response>}
   */
  abortQuery: (chatId, surfaceId) => {
    return fetch(`${SERVER_URL}/api/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, surfaceId }),
    });
  },

  // === Providers/Models ===

  /**
   * Get available AI providers from the backend.
   * @returns {Promise<Object>}
   */
  getProviders: async () => {
    const response = await fetch(`${SERVER_URL}/api/providers`);
    return response.json();
  },

  /**
   * Get available surfaces configuration from the backend.
   * @returns {Promise<Object>}
   */
  getSurfaces: async () => {
    const response = await fetch(`${SERVER_URL}/api/surfaces`);
    return response.json();
  },

  /**
   * Get available models from the backend.
   * @returns {Promise<Object>}
   */
  getModels: async () => {
    const response = await fetch(`${SERVER_URL}/api/models`);
    return response.json();
  },

  // === File Dialog ===

  /**
   * Open a native folder selection dialog.
   * @returns {Promise<string|null>} Selected folder path, or null if cancelled
   */
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),

  // === Listeners cleanup helper ===

  /**
   * Remove all listeners for a given IPC channel.
   * Useful for cleanup when a view is being destroyed or re-initialized.
   *
   * @param {string} channel - IPC channel name to clear
   */
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
