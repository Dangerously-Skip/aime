/**
 * sidebar.js - Sidebar surface controller
 *
 * Manages conversation history display, new chat creation, search filtering,
 * and navigation between conversations. Conversations are grouped by time
 * period (Today, Yesterday, This Week, Older) and stored via state-manager.
 *
 * Communicates with other surfaces via:
 *   - window.electronAPI.switchTab() for navigation
 *   - window.electronAPI.onSurfaceChanged() for active surface tracking
 *   - window.addEventListener('message') for cross-view conversation updates
 *
 * @module sidebar
 */

import { createStateManager } from '../shared/state-manager.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = createStateManager('nibcowork:sidebar');

/** Currently active conversation ID. */
let activeConversationId = null;

/** Current search filter text. */
let searchFilter = '';

// ---------------------------------------------------------------------------
// Time Grouping
// ---------------------------------------------------------------------------

/** Millisecond constants for time period calculations. */
const MS_DAY = 86400000;
const MS_WEEK = 604800000;

/**
 * Determine the time group label for a given timestamp.
 *
 * @param {number} timestamp - Unix timestamp in milliseconds.
 * @returns {string} One of 'Today', 'Yesterday', 'This Week', 'Older'.
 */
function getTimeGroup(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < MS_DAY) return 'Today';
  if (diff < MS_DAY * 2) return 'Yesterday';
  if (diff < MS_WEEK) return 'This Week';
  return 'Older';
}

/**
 * Get display time string for a conversation timestamp.
 *
 * For today: shows "HH:MM" (24h).
 * For yesterday: shows "Yesterday".
 * For this week: shows abbreviated weekday (Mon, Tue, ...).
 * For older: shows "MMM DD" (e.g., "Mar 10").
 *
 * @param {number} timestamp - Unix timestamp in milliseconds.
 * @returns {string} Formatted time string.
 */
function formatTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const date = new Date(timestamp);

  if (diff < MS_DAY) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (diff < MS_DAY * 2) {
    return 'Yesterday';
  }
  if (diff < MS_WEEK) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Conversation Management
// ---------------------------------------------------------------------------

/**
 * Get all conversations from state, sorted by timestamp descending (newest first).
 *
 * @returns {Array<{id: string, title: string, preview: string, timestamp: number, surfaceId: string}>}
 */
function getConversations() {
  const conversations = state.get('conversations') || [];
  return [...conversations].sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Add or update a conversation in state.
 *
 * If a conversation with the given ID exists, it is updated in place.
 * Otherwise, a new entry is prepended.
 *
 * @param {Object} conversation - The conversation data.
 * @param {string} conversation.id - Unique conversation ID.
 * @param {string} conversation.title - Display title.
 * @param {string} conversation.preview - Preview text (first message snippet).
 * @param {number} conversation.timestamp - Unix timestamp in milliseconds.
 * @param {string} conversation.surfaceId - Surface that owns this conversation.
 */
function upsertConversation(conversation) {
  const conversations = state.get('conversations') || [];
  const index = conversations.findIndex((c) => c.id === conversation.id);

  if (index >= 0) {
    conversations[index] = { ...conversations[index], ...conversation };
  } else {
    conversations.unshift(conversation);
  }

  state.set('conversations', conversations);
  renderConversations(searchFilter);
}

/**
 * Delete a conversation from state by ID.
 *
 * @param {string} id - Conversation ID to remove.
 */
function deleteConversation(id) {
  const conversations = state.get('conversations') || [];
  const filtered = conversations.filter((c) => c.id !== id);
  state.set('conversations', filtered);

  if (activeConversationId === id) {
    activeConversationId = null;
  }

  renderConversations(searchFilter);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render the conversation list, applying search filter and time grouping.
 *
 * @param {string} [filter=''] - Text to filter conversations by title or preview.
 */
function renderConversations(filter = '') {
  const listEl = document.getElementById('conversationList');
  if (!listEl) return;

  const conversations = getConversations();

  // Apply search filter
  const lowerFilter = filter.toLowerCase().trim();
  const filtered = lowerFilter
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(lowerFilter) ||
          (c.preview && c.preview.toLowerCase().includes(lowerFilter))
      )
    : conversations;

  // Clear existing content
  listEl.innerHTML = '';

  // Empty state
  if (filtered.length === 0) {
    listEl.appendChild(createEmptyState(lowerFilter));
    return;
  }

  // Group by time period
  const groups = groupByTime(filtered);
  const groupOrder = ['Today', 'Yesterday', 'This Week', 'Older'];

  for (const groupName of groupOrder) {
    const items = groups[groupName];
    if (!items || items.length === 0) continue;

    // Group header
    const header = document.createElement('div');
    header.className = 'sidebar-group-header';
    header.textContent = groupName;
    listEl.appendChild(header);

    // Conversation items
    for (const conversation of items) {
      listEl.appendChild(createConversationItem(conversation));
    }
  }
}

/**
 * Group conversations by their time period.
 *
 * @param {Array} conversations - Sorted conversation array.
 * @returns {Object} Map of group name to conversation array.
 */
function groupByTime(conversations) {
  const groups = {};

  for (const conversation of conversations) {
    const group = getTimeGroup(conversation.timestamp);
    if (!groups[group]) groups[group] = [];
    groups[group].push(conversation);
  }

  return groups;
}

/**
 * Create a DOM element for a single conversation item.
 *
 * @param {Object} conversation - Conversation data.
 * @returns {HTMLElement} The conversation item element.
 */
function createConversationItem(conversation) {
  const item = document.createElement('div');
  item.className = 'sidebar-conversation-item';
  item.dataset.id = conversation.id;

  if (conversation.id === activeConversationId) {
    item.classList.add('active');
  }

  const headerRow = document.createElement('div');
  headerRow.className = 'conversation-header';

  const title = document.createElement('div');
  title.className = 'conversation-title';
  title.textContent = conversation.title || 'New Chat';

  const time = document.createElement('div');
  time.className = 'conversation-time';
  time.textContent = formatTime(conversation.timestamp);

  headerRow.appendChild(title);
  headerRow.appendChild(time);
  item.appendChild(headerRow);

  if (conversation.preview) {
    const preview = document.createElement('div');
    preview.className = 'conversation-preview';
    preview.textContent = conversation.preview;
    item.appendChild(preview);
  }

  // Click handler: switch to this conversation
  item.addEventListener('click', () => {
    handleConversationClick(conversation);
  });

  return item;
}

/**
 * Create the empty state element shown when no conversations match.
 *
 * @param {string} filter - The active search filter (empty string if no filter).
 * @returns {HTMLElement} The empty state container.
 */
function createEmptyState(filter) {
  const container = document.createElement('div');
  container.className = 'sidebar-empty';

  const icon = document.createElement('div');
  icon.className = 'sidebar-empty-icon';
  icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>`;

  const text = document.createElement('div');
  text.className = 'sidebar-empty-text';
  text.textContent = filter ? 'No matching conversations' : 'No conversations yet';

  const hint = document.createElement('div');
  hint.className = 'sidebar-empty-hint';
  hint.textContent = filter ? 'Try a different search term' : 'Start a new chat to begin';

  container.appendChild(icon);
  container.appendChild(text);
  container.appendChild(hint);

  return container;
}

// ---------------------------------------------------------------------------
// Event Handlers
// ---------------------------------------------------------------------------

/**
 * Handle a click on a conversation item.
 * Switches to the appropriate surface and activates the conversation.
 *
 * @param {Object} conversation - The clicked conversation data.
 */
function handleConversationClick(conversation) {
  activeConversationId = conversation.id;

  // Switch to the surface this conversation belongs to
  const surface = conversation.surfaceId || 'chat';
  window.electronAPI?.switchTab?.(surface);

  // Notify the target surface about the selected conversation
  window.parent?.postMessage?.(
    {
      type: 'conversation-select',
      conversationId: conversation.id,
      surfaceId: surface,
    },
    '*'
  );

  // Re-render to update active highlight
  renderConversations(searchFilter);
}

/**
 * Handle new chat button click.
 * Generates a new chat ID, creates a conversation entry, and switches to chat.
 */
function handleNewChat() {
  const chatId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  upsertConversation({
    id: chatId,
    title: 'New Chat',
    preview: '',
    timestamp: Date.now(),
    surfaceId: 'chat',
  });

  activeConversationId = chatId;

  // Switch to chat surface
  window.electronAPI?.switchTab?.('chat');

  // Notify chat surface of the new conversation
  window.parent?.postMessage?.(
    {
      type: 'conversation-new',
      conversationId: chatId,
      surfaceId: 'chat',
    },
    '*'
  );

  renderConversations(searchFilter);
}

/**
 * Handle search input changes.
 * Filters the conversation list in real time.
 *
 * @param {Event} event - The input event.
 */
function handleSearchInput(event) {
  searchFilter = event.target.value;
  renderConversations(searchFilter);
}

/**
 * Handle settings button click.
 * Currently a placeholder -- will navigate to settings surface in the future.
 */
function handleSettingsClick() {
  // Settings surface is not yet implemented.
  // This will be wired up in a future phase.
  console.log('[Sidebar] Settings clicked (not yet implemented)');
}

// ---------------------------------------------------------------------------
// Cross-View Communication
// ---------------------------------------------------------------------------

/**
 * Listen for conversation updates from other surfaces.
 *
 * Other surfaces (chat, cowork, code) post messages to update conversation
 * metadata (title, preview, timestamp) when messages are sent/received.
 *
 * Expected message format:
 * {
 *   type: 'conversation-update',
 *   conversation: { id, title, preview, timestamp, surfaceId }
 * }
 */
function setupCrossViewListeners() {
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'conversation-update':
        if (data.conversation && data.conversation.id) {
          upsertConversation(data.conversation);
        }
        break;

      case 'conversation-delete':
        if (data.conversationId) {
          deleteConversation(data.conversationId);
        }
        break;

      case 'conversation-activate':
        if (data.conversationId) {
          activeConversationId = data.conversationId;
          renderConversations(searchFilter);
        }
        break;

      default:
        // Ignore unknown message types
        break;
    }
  });
}

/**
 * Listen for surface changes from the main process.
 * Updates the active conversation highlight based on the current surface.
 */
function setupSurfaceChangeListener() {
  window.electronAPI?.onSurfaceChanged?.((surfaceName) => {
    // When surface changes, we might want to highlight conversations
    // belonging to that surface. For now, just re-render to keep state fresh.
    renderConversations(searchFilter);
  });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the sidebar.
 * Binds event handlers, sets up cross-view listeners, and performs initial render.
 */
function init() {
  // Bind UI event handlers
  const newChatBtn = document.getElementById('newChatBtn');
  if (newChatBtn) {
    newChatBtn.addEventListener('click', handleNewChat);
  }

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', handleSearchInput);
  }

  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', handleSettingsClick);
  }

  // Set up cross-view communication
  setupCrossViewListeners();
  setupSurfaceChangeListener();

  // Initial render
  renderConversations();

  console.log('[Sidebar] Initialized');
}

document.addEventListener('DOMContentLoaded', init);
