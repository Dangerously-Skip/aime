/**
 * chat.js - Chat Surface Logic
 *
 * Manages the main conversational AI surface: greeting display, message
 * send/receive, SSE streaming with markdown rendering, thinking sections,
 * tool call visualization, file attachments, and model selection.
 *
 * @module chat
 */

import { createInputArea } from '../shared/input-area.js';
import { createMessageList } from '../shared/message-list.js';
import { createMarkdownStream } from '../shared/markdown-renderer.js';
import { renderThinkingSection } from '../shared/thinking-renderer.js';
import { renderToolCall, updateToolResult } from '../shared/tool-call-renderer.js';
import { createSSEReader } from '../shared/sse-parser.js';
import { createStateManager } from '../shared/state-manager.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = createStateManager('nibcowork:chat');

/** @type {string} Current active chat ID */
let currentChatId = state.get('currentChatId') || newChatId();

/** @type {string} Currently selected model value */
let selectedModel = state.get('selectedModel') || 'sonnet';

/** @type {boolean} Whether we are currently streaming a response */
let isStreaming = false;

/** @type {{ abort: Function } | null} Current stream connection for abort */
let currentStream = null;

/** @type {ReturnType<typeof createInputArea> | null} Input area component */
let inputArea = null;

/** @type {ReturnType<typeof createMessageList> | null} Message list component */
let messageList = null;

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

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

/**
 * Display a time-based greeting in the chat header.
 */
async function showGreeting() {
  const greetingEl = document.getElementById('greeting');
  if (!greetingEl) return;

  let name = 'there';
  try {
    const userName = await window.electronAPI?.getUserName?.();
    if (userName) {
      // Extract first name from full username (e.g., "adam.witanowski" -> "Adam")
      const firstName = userName.split(/[.\-_\s@]/)[0];
      name = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    }
  } catch (err) {
    console.warn('Could not get username:', err);
  }

  const hour = new Date().getHours();
  let timeGreeting;
  if (hour < 12) {
    timeGreeting = 'Good morning';
  } else if (hour < 17) {
    timeGreeting = 'Good afternoon';
  } else {
    timeGreeting = 'Good evening';
  }

  greetingEl.textContent = `${timeGreeting}, ${name}`;
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

/**
 * Show or hide the empty state based on whether there are messages.
 */
function updateEmptyState() {
  const messageListEl = document.getElementById('messageList');
  if (!messageListEl) return;

  const existingEmpty = messageListEl.querySelector('.chat-empty-state');
  const hasMessages = messageListEl.querySelector('.message');

  if (hasMessages && existingEmpty) {
    existingEmpty.remove();
  } else if (!hasMessages && !existingEmpty) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'chat-empty-state';

    const hour = new Date().getHours();
    let emoji;
    if (hour < 12) emoji = 'Rise and shine';
    else if (hour < 17) emoji = 'Let\'s get to work';
    else emoji = 'Burning the midnight oil?';

    emptyDiv.innerHTML = `
      <div class="empty-greeting">What can I help you with?</div>
      <div class="empty-subtext">${emoji}</div>
    `;
    messageListEl.appendChild(emptyDiv);
  }
}

// ---------------------------------------------------------------------------
// Stream Processing
// ---------------------------------------------------------------------------

/**
 * Process an SSE stream from the server and render chunks into the assistant
 * message content element.
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
 * Add a streaming cursor to the last text element in the content area.
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
 * @param {Array} files - Attached files (from input area)
 */
async function sendMessage(text, files) {
  if (!text.trim() || isStreaming) return;

  // Remove empty state if present
  const emptyState = document.getElementById('messageList')?.querySelector('.chat-empty-state');
  if (emptyState) emptyState.remove();

  // 1. Add user message to UI
  messageList.addUserMessage(text, files);

  // Save user message to state
  saveMessage(currentChatId, { role: 'user', content: text });

  // 2. Clear input and set loading
  inputArea.reset();
  inputArea.clearAttachedFiles();
  inputArea.setLoading(true);
  isStreaming = true;

  // 3. Create assistant message placeholder
  const assistantHandle = messageList.addAssistantMessage();

  try {
    // 4. Send to backend via electronAPI
    const response = await window.electronAPI.sendMessage(
      text,
      currentChatId,
      'chat',
      selectedModel
    );

    currentStream = response;

    // 5. Wrap the response to be compatible with createSSEReader
    // The preload returns { read, abort } where read() returns {done, value: string}
    // createSSEReader expects { getReader() } returning { read() }
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
    inputArea.setLoading(false);
    inputArea.focus();
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
    await window.electronAPI.abortQuery(currentChatId, 'chat');
  } catch (_) {
    // ignore
  }

  isStreaming = false;
  currentStream = null;
  inputArea.setLoading(false);
}

// ---------------------------------------------------------------------------
// New Chat
// ---------------------------------------------------------------------------

/**
 * Start a new chat session. Clears the message area and generates a new chatId.
 */
function startNewChat() {
  currentChatId = newChatId();
  state.set('currentChatId', currentChatId);

  if (messageList) {
    messageList.clear();
  }

  updateEmptyState();
  inputArea.focus();
}

// ---------------------------------------------------------------------------
// Restore Messages
// ---------------------------------------------------------------------------

/**
 * Restore messages from state into the message list for the current chat.
 */
function restoreMessages() {
  if (!messageList) return;

  const messages = getMessages(currentChatId);
  if (messages.length === 0) {
    updateEmptyState();
    return;
  }

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
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the chat surface on DOM ready.
 */
function init() {
  const messageListEl = document.getElementById('messageList');
  const inputContainerEl = document.getElementById('inputContainer');

  if (!messageListEl || !inputContainerEl) {
    console.error('Chat surface: required DOM elements not found');
    return;
  }

  // Create message list component
  messageList = createMessageList(messageListEl);

  // Create input area component
  inputArea = createInputArea(inputContainerEl, {
    placeholder: 'How can I help you today?',
    maxFiles: 5,
    maxHeight: 200
  });

  // Wire up submit and abort handlers
  inputArea.onSubmit((text, files) => {
    sendMessage(text, files);
  });

  inputArea.onAbort(() => {
    abortStream();
  });

  // Display greeting
  showGreeting();

  // Initialize model selector
  initModelSelector();

  // Restore messages for current chat
  restoreMessages();

  // Focus input
  inputArea.focus();

  // Save currentChatId to state
  state.set('currentChatId', currentChatId);

  // Listen for new-chat events from sidebar/tabbar
  window.electronAPI?.onSurfaceChanged?.((surfaceName) => {
    if (surfaceName === 'chat') {
      inputArea.focus();
    }
  });

  console.log('Chat surface initialized', { chatId: currentChatId, model: selectedModel });
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
