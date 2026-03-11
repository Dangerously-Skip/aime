/**
 * tabbar.js - Segmented Tab Control Component
 *
 * Renders a Claude Desktop-style pill-shaped segmented tab bar with:
 *   - Sidebar toggle, back/forward navigation buttons (left)
 *   - 4-segment pill: Chat | Cowork | Code | Browser (center)
 *   - User avatar (right)
 *
 * Tab switching uses radio inputs for accessibility and CSS :has()-based
 * sliding indicator. IPC messages are sent via window.electronAPI when
 * available, falling back to console.log placeholders.
 *
 * @module tabbar
 */

// ---------------------------------------------------------------------------
// SVG Icon definitions (inline, no external assets)
// ---------------------------------------------------------------------------

const ICONS = {
  sidebar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
    <line x1="9" y1="3" x2="9" y2="21"></line>
  </svg>`,

  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>`,

  forward: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="9 6 15 12 9 18"></polyline>
  </svg>`,

  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="tabbar__segment-icon">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="2" y1="12" x2="22" y2="12"></line>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
  </svg>`,

  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
    <circle cx="12" cy="7" r="4"></circle>
  </svg>`,
};

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { value: 'chat', label: 'Chat' },
  { value: 'cowork', label: 'Cowork' },
  { value: 'code', label: 'Code' },
  { value: 'browser', label: 'Browser', icon: 'globe' },
];

const DEFAULT_TAB = 'chat';

// ---------------------------------------------------------------------------
// IPC helpers (placeholder until preload.js exposes these)
// ---------------------------------------------------------------------------

/**
 * Send an IPC-style message. Uses window.electronAPI if available,
 * otherwise logs to console as a development placeholder.
 *
 * @param {string} channel - IPC channel name
 * @param {*} [data] - Payload
 */
function send(channel, data) {
  if (window.electronAPI && typeof window.electronAPI[channel] === 'function') {
    window.electronAPI[channel](data);
  } else {
    console.log(`[tabbar] IPC -> ${channel}`, data !== undefined ? data : '');
  }
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

/**
 * Generate the full tab bar markup.
 *
 * @param {string} [activeTab='chat'] - Initially active tab value
 * @returns {string} HTML string
 */
function renderHTML(activeTab = DEFAULT_TAB) {
  const segmentsHTML = TABS.map((tab) => {
    const checked = tab.value === activeTab ? 'checked' : '';
    const iconHTML = tab.icon ? ICONS[tab.icon] : '';
    return `
      <input
        type="radio"
        name="tabbar-tab"
        class="tabbar__radio"
        id="tab-${tab.value}"
        value="${tab.value}"
        ${checked}
      />
      <label class="tabbar__segment" for="tab-${tab.value}">
        ${tab.label}${iconHTML}
      </label>`;
  }).join('');

  return `
    <nav class="tabbar" role="navigation" aria-label="Main navigation">
      <!-- Left: sidebar toggle + nav arrows -->
      <div class="tabbar__left">
        <button
          class="tabbar__btn tabbar__btn--sidebar"
          id="tabbar-sidebar"
          type="button"
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
        >${ICONS.sidebar}</button>

        <span class="tabbar__separator" aria-hidden="true"></span>

        <button
          class="tabbar__btn tabbar__btn--back"
          id="tabbar-back"
          type="button"
          title="Go back"
          aria-label="Navigate back"
        >${ICONS.back}</button>

        <button
          class="tabbar__btn tabbar__btn--forward"
          id="tabbar-forward"
          type="button"
          title="Go forward"
          aria-label="Navigate forward"
        >${ICONS.forward}</button>
      </div>

      <!-- Center: segmented pill -->
      <div class="tabbar__center">
        <div class="tabbar__pill" role="tablist" aria-label="Surface tabs">
          ${segmentsHTML}
          <div class="tabbar__indicator" aria-hidden="true"></div>
        </div>
      </div>

      <!-- Right: user avatar -->
      <div class="tabbar__right">
        <button
          class="tabbar__avatar"
          id="tabbar-avatar"
          type="button"
          title="User menu"
          aria-label="User menu"
        >${ICONS.user}</button>
      </div>
    </nav>`;
}

// ---------------------------------------------------------------------------
// Event binding
// ---------------------------------------------------------------------------

/**
 * Attach event listeners to the rendered tab bar.
 *
 * @param {HTMLElement} root - The container element (#tabbar)
 */
function bindEvents(root) {
  // Tab selection via radio change
  const radios = root.querySelectorAll('.tabbar__radio');
  radios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        send('switchTab', e.target.value);
      }
    });
  });

  // Sidebar toggle
  const sidebarBtn = root.querySelector('#tabbar-sidebar');
  if (sidebarBtn) {
    sidebarBtn.addEventListener('click', () => {
      send('toggleSidebar');
    });
  }

  // Back button
  const backBtn = root.querySelector('#tabbar-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      send('navigateBack');
    });
  }

  // Forward button
  const forwardBtn = root.querySelector('#tabbar-forward');
  if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
      send('navigateForward');
    });
  }

  // User avatar
  const avatarBtn = root.querySelector('#tabbar-avatar');
  if (avatarBtn) {
    avatarBtn.addEventListener('click', () => {
      send('openUserMenu');
    });
  }

  // Keyboard shortcuts for tab switching (Ctrl/Cmd + 1-4)
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const index = parseInt(e.key, 10);
    if (index >= 1 && index <= TABS.length) {
      e.preventDefault();
      setActiveTab(TABS[index - 1].value);
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Programmatically set the active tab.
 * Used for IPC-driven tab switching (e.g., keyboard shortcuts from main process).
 *
 * @param {string} tabValue - One of: 'chat', 'cowork', 'code', 'browser'
 */
export function setActiveTab(tabValue) {
  const radio = document.querySelector(`.tabbar__radio[value="${tabValue}"]`);
  if (radio && !radio.checked) {
    radio.checked = true;
    // Dispatch change event so listeners fire
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/**
 * Get the currently active tab value.
 *
 * @returns {string|null} The active tab value, or null if none selected
 */
export function getActiveTab() {
  const checked = document.querySelector('.tabbar__radio:checked');
  return checked ? checked.value : null;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Mount the tab bar into the target container.
 */
function init() {
  const container = document.getElementById('tabbar');
  if (!container) {
    console.error('[tabbar] Mount point #tabbar not found');
    return;
  }

  container.innerHTML = renderHTML(DEFAULT_TAB);
  bindEvents(container);

  // Listen for external tab-set commands (from main process via preload)
  // This will be wired up when preload.js exposes the IPC listener
  if (window.electronAPI && typeof window.electronAPI.onSetActiveTab === 'function') {
    window.electronAPI.onSetActiveTab((tabValue) => {
      setActiveTab(tabValue);
    });
  }

  console.log('[tabbar] Initialized with default tab:', DEFAULT_TAB);
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
