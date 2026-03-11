/**
 * browser.js - Browser Surface Logic
 *
 * Manages the split-panel browser surface: tab management, URL navigation,
 * panel resize, and an agent chat sidebar for Playwright MCP integration.
 * Left panel shows browser controls and page area; right panel has a compact
 * agent chat for asking questions about pages or giving browsing tasks.
 *
 * @module browser
 */

import { createMarkdownStream } from '../shared/markdown-renderer.js';
import { renderThinkingSection } from '../shared/thinking-renderer.js';
import { renderToolCall, updateToolResult } from '../shared/tool-call-renderer.js';
import { createSSEReader } from '../shared/sse-parser.js';
import { createStateManager } from '../shared/state-manager.js';
import { createMessageList } from '../shared/message-list.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = createStateManager('nibcowork:browser');

/** @type {string} Current active chat ID for the agent sidebar */
let currentChatId = state.get('currentChatId') || newChatId();

/** @type {string} Currently selected model value */
let selectedModel = state.get('selectedModel') || 'sonnet';

/** @type {boolean} Whether we are currently streaming a response */
let isStreaming = false;

/** @type {{ abort: Function } | null} Current stream connection for abort */
let currentStream = null;

/** @type {ReturnType<typeof createMessageList> | null} Message list component for agent sidebar */
let messageList = null;

/** @type {string} Current URL loaded in the browser */
let currentUrl = state.get('currentUrl') || '';

// ---------------------------------------------------------------------------
// Tab Management
// ---------------------------------------------------------------------------

/** @type {Array<{id: number, title: string, url: string}>} */
let tabs = state.get('tabs') || [{ id: 0, title: 'New Tab', url: '' }];

/** @type {number} */
let activeTabId = state.get('activeTabId') ?? 0;

/** @type {number} Counter for generating unique tab IDs */
let nextTabId = state.get('nextTabId') ?? 1;

/**
 * Add a new tab and switch to it.
 */
function addTab() {
  const tab = { id: nextTabId, title: 'New Tab', url: '' };
  tabs.push(tab);
  nextTabId++;
  state.set('nextTabId', nextTabId);
  selectTab(tab.id);
  saveTabs();
}

/**
 * Close a tab by ID. If it is the active tab, select the previous or next tab.
 * Prevents closing the last remaining tab.
 * @param {number} id
 */
function closeTab(id) {
  if (tabs.length <= 1) return;

  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  tabs.splice(idx, 1);

  // If we closed the active tab, select an adjacent one
  if (activeTabId === id) {
    const newIdx = Math.min(idx, tabs.length - 1);
    selectTab(tabs[newIdx].id);
  }

  saveTabs();
  renderTabs();
}

/**
 * Select a tab by ID: update active state, restore URL, re-render.
 * @param {number} id
 */
function selectTab(id) {
  activeTabId = id;
  state.set('activeTabId', activeTabId);

  const tab = tabs.find(t => t.id === id);
  if (tab) {
    currentUrl = tab.url;
    state.set('currentUrl', currentUrl);

    const urlInput = document.getElementById('urlInput');
    if (urlInput) urlInput.value = tab.url;

    updateContext(tab.url, tab.title);
  }

  renderTabs();
}

/**
 * Save tabs array to persistent state.
 */
function saveTabs() {
  state.set('tabs', tabs);
}

/**
 * Render the tab bar DOM to match the current tabs state.
 */
function renderTabs() {
  const tabBar = document.getElementById('tabBar');
  if (!tabBar) return;

  // Remove existing tab elements (but keep the new-tab button)
  const existingTabs = tabBar.querySelectorAll('.browser-tab');
  existingTabs.forEach(el => el.remove());

  const newTabBtn = document.getElementById('newTabBtn');

  for (const tab of tabs) {
    const tabEl = document.createElement('div');
    tabEl.className = `browser-tab${tab.id === activeTabId ? ' active' : ''}`;
    tabEl.dataset.tab = String(tab.id);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title || 'New Tab';
    tabEl.appendChild(titleSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener('click', () => {
      selectTab(tab.id);
    });

    tabBar.insertBefore(tabEl, newTabBtn);
  }
}

// ---------------------------------------------------------------------------
// URL Navigation
// ---------------------------------------------------------------------------

/**
 * Normalize a URL string: add https:// if no protocol is specified,
 * treat non-URL-like strings as search queries.
 * @param {string} input
 * @returns {string}
 */
function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) return '';

  // Already has a protocol
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Looks like a domain (has a dot and no spaces)
  if (/^[^\s]+\.[^\s]+$/.test(trimmed)) {
    return `https://${trimmed}`;
  }

  // Treat as a search query
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

/**
 * Navigate to a URL: normalize it, update the tab, URL bar, and context.
 * In the future this will IPC to the main process to load a WebContentsView.
 * @param {string} url
 */
function navigate(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return;

  currentUrl = normalized;
  state.set('currentUrl', currentUrl);

  // Update URL bar
  const urlInput = document.getElementById('urlInput');
  if (urlInput) urlInput.value = normalized;

  // Update active tab
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) {
    tab.url = normalized;

    // Extract a short title from the URL
    try {
      const urlObj = new URL(normalized);
      tab.title = urlObj.hostname.replace(/^www\./, '');
    } catch (_) {
      tab.title = normalized.substring(0, 30);
    }

    saveTabs();
    renderTabs();
  }

  // Update context indicator in agent sidebar
  updateContext(normalized);

  // Update browser content area (placeholder; real navigation via main process IPC)
  updateBrowserContent(normalized);

  // TODO: IPC to main process to load URL in WebContentsView
  // window.electronAPI?.navigateBrowser?.(normalized);

  console.log('Browser: navigating to', normalized);
}

/**
 * Update the browser content placeholder to show the current URL state.
 * In production, this area will be overlaid by a WebContentsView.
 * @param {string} url
 */
function updateBrowserContent(url) {
  const contentEl = document.getElementById('browserContent');
  if (!contentEl) return;

  // Replace empty state with a URL indicator
  contentEl.innerHTML = `
    <div class="browser-empty-state">
      <svg class="browser-globe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
      </svg>
      <p style="font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-tertiary); word-break: break-all;">${escapeHtml(url)}</p>
      <p>Page content will render here via WebContentsView</p>
    </div>
  `;
}

/**
 * Show the empty state in the browser content area.
 */
function showEmptyState() {
  const contentEl = document.getElementById('browserContent');
  if (!contentEl) return;

  contentEl.innerHTML = `
    <div class="browser-empty-state">
      <svg class="browser-globe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
      </svg>
      <p>Enter a URL or ask the agent to browse for you</p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Context Indicator
// ---------------------------------------------------------------------------

/**
 * Update the agent sidebar context indicator with the current page info.
 * @param {string} [url='']
 * @param {string} [title='']
 */
function updateContext(url = '', title = '') {
  const contextEl = document.getElementById('agentContext');
  if (!contextEl) return;

  if (!url) {
    contextEl.innerHTML = '<span class="context-label">No page loaded</span>';
    return;
  }

  let displayText = title || url;
  try {
    if (!title) {
      const urlObj = new URL(url);
      displayText = urlObj.hostname.replace(/^www\./, '') + urlObj.pathname;
      if (displayText.length > 40) {
        displayText = displayText.substring(0, 40) + '...';
      }
    }
  } catch (_) {
    displayText = url.substring(0, 40);
  }

  contextEl.innerHTML = `<span class="context-chip" title="${escapeHtml(url)}">${escapeHtml(displayText)}</span>`;
}

// ---------------------------------------------------------------------------
// Panel Resize
// ---------------------------------------------------------------------------

/**
 * Initialize the drag-to-resize behavior between the browser panel and sidebar.
 */
function initPanelResize() {
  const resizeHandle = document.getElementById('resizeHandle');
  const browserPanel = document.getElementById('browserPanel');
  const agentSidebar = document.getElementById('agentSidebar');

  if (!resizeHandle || !browserPanel || !agentSidebar) return;

  let isResizing = false;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    resizeHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const panelWidth = e.clientX;
    const sidebarWidth = window.innerWidth - panelWidth;

    // Enforce min/max constraints
    if (sidebarWidth >= 250 && sidebarWidth <= 600 && panelWidth >= 300) {
      browserPanel.style.flex = 'none';
      browserPanel.style.width = panelWidth + 'px';
      agentSidebar.style.width = sidebarWidth + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizeHandle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Generate a new chat ID.
 * @returns {string}
 */
function newChatId() {
  return crypto.randomUUID();
}

/**
 * Escape HTML entities to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Get stored messages for a given chat.
 * @param {string} chatId
 * @returns {Array<{role: string, content: string, timestamp: number}>}
 */
function getMessages(chatId) {
  return state.get(`messages:${chatId}`) || [];
}

/**
 * Save a message to state for a given chat.
 * @param {string} chatId
 * @param {{ role: string, content: string, timestamp?: number }} msg
 */
function saveMessage(chatId, msg) {
  const messages = getMessages(chatId);
  messages.push({
    ...msg,
    timestamp: msg.timestamp || Date.now()
  });
  state.set(`messages:${chatId}`, messages);
}

// ---------------------------------------------------------------------------
// Stream Processing
// ---------------------------------------------------------------------------

/**
 * Process an SSE stream from the server and render chunks into the assistant
 * message content element in the agent sidebar.
 *
 * @param {AsyncGenerator} sseReader - Async generator from createSSEReader
 * @param {Object} assistantHandle - Handle from messageList.addAssistantMessage()
 */
async function processStream(sseReader, assistantHandle) {
  const { contentEl, removeLoading, showActions } = assistantHandle;

  let markdownStream = null;
  let thinkingStream = null;
  let fullContent = '';

  removeLoading();

  try {
    for await (const event of sseReader) {
      switch (event.type) {
        case 'text': {
          if (!markdownStream) {
            markdownStream = createMarkdownStream(contentEl);
          }
          markdownStream.append(event.content || '');
          fullContent += event.content || '';

          // Add streaming cursor
          addStreamingCursor(contentEl);

          if (messageList) {
            messageList.scrollToBottom();
          }
          break;
        }

        case 'thinking': {
          if (!thinkingStream) {
            thinkingStream = renderThinkingSection(contentEl);
          }
          thinkingStream.append(event.content || '');

          if (messageList) {
            messageList.scrollToBottom();
          }
          break;
        }

        case 'tool_use': {
          if (markdownStream) {
            markdownStream.nextChunk();
          }

          renderToolCall(contentEl, {
            toolName: event.name || 'Unknown Tool',
            toolId: event.id || `tool_${Date.now()}`,
            input: event.input || {}
          });

          if (messageList) {
            messageList.scrollToBottom();
          }
          break;
        }

        case 'tool_result': {
          updateToolResult(contentEl, {
            toolId: event.id || '',
            output: event.result || event.content || '',
            isError: event.is_error || false
          });

          if (messageList) {
            messageList.scrollToBottom();
          }
          break;
        }

        case 'assistant': {
          // Server-side session message -- no UI action needed
          break;
        }

        case 'error': {
          removeStreamingCursor(contentEl);
          const errorDiv = document.createElement('div');
          errorDiv.style.cssText = `color: var(--error); padding: var(--space-1) 0; font-size: var(--text-xs);`;
          errorDiv.textContent = event.content || event.error || 'An error occurred';
          contentEl.appendChild(errorDiv);
          break;
        }

        case 'done': {
          break;
        }

        default: {
          if (event.content && typeof event.content === 'string') {
            if (!markdownStream) {
              markdownStream = createMarkdownStream(contentEl);
            }
            markdownStream.append(event.content);
            fullContent += event.content;
          }
          break;
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Stream processing error:', err);
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `color: var(--error); padding: var(--space-1) 0; font-size: var(--text-xs);`;
      errorDiv.textContent = `Stream error: ${err.message}`;
      contentEl.appendChild(errorDiv);
    }
  }

  // Finalize
  removeStreamingCursor(contentEl);

  if (markdownStream) {
    markdownStream.finish();
  }

  if (thinkingStream) {
    thinkingStream.finish();
  }

  showActions();

  // Store raw content for copy functionality
  contentEl.dataset.rawContent = fullContent;

  // Save assistant message to state
  if (fullContent) {
    saveMessage(currentChatId, { role: 'assistant', content: fullContent });
  }
}

/**
 * Add a streaming cursor to the content area.
 * @param {HTMLElement} contentEl
 */
function addStreamingCursor(contentEl) {
  removeStreamingCursor(contentEl);
  const cursor = document.createElement('span');
  cursor.className = 'streaming-cursor';
  contentEl.appendChild(cursor);
}

/**
 * Remove the streaming cursor from the content area.
 * @param {HTMLElement} contentEl
 */
function removeStreamingCursor(contentEl) {
  const existing = contentEl.querySelector('.streaming-cursor');
  if (existing) existing.remove();
}

// ---------------------------------------------------------------------------
// Send Message (Agent Sidebar)
// ---------------------------------------------------------------------------

/**
 * Send a user message from the agent sidebar and stream the response.
 * @param {string} text - The message text
 */
async function sendMessage(text) {
  if (!text.trim() || isStreaming) return;

  // Remove empty state if present
  const emptyState = document.getElementById('agentMessages')?.querySelector('.agent-empty-state');
  if (emptyState) emptyState.remove();

  // 1. Add user message to UI
  messageList.addUserMessage(text);

  // Save user message to state
  saveMessage(currentChatId, { role: 'user', content: text });

  // 2. Clear input and set loading state
  const inputEl = document.getElementById('agentInput');
  if (inputEl) {
    inputEl.value = '';
    inputEl.style.height = 'auto';
  }
  setStreamingState(true);

  // 3. Create assistant message placeholder
  const assistantHandle = messageList.addAssistantMessage();

  try {
    // 4. Send to backend via electronAPI
    const response = await window.electronAPI.sendMessage(
      text,
      currentChatId,
      'browser',
      selectedModel
    );

    currentStream = response;

    // 5. Wrap the response for createSSEReader
    const readerWrapper = {
      getReader: () => ({
        read: response.read,
        cancel: () => {
          try {
            response.abort();
          } catch (_) {
            // ignore abort errors
          }
        }
      })
    };

    // 6. Process the SSE stream
    const sseReader = createSSEReader(readerWrapper);
    await processStream(sseReader, assistantHandle);

  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Send message error:', err);
      assistantHandle.removeLoading();
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `color: var(--error); padding: var(--space-1) 0; font-size: var(--text-xs);`;
      errorDiv.textContent = `Failed to send message: ${err.message}`;
      assistantHandle.contentEl.appendChild(errorDiv);
    }
  } finally {
    isStreaming = false;
    currentStream = null;
    setStreamingState(false);
    document.getElementById('agentInput')?.focus();
  }
}

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

/**
 * Abort the current streaming response.
 */
async function abortStream() {
  if (!isStreaming || !currentStream) return;

  try {
    currentStream.abort();
  } catch (_) {
    // ignore
  }

  try {
    await window.electronAPI.abortQuery(currentChatId, 'browser');
  } catch (_) {
    // ignore
  }

  isStreaming = false;
  currentStream = null;
  setStreamingState(false);
}

// ---------------------------------------------------------------------------
// Streaming State UI
// ---------------------------------------------------------------------------

/**
 * Update the send button and input state based on streaming status.
 * @param {boolean} streaming
 */
function setStreamingState(streaming) {
  const sendBtn = document.getElementById('sendBtn');
  const sendIcon = sendBtn?.querySelector('.send-icon');
  const stopIcon = sendBtn?.querySelector('.stop-icon');

  if (streaming) {
    sendBtn?.classList.add('streaming');
    sendBtn?.removeAttribute('disabled');
    sendIcon?.classList.add('hidden');
    stopIcon?.classList.remove('hidden');
  } else {
    sendBtn?.classList.remove('streaming');
    sendIcon?.classList.remove('hidden');
    stopIcon?.classList.add('hidden');
    updateSendButtonState();
  }
}

/**
 * Enable/disable the send button based on whether the input has text.
 */
function updateSendButtonState() {
  const inputEl = document.getElementById('agentInput');
  const sendBtn = document.getElementById('sendBtn');
  if (!inputEl || !sendBtn) return;

  if (isStreaming) return; // Don't change during streaming

  sendBtn.disabled = !inputEl.value.trim();
}

// ---------------------------------------------------------------------------
// Input Handling
// ---------------------------------------------------------------------------

/**
 * Auto-resize the textarea to fit its content.
 * @param {HTMLTextAreaElement} textarea
 */
function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

/**
 * Initialize the agent sidebar input: form submit, keydown, auto-resize.
 */
function initAgentInput() {
  const form = document.getElementById('agentForm');
  const inputEl = document.getElementById('agentInput');
  const sendBtn = document.getElementById('sendBtn');

  if (!form || !inputEl) return;

  // Form submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (isStreaming) {
      abortStream();
    } else {
      sendMessage(inputEl.value);
    }
  });

  // Enter to send (Shift+Enter for newline)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        abortStream();
      } else if (inputEl.value.trim()) {
        sendMessage(inputEl.value);
      }
    }
  });

  // Auto-resize on input
  inputEl.addEventListener('input', () => {
    autoResizeTextarea(inputEl);
    updateSendButtonState();
  });

  // Initial button state
  updateSendButtonState();
}

// ---------------------------------------------------------------------------
// Navigation Bar Handlers
// ---------------------------------------------------------------------------

/**
 * Wire up the URL bar and navigation buttons.
 */
function initNavigation() {
  const urlInput = document.getElementById('urlInput');
  const backBtn = document.getElementById('backBtn');
  const forwardBtn = document.getElementById('forwardBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const summarizeBtn = document.getElementById('summarizeBtn');
  const newTabBtn = document.getElementById('newTabBtn');

  // URL bar: Enter to navigate
  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        navigate(urlInput.value);
        urlInput.blur();
      }
    });

    // Select all on focus for easy URL replacement
    urlInput.addEventListener('focus', () => {
      urlInput.select();
    });

    // Restore current URL
    if (currentUrl) {
      urlInput.value = currentUrl;
    }
  }

  // Back button (placeholder - would use WebContentsView history)
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      // TODO: IPC to main process for webContents.goBack()
      console.log('Browser: back');
    });
  }

  // Forward button (placeholder)
  if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
      // TODO: IPC to main process for webContents.goForward()
      console.log('Browser: forward');
    });
  }

  // Refresh button (placeholder)
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (currentUrl) {
        navigate(currentUrl);
      }
      console.log('Browser: refresh');
    });
  }

  // Summarize button: sends a summarize request to the agent
  if (summarizeBtn) {
    summarizeBtn.addEventListener('click', () => {
      if (!currentUrl) return;
      sendMessage(`Summarize the content of the current page: ${currentUrl}`);
    });
  }

  // New tab button
  if (newTabBtn) {
    newTabBtn.addEventListener('click', () => {
      addTab();
    });
  }
}

// ---------------------------------------------------------------------------
// Model Selector
// ---------------------------------------------------------------------------

/**
 * Initialize model selector and sync with state.
 */
function initModelSelector() {
  const selectEl = document.getElementById('modelSelect');
  if (!selectEl) return;

  // Restore saved model
  if (selectedModel) {
    selectEl.value = selectedModel;
  }

  selectEl.addEventListener('change', (e) => {
    selectedModel = e.target.value;
    state.set('selectedModel', selectedModel);
  });
}

// ---------------------------------------------------------------------------
// Restore Messages
// ---------------------------------------------------------------------------

/**
 * Restore messages from state into the agent sidebar for the current chat.
 */
function restoreMessages() {
  if (!messageList) return;

  const messages = getMessages(currentChatId);
  if (messages.length === 0) {
    showAgentEmptyState();
    return;
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      messageList.addUserMessage(msg.content);
    } else if (msg.role === 'assistant') {
      const handle = messageList.addAssistantMessage();
      handle.removeLoading();

      const mdStream = createMarkdownStream(handle.contentEl);
      mdStream.append(msg.content);
      mdStream.finish();

      handle.contentEl.dataset.rawContent = msg.content;
      handle.showActions();
    }
  }

  messageList.scrollToBottom(true);
}

/**
 * Show empty state in the agent messages area.
 */
function showAgentEmptyState() {
  const messagesEl = document.getElementById('agentMessages');
  if (!messagesEl) return;

  if (messagesEl.querySelector('.agent-empty-state')) return;

  const emptyDiv = document.createElement('div');
  emptyDiv.className = 'agent-empty-state';
  emptyDiv.innerHTML = `
    <p>Ask me to browse the web, summarize pages, or interact with sites.</p>
  `;
  messagesEl.appendChild(emptyDiv);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the browser surface on DOM ready.
 */
function init() {
  const messagesEl = document.getElementById('agentMessages');

  if (!messagesEl) {
    console.error('Browser surface: required DOM elements not found');
    return;
  }

  // Create message list component for agent sidebar
  messageList = createMessageList(messagesEl);

  // Render initial tabs
  renderTabs();

  // Wire up navigation
  initNavigation();

  // Wire up agent input
  initAgentInput();

  // Wire up model selector
  initModelSelector();

  // Wire up panel resize
  initPanelResize();

  // Restore context
  if (currentUrl) {
    updateContext(currentUrl);
    updateBrowserContent(currentUrl);
  }

  // Restore agent messages
  restoreMessages();

  // Focus the URL bar initially
  document.getElementById('urlInput')?.focus();

  // Save currentChatId to state
  state.set('currentChatId', currentChatId);

  // Listen for surface change events
  window.electronAPI?.onSurfaceChanged?.((surfaceName) => {
    if (surfaceName === 'browser') {
      document.getElementById('urlInput')?.focus();
    }
  });

  console.log('Browser surface initialized', {
    chatId: currentChatId,
    model: selectedModel,
    tabs: tabs.length,
    url: currentUrl || '(none)'
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for potential use by other modules
export { navigate, sendMessage, abortStream, addTab, closeTab };
