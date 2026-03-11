/**
 * cowork.js - Cowork Surface Logic
 *
 * Manages the autonomous agent workspace surface: empty/active state transitions,
 * folder picker, SSE streaming with markdown rendering, thinking sections,
 * tool call visualization (both inline and activity feed sidebar), model
 * selection, and message history persistence.
 *
 * This is the "power mode" surface where Claude operates with full agent
 * capabilities (Read, Write, Edit, Bash, Glob, Grep, WebSearch, Agent, TodoWrite).
 *
 * @module cowork
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

const state = createStateManager('nibcowork:cowork');

/** @type {string} Current active chat ID */
let currentChatId = state.get('currentChatId') || newChatId();

/** @type {string|null} Selected working folder path */
let selectedFolder = state.get('selectedFolder') || null;

/** @type {string} Currently selected model (default opus for cowork) */
let selectedModel = state.get('selectedModel') || 'opus';

/** @type {boolean} Whether we are currently streaming a response */
let isStreaming = false;

/** @type {{ abort: Function } | null} Current stream connection for abort */
let currentStream = null;

/** @type {ReturnType<typeof createMessageList> | null} Message list component */
let messageList = null;

/** @type {Array<Object>} Tracked tool calls for the activity feed */
let toolCalls = [];

/** @type {number} Total tool call count across all messages */
let totalToolCallCount = 0;

/** @type {number|null} Interval ID for updating running tool call elapsed times */
let timerIntervalId = null;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Generate a new chat ID using crypto.randomUUID.
 * @returns {string}
 */
function newChatId() {
  return crypto.randomUUID();
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

/**
 * Get an icon for a given tool name.
 * @param {string} name - Tool name
 * @returns {string} Emoji icon
 */
function getToolIcon(name) {
  const icons = {
    Read: '\u{1F4C4}',
    Write: '\u{1F4DD}',
    Edit: '\u{270F}\u{FE0F}',
    Bash: '\u{1F4BB}',
    Glob: '\u{1F50D}',
    Grep: '\u{1F50E}',
    WebSearch: '\u{1F310}',
    WebFetch: '\u{1F310}',
    Agent: '\u{1F916}',
    TodoWrite: '\u{1F4CB}',
  };
  return icons[name] || '\u{1F527}';
}

/**
 * Format elapsed time in seconds.
 * @param {number} startMs - Start timestamp in milliseconds
 * @returns {string} Formatted time (e.g., "3s", "1m 23s")
 */
function formatElapsed(startMs) {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}m ${secs}s`;
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

// ---------------------------------------------------------------------------
// UI State Management
// ---------------------------------------------------------------------------

/**
 * Transition from empty state to active state.
 */
function showActiveState() {
  const emptyState = document.getElementById('emptyState');
  const activeState = document.getElementById('activeState');

  if (emptyState) emptyState.classList.add('hidden');
  if (activeState) activeState.classList.remove('hidden');
}

/**
 * Transition from active state to empty state.
 */
function showEmptyState() {
  const emptyState = document.getElementById('emptyState');
  const activeState = document.getElementById('activeState');

  if (emptyState) emptyState.classList.remove('hidden');
  if (activeState) activeState.classList.add('hidden');
}

/**
 * Update the activity count badge in the sidebar.
 */
function updateActivityCount() {
  const countEl = document.getElementById('activityCount');
  if (countEl) {
    countEl.textContent = `${totalToolCallCount} tool call${totalToolCallCount !== 1 ? 's' : ''}`;
  }
}

// ---------------------------------------------------------------------------
// Tool Activity Feed
// ---------------------------------------------------------------------------

/**
 * Add a tool call to the activity feed sidebar.
 *
 * @param {Object} toolData
 * @param {string} toolData.name - Tool name
 * @param {string} toolData.id - Tool call ID
 * @param {Object} toolData.input - Tool input parameters
 * @returns {HTMLElement} The created activity item element
 */
function addToolCall(toolData) {
  const feedEl = document.getElementById('activityFeed');
  if (!feedEl) return null;

  const startTime = Date.now();
  totalToolCallCount++;
  updateActivityCount();

  const item = document.createElement('div');
  item.className = 'activity-item running';
  item.dataset.toolId = toolData.id;
  item.dataset.startTime = String(startTime);

  const inputStr = JSON.stringify(toolData.input, null, 2);

  item.innerHTML = `
    <div class="activity-item-header">
      <span class="activity-icon">${getToolIcon(toolData.name)}</span>
      <span class="activity-name">${escapeHtml(toolData.name)}</span>
      <span class="activity-status"><span class="spinner spinner-sm"></span></span>
      <span class="activity-time" data-start="${startTime}">0s</span>
    </div>
    <div class="activity-item-details hidden">
      <pre class="activity-input">${escapeHtml(inputStr)}</pre>
    </div>
  `;

  // Click header to expand/collapse details
  const header = item.querySelector('.activity-item-header');
  header.addEventListener('click', () => {
    const details = item.querySelector('.activity-item-details');
    if (details) {
      details.classList.toggle('hidden');
    }
  });

  // Track the tool call
  toolCalls.push({
    id: toolData.id,
    name: toolData.name,
    startTime,
    element: item,
    status: 'running'
  });

  // Insert at the top of the feed (newest first)
  feedEl.insertBefore(item, feedEl.firstChild);

  // Ensure timer is running
  startElapsedTimer();

  return item;
}

/**
 * Update a tool call in the activity feed with its result.
 *
 * @param {string} toolId - The tool call ID
 * @param {Object} result
 * @param {*} result.output - Tool output
 * @param {boolean} result.isError - Whether the result is an error
 */
function updateToolCallResult(toolId, { output, isError = false }) {
  const tracked = toolCalls.find(tc => tc.id === toolId);
  if (!tracked) return;

  tracked.status = isError ? 'error' : 'complete';
  const item = tracked.element;

  // Update class
  item.classList.remove('running');
  item.classList.add(tracked.status);

  // Remove spinner
  const statusEl = item.querySelector('.activity-status');
  if (statusEl) {
    statusEl.innerHTML = '';
  }

  // Freeze elapsed time
  const timeEl = item.querySelector('.activity-time');
  if (timeEl) {
    timeEl.textContent = formatElapsed(tracked.startTime);
  }

  // Add output to details
  const detailsEl = item.querySelector('.activity-item-details');
  if (detailsEl && output) {
    const resultStr = typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output);
    const truncated = resultStr.length > 1000
      ? resultStr.substring(0, 1000) + '...'
      : resultStr;

    const outputPre = document.createElement('pre');
    outputPre.className = isError ? 'activity-output error' : 'activity-output';
    outputPre.textContent = truncated;
    detailsEl.appendChild(outputPre);
  }
}

/**
 * Start the interval timer that updates elapsed time for running tool calls.
 */
function startElapsedTimer() {
  if (timerIntervalId !== null) return;

  timerIntervalId = setInterval(() => {
    const running = toolCalls.filter(tc => tc.status === 'running');

    if (running.length === 0) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
      return;
    }

    for (const tc of running) {
      const timeEl = tc.element.querySelector('.activity-time');
      if (timeEl) {
        timeEl.textContent = formatElapsed(tc.startTime);
      }
    }
  }, 1000);
}

/**
 * Clear all tool calls from the activity feed.
 */
function clearActivityFeed() {
  const feedEl = document.getElementById('activityFeed');
  if (feedEl) feedEl.innerHTML = '';
  toolCalls = [];
  totalToolCallCount = 0;
  updateActivityCount();

  if (timerIntervalId !== null) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

// ---------------------------------------------------------------------------
// Stream Processing
// ---------------------------------------------------------------------------

/**
 * Process an SSE stream from the server and render chunks into the assistant
 * message content element. Also feeds tool calls to the activity panel.
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

          // Auto-scroll
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
          // Before inserting a tool card, advance the markdown chunk
          if (markdownStream) {
            markdownStream.nextChunk();
          }

          // Render inline in the conversation
          renderToolCall(contentEl, {
            toolName: event.name || 'Unknown Tool',
            toolId: event.id || `tool_${Date.now()}`,
            input: event.input || {}
          });

          // Add to the activity feed sidebar
          addToolCall({
            name: event.name || 'Unknown Tool',
            id: event.id || `tool_${Date.now()}`,
            input: event.input || {}
          });

          if (messageList) {
            messageList.scrollToBottom();
          }
          break;
        }

        case 'tool_result': {
          const toolId = event.id || '';
          const output = event.result || event.content || '';
          const isError = event.is_error || false;

          // Update inline tool card in conversation
          updateToolResult(contentEl, { toolId, output, isError });

          // Update activity feed sidebar
          updateToolCallResult(toolId, { output, isError });

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
          errorDiv.style.cssText = `color: var(--error); padding: var(--space-2) 0; font-size: var(--text-sm);`;
          errorDiv.textContent = event.content || event.error || 'An error occurred';
          contentEl.appendChild(errorDiv);
          break;
        }

        case 'done': {
          break;
        }

        default: {
          // Handle any text content in unknown event types
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
    // AbortError is expected when user clicks stop
    if (err.name !== 'AbortError') {
      console.error('Stream processing error:', err);
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `color: var(--error); padding: var(--space-2) 0; font-size: var(--text-sm);`;
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
// Send Message
// ---------------------------------------------------------------------------

/**
 * Send a user message and stream the assistant response.
 *
 * @param {string} text - The message text
 */
async function sendMessage(text) {
  if (!text.trim() || isStreaming) return;

  // Transition to active state
  showActiveState();

  // 1. Add user message to UI
  messageList.addUserMessage(text);

  // Save user message to state
  saveMessage(currentChatId, { role: 'user', content: text });

  // 2. Set loading state
  setInputLoading(true);
  isStreaming = true;

  // 3. Create assistant message placeholder
  const assistantHandle = messageList.addAssistantMessage();

  try {
    // 4. Send to backend via electronAPI
    const response = await window.electronAPI.sendMessage(
      text,
      currentChatId,
      'cowork',
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

    // 6. Create SSE reader and process stream
    const sseReader = createSSEReader(readerWrapper);
    await processStream(sseReader, assistantHandle);

  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Send message error:', err);
      assistantHandle.removeLoading();
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `color: var(--error); padding: var(--space-2) 0; font-size: var(--text-sm);`;
      errorDiv.textContent = `Failed to send message: ${err.message}`;
      assistantHandle.contentEl.appendChild(errorDiv);
    }
  } finally {
    // 7. Reset streaming state
    isStreaming = false;
    currentStream = null;
    setInputLoading(false);
    focusInput();
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
    await window.electronAPI.abortQuery(currentChatId, 'cowork');
  } catch (_) {
    // ignore
  }

  isStreaming = false;
  currentStream = null;
  setInputLoading(false);
}

// ---------------------------------------------------------------------------
// Input Area Management
// ---------------------------------------------------------------------------

/**
 * Auto-resize textarea to fit content.
 * @param {HTMLTextAreaElement} textarea
 */
function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
}

/**
 * Update the send button state.
 */
function updateSendButton() {
  const sendBtn = document.getElementById('sendBtn');
  const textarea = document.getElementById('messageInput');
  if (!sendBtn || !textarea) return;

  if (isStreaming) {
    sendBtn.disabled = false;
    sendBtn.classList.add('streaming');
    sendBtn.textContent = 'Stop';
  } else {
    sendBtn.disabled = !textarea.value.trim();
    sendBtn.classList.remove('streaming');
    sendBtn.innerHTML = `
      Let's go
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    `;
  }
}

/**
 * Set loading/streaming state on the input area.
 * @param {boolean} loading
 */
function setInputLoading(loading) {
  const textarea = document.getElementById('messageInput');
  if (textarea) {
    textarea.style.opacity = loading ? '0.6' : '1';
  }
  updateSendButton();
}

/**
 * Focus the textarea.
 */
function focusInput() {
  const textarea = document.getElementById('messageInput');
  if (textarea) textarea.focus();
}

/**
 * Reset the textarea.
 */
function resetInput() {
  const textarea = document.getElementById('messageInput');
  if (textarea) {
    textarea.value = '';
    textarea.style.height = 'auto';
    updateSendButton();
  }
}

// ---------------------------------------------------------------------------
// Folder Picker
// ---------------------------------------------------------------------------

/**
 * Initialize the folder picker button.
 */
function initFolderPicker() {
  const folderBtn = document.getElementById('folderPicker');
  const folderLabel = document.getElementById('folderLabel');
  if (!folderBtn || !folderLabel) return;

  // Restore saved folder
  if (selectedFolder) {
    const folderName = selectedFolder.split('/').pop() || selectedFolder;
    folderLabel.textContent = folderName;
    folderLabel.classList.add('folder-path-active');
  }

  folderBtn.addEventListener('click', async () => {
    try {
      const folderPath = await window.electronAPI.selectFolder();
      if (folderPath) {
        selectedFolder = folderPath;
        state.set('selectedFolder', selectedFolder);

        const folderName = folderPath.split('/').pop() || folderPath;
        folderLabel.textContent = folderName;
        folderLabel.classList.add('folder-path-active');
      }
    } catch (err) {
      console.error('Folder selection error:', err);
    }
  });
}

// ---------------------------------------------------------------------------
// Model Selector
// ---------------------------------------------------------------------------

/**
 * Initialize the model selector.
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
// New Chat
// ---------------------------------------------------------------------------

/**
 * Start a new cowork session.
 */
function startNewChat() {
  currentChatId = newChatId();
  state.set('currentChatId', currentChatId);

  if (messageList) {
    messageList.clear();
  }

  clearActivityFeed();
  showEmptyState();
  focusInput();
}

// ---------------------------------------------------------------------------
// Restore Messages
// ---------------------------------------------------------------------------

/**
 * Restore messages from state for the current chat.
 */
function restoreMessages() {
  if (!messageList) return;

  const messages = getMessages(currentChatId);
  if (messages.length === 0) return;

  // If we have messages, show the active state
  showActiveState();

  for (const msg of messages) {
    if (msg.role === 'user') {
      messageList.addUserMessage(msg.content);
    } else if (msg.role === 'assistant') {
      const handle = messageList.addAssistantMessage();
      handle.removeLoading();

      // Render the stored content as markdown
      const mdStream = createMarkdownStream(handle.contentEl);
      mdStream.append(msg.content);
      mdStream.finish();

      handle.contentEl.dataset.rawContent = msg.content;
      handle.showActions();
    }
  }

  messageList.scrollToBottom(true);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the cowork surface on DOM ready.
 */
function init() {
  const messageListEl = document.getElementById('messageList');
  const form = document.getElementById('coworkForm');
  const textarea = document.getElementById('messageInput');

  if (!messageListEl) {
    console.error('Cowork surface: messageList element not found');
    return;
  }

  // Create message list component
  messageList = createMessageList(messageListEl);

  // Initialize folder picker
  initFolderPicker();

  // Initialize model selector
  initModelSelector();

  // Wire up textarea events
  if (textarea) {
    textarea.addEventListener('input', () => {
      updateSendButton();
      autoResizeTextarea(textarea);
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (form) {
          form.dispatchEvent(new Event('submit'));
        }
      }
    });
  }

  // Wire up form submission
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      if (isStreaming) {
        abortStream();
        return;
      }

      const text = textarea ? textarea.value.trim() : '';
      if (!text) return;

      resetInput();
      sendMessage(text);
    });
  }

  // Initialize send button state
  updateSendButton();

  // Restore messages for current chat
  restoreMessages();

  // Focus input
  focusInput();

  // Save currentChatId to state
  state.set('currentChatId', currentChatId);

  // Listen for surface change events
  window.electronAPI?.onSurfaceChanged?.((surfaceName) => {
    if (surfaceName === 'cowork') {
      focusInput();
    }
  });

  console.log('Cowork surface initialized', {
    chatId: currentChatId,
    model: selectedModel,
    folder: selectedFolder
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
export { startNewChat, sendMessage, abortStream };
