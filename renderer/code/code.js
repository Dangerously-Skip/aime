/**
 * code.js - Code Surface Logic
 *
 * Terminal-style Claude Code interface with monospace rendering, prompt-like
 * user messages, collapsible tool call blocks with tool-specific formatting,
 * thinking sections, permission mode selector, folder picker, and SSE streaming.
 *
 * @module code
 */

import { createMarkdownStream } from '../shared/markdown-renderer.js';
import { renderThinkingSection } from '../shared/thinking-renderer.js';
import { createSSEReader } from '../shared/sse-parser.js';
import { createStateManager } from '../shared/state-manager.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = createStateManager('nibcowork:code');

/** @type {string} Current active chat ID */
let currentChatId = state.get('currentChatId') || newChatId();

/** @type {string} Selected folder path or null */
let selectedFolder = state.get('selectedFolder') || null;

/** @type {string} Permission mode: acceptEdits | default | plan */
let permissionMode = state.get('permissionMode') || 'acceptEdits';

/** @type {string} Currently selected model value */
let selectedModel = state.get('selectedModel') || 'sonnet';

/** @type {boolean} Whether we are currently streaming a response */
let isStreaming = false;

/** @type {{ abort: Function } | null} Current stream connection for abort */
let currentStream = null;

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

/** @type {HTMLElement} */
let terminalOutput = null;

/** @type {HTMLElement} */
let emptyState = null;

/** @type {HTMLTextAreaElement} */
let messageInput = null;

/** @type {HTMLButtonElement} */
let sendBtn = null;

/** @type {HTMLElement} */
let sessionIndicator = null;

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

/**
 * Scroll the terminal output to the bottom.
 * @param {boolean} [force=false]
 */
function scrollToBottom(force = false) {
  if (!terminalOutput) return;
  const threshold = 50;
  const atBottom = terminalOutput.scrollHeight - terminalOutput.scrollTop - terminalOutput.clientHeight < threshold;
  if (force || atBottom) {
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }
}

/**
 * Update the send button enabled state based on input content.
 */
function updateSendButton() {
  if (!sendBtn || !messageInput) return;

  if (isStreaming) {
    sendBtn.disabled = false;
    sendBtn.classList.add('streaming');
    const sendIcon = sendBtn.querySelector('.send-icon');
    const stopIcon = sendBtn.querySelector('.stop-icon');
    if (sendIcon) sendIcon.classList.add('hidden');
    if (stopIcon) stopIcon.classList.remove('hidden');
  } else {
    sendBtn.disabled = !messageInput.value.trim();
    sendBtn.classList.remove('streaming');
    const sendIcon = sendBtn.querySelector('.send-icon');
    const stopIcon = sendBtn.querySelector('.stop-icon');
    if (sendIcon) sendIcon.classList.remove('hidden');
    if (stopIcon) stopIcon.classList.add('hidden');
  }
}

/**
 * Auto-resize the textarea to fit its content.
 * @param {HTMLTextAreaElement} textarea
 * @param {number} [maxHeight=160]
 */
function autoResizeTextarea(textarea, maxHeight = 160) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
}

/**
 * Update the session indicator state.
 * @param {'idle' | 'active' | 'streaming'} status
 * @param {string} [text='']
 */
function updateSessionIndicator(status, text = '') {
  if (!sessionIndicator) return;
  sessionIndicator.className = 'session-indicator';
  if (status === 'active') {
    sessionIndicator.classList.add('active');
    sessionIndicator.textContent = text || 'Ready';
  } else if (status === 'streaming') {
    sessionIndicator.classList.add('streaming');
    sessionIndicator.textContent = text || 'Working...';
  } else {
    sessionIndicator.textContent = text || '';
  }
}

// ---------------------------------------------------------------------------
// Empty State Management
// ---------------------------------------------------------------------------

/**
 * Hide the empty state when the first message is added.
 */
function hideEmptyState() {
  if (emptyState && !emptyState.classList.contains('hidden')) {
    emptyState.classList.add('hidden');
  }
}

/**
 * Show the empty state (used when clearing terminal or starting new session).
 */
function showEmptyState() {
  if (emptyState) {
    emptyState.classList.remove('hidden');
  }
}

// ---------------------------------------------------------------------------
// Tool Icons and Formatting
// ---------------------------------------------------------------------------

/**
 * Get a text icon character for a tool name.
 * @param {string} toolName
 * @returns {string}
 */
function getToolIcon(toolName) {
  const icons = {
    'Read': '\u{1F4C4}',
    'Write': '\u{270F}\u{FE0F}',
    'Edit': '\u{1F58A}\u{FE0F}',
    'Bash': '$',
    'Grep': '\u{1F50D}',
    'Glob': '\u{1F4C2}',
    'Search': '\u{1F50E}',
    'TodoRead': '\u{2611}\u{FE0F}',
    'TodoWrite': '\u{270F}\u{FE0F}',
    'Task': '\u{1F4CB}',
    'WebFetch': '\u{1F310}',
  };
  return icons[toolName] || '\u{1F527}';
}

/**
 * Format tool input for terminal-style display.
 * Returns a concise human-readable description of what the tool is doing.
 * @param {Object} toolData - Tool data with name and input fields.
 * @returns {string}
 */
function formatToolInput(toolData) {
  const { name, input } = toolData;
  if (!input) return JSON.stringify(toolData, null, 2);

  switch (name) {
    case 'Read':
      return `Reading: ${input.file_path || 'unknown'}`;
    case 'Edit':
      return `Editing: ${input.file_path || 'unknown'}`;
    case 'Write':
      return `Writing: ${input.file_path || 'unknown'}`;
    case 'Bash':
      return `$ ${input.command || 'unknown'}`;
    case 'Glob':
      return `Pattern: ${input.pattern || 'unknown'}`;
    case 'Grep':
      return `Search: ${input.pattern || 'unknown'}` +
        (input.path ? ` in ${input.path}` : '');
    case 'Task':
      return `Task: ${(input.description || '').substring(0, 100)}`;
    case 'TodoRead':
      return 'Reading task list';
    case 'TodoWrite':
      return `Updating tasks: ${(input.tasks || []).length} items`;
    default:
      return JSON.stringify(input, null, 2);
  }
}

// ---------------------------------------------------------------------------
// Terminal Message Rendering
// ---------------------------------------------------------------------------

/**
 * Add a user prompt to the terminal output.
 * @param {string} text - The user's message.
 * @returns {HTMLElement}
 */
function addUserPrompt(text) {
  hideEmptyState();

  const el = document.createElement('div');
  el.className = 'code-message code-user-prompt';
  el.textContent = `> ${text}`;
  terminalOutput.appendChild(el);
  scrollToBottom(true);
  return el;
}

/**
 * Create an assistant output block in the terminal.
 * Returns a handle for streaming content into the block.
 * @returns {Object} Handle with contentEl, removeLoading, showActions methods.
 */
function addAssistantBlock() {
  const el = document.createElement('div');
  el.className = 'code-message code-assistant-output';

  // Loading indicator
  const loadingEl = document.createElement('div');
  loadingEl.className = 'code-loading';
  loadingEl.innerHTML = '<span class="spinner spinner-sm"></span> Working...';
  el.appendChild(loadingEl);

  // Actions (copy button)
  const actionsEl = document.createElement('div');
  actionsEl.className = 'code-message-actions hidden';
  actionsEl.innerHTML = `
    <button class="action-btn" title="Copy">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </button>
  `;

  const copyBtn = actionsEl.querySelector('.action-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const text = el.dataset.rawContent || el.textContent;
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.style.color = 'var(--success)';
        setTimeout(() => { copyBtn.style.color = ''; }, 1000);
      });
    });
  }

  el.appendChild(actionsEl);
  terminalOutput.appendChild(el);
  scrollToBottom(true);

  return {
    element: el,
    contentEl: el,

    removeLoading() {
      const indicator = el.querySelector('.code-loading');
      if (indicator) indicator.remove();
    },

    showActions() {
      actionsEl.classList.remove('hidden');
    },

    hideActions() {
      actionsEl.classList.add('hidden');
    }
  };
}

/**
 * Add a tool call block to the terminal output.
 * @param {Object} toolData - Tool data with name, id, and input.
 * @returns {HTMLElement}
 */
function addToolBlock(toolData) {
  const el = document.createElement('div');
  el.className = 'code-message code-tool-block';
  el.dataset.toolId = toolData.id || `tool_${Date.now()}`;
  el.dataset.tool = toolData.name || 'unknown';

  const formattedInput = formatToolInput(toolData);

  el.innerHTML = `
    <div class="code-tool-header">
      <span class="tool-icon">${getToolIcon(toolData.name)}</span>
      <span class="tool-name">${escapeHtml(toolData.name || 'Unknown')}</span>
      <span class="tool-status running"><span class="spinner spinner-sm"></span></span>
    </div>
    <div class="code-tool-content hidden">
      <pre>${escapeHtml(formattedInput)}</pre>
    </div>
    <div class="code-tool-output hidden"></div>`;

  // Toggle content visibility on header click
  const header = el.querySelector('.code-tool-header');
  header.addEventListener('click', () => {
    el.querySelector('.code-tool-content').classList.toggle('hidden');
  });

  terminalOutput.appendChild(el);
  scrollToBottom();
  return el;
}

/**
 * Update a tool block with its result output.
 * @param {string} toolId - The tool call ID to find.
 * @param {string} output - The output text.
 * @param {boolean} [isError=false] - Whether the result is an error.
 */
function updateToolBlockResult(toolId, output, isError = false) {
  const toolEl = terminalOutput.querySelector(`.code-tool-block[data-tool-id="${toolId}"]`);
  if (!toolEl) return;

  // Update status indicator
  const statusEl = toolEl.querySelector('.tool-status');
  if (statusEl) {
    if (isError) {
      statusEl.className = 'tool-status error';
      statusEl.textContent = 'Error';
    } else {
      statusEl.className = 'tool-status success';
      statusEl.textContent = 'Done';
    }
  }

  // Populate output section
  const outputEl = toolEl.querySelector('.code-tool-output');
  if (outputEl) {
    const resultStr = typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output);
    const maxLength = 2000;
    outputEl.textContent = resultStr.substring(0, maxLength) + (resultStr.length > maxLength ? '...' : '');
    outputEl.classList.remove('hidden');
    if (isError) {
      outputEl.classList.add('error');
    }
  }

  scrollToBottom();
}

/**
 * Add an error block to the terminal output.
 * @param {string} message - Error message text.
 * @returns {HTMLElement}
 */
function addErrorBlock(message) {
  const el = document.createElement('div');
  el.className = 'code-message code-error';
  el.textContent = message;
  terminalOutput.appendChild(el);
  scrollToBottom(true);
  return el;
}

// ---------------------------------------------------------------------------
// Stream Processing
// ---------------------------------------------------------------------------

/**
 * Process an SSE stream from the server and render chunks in terminal style.
 *
 * @param {AsyncGenerator} sseReader - Async generator from createSSEReader.
 * @param {Object} assistantHandle - Handle from addAssistantBlock().
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
          scrollToBottom();
          break;
        }

        case 'thinking': {
          // Wrap in a code-thinking container for terminal styling
          let thinkingWrapper = contentEl.querySelector('.code-thinking');
          if (!thinkingWrapper) {
            thinkingWrapper = document.createElement('div');
            thinkingWrapper.className = 'code-thinking';
            contentEl.insertBefore(thinkingWrapper, contentEl.firstChild);
          }

          if (!thinkingStream) {
            thinkingStream = renderThinkingSection(thinkingWrapper);
          }
          thinkingStream.append(event.content || '');
          scrollToBottom();
          break;
        }

        case 'tool_use': {
          // Before inserting a tool card, advance the markdown chunk
          if (markdownStream) {
            markdownStream.nextChunk();
          }

          addToolBlock({
            name: event.name || 'Unknown Tool',
            id: event.id || `tool_${Date.now()}`,
            input: event.input || {}
          });

          scrollToBottom();
          break;
        }

        case 'tool_result': {
          updateToolBlockResult(
            event.id || '',
            event.result || event.content || '',
            event.is_error || false
          );
          scrollToBottom();
          break;
        }

        case 'assistant': {
          // Server-side session message -- no UI action needed
          break;
        }

        case 'error': {
          removeStreamingCursor(contentEl);
          addErrorBlock(event.content || event.error || 'An error occurred');
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
      addErrorBlock(`Stream error: ${err.message}`);
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
 * Send a user message and stream the assistant response in the terminal.
 * @param {string} text - The message text.
 */
async function sendMessage(text) {
  if (!text.trim() || isStreaming) return;

  // Hide empty state on first message
  hideEmptyState();

  // 1. Add user prompt to terminal
  addUserPrompt(text);

  // Save user message to state
  saveMessage(currentChatId, { role: 'user', content: text });

  // 2. Clear input and set loading state
  if (messageInput) {
    messageInput.value = '';
    messageInput.style.height = 'auto';
  }
  isStreaming = true;
  updateSendButton();
  updateSessionIndicator('streaming');

  // 3. Create assistant output block
  const assistantHandle = addAssistantBlock();

  try {
    // 4. Send to backend via electronAPI
    const response = await window.electronAPI.sendMessage(
      text,
      currentChatId,
      'code',
      selectedModel
    );

    currentStream = response;

    // 5. Wrap the response to be compatible with createSSEReader
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
      addErrorBlock(`Failed to send message: ${err.message}`);
    }
  } finally {
    // 7. Reset streaming state
    isStreaming = false;
    currentStream = null;
    updateSendButton();
    updateSessionIndicator('active');
    if (messageInput) messageInput.focus();
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
    await window.electronAPI.abortQuery(currentChatId, 'code');
  } catch (_) {
    // ignore
  }

  isStreaming = false;
  currentStream = null;
  updateSendButton();
  updateSessionIndicator('active');
}

// ---------------------------------------------------------------------------
// Folder Picker
// ---------------------------------------------------------------------------

/**
 * Open the native folder selection dialog and update state.
 */
async function selectFolder() {
  try {
    const folderPath = await window.electronAPI.selectFolder();
    if (folderPath) {
      selectedFolder = folderPath;
      state.set('selectedFolder', selectedFolder);
      updateFolderLabel();
    }
  } catch (err) {
    console.error('Folder selection failed:', err);
  }
}

/**
 * Update the folder label display in the bottom bar.
 */
function updateFolderLabel() {
  const folderLabel = document.getElementById('folderLabel');
  if (!folderLabel) return;

  if (selectedFolder) {
    // Show the last folder name from the path
    const parts = selectedFolder.split('/').filter(Boolean);
    const folderName = parts[parts.length - 1] || selectedFolder;
    folderLabel.innerHTML = `<span class="folder-path">${escapeHtml(folderName)}</span>`;
  } else {
    folderLabel.textContent = 'Select folder';
  }
}

// ---------------------------------------------------------------------------
// New Session
// ---------------------------------------------------------------------------

/**
 * Start a new code session. Clears the terminal and generates a new chatId.
 */
function startNewSession() {
  currentChatId = newChatId();
  state.set('currentChatId', currentChatId);

  // Clear all messages from terminal (keep empty state)
  const messages = terminalOutput.querySelectorAll('.code-message');
  messages.forEach(msg => msg.remove());

  showEmptyState();
  updateSessionIndicator('idle');
  if (messageInput) messageInput.focus();
}

// ---------------------------------------------------------------------------
// Restore Messages
// ---------------------------------------------------------------------------

/**
 * Restore messages from state into the terminal for the current chat.
 */
function restoreMessages() {
  const messages = getMessages(currentChatId);
  if (messages.length === 0) {
    showEmptyState();
    return;
  }

  hideEmptyState();

  for (const msg of messages) {
    if (msg.role === 'user') {
      addUserPrompt(msg.content);
    } else if (msg.role === 'assistant') {
      const handle = addAssistantBlock();
      handle.removeLoading();

      // Render stored content as markdown
      const mdStream = createMarkdownStream(handle.contentEl);
      mdStream.append(msg.content);
      mdStream.finish();

      handle.contentEl.dataset.rawContent = msg.content;
      handle.showActions();
    }
  }

  scrollToBottom(true);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the code surface on DOM ready.
 */
function init() {
  terminalOutput = document.getElementById('terminalOutput');
  emptyState = document.getElementById('emptyState');
  messageInput = document.getElementById('messageInput');
  sendBtn = document.getElementById('sendBtn');
  sessionIndicator = document.getElementById('sessionIndicator');

  const form = document.getElementById('codeForm');
  const permissionSelect = document.getElementById('permissionSelect');
  const modelSelect = document.getElementById('modelSelect');
  const folderSelectBtn = document.getElementById('folderSelectBtn');

  if (!terminalOutput || !messageInput) {
    console.error('Code surface: required DOM elements not found');
    return;
  }

  // --- Permission mode selector ---
  if (permissionSelect) {
    permissionSelect.value = permissionMode;
    permissionSelect.addEventListener('change', (e) => {
      permissionMode = e.target.value;
      state.set('permissionMode', permissionMode);
    });
  }

  // --- Model selector ---
  if (modelSelect) {
    modelSelect.value = selectedModel;
    modelSelect.addEventListener('change', (e) => {
      selectedModel = e.target.value;
      state.set('selectedModel', selectedModel);
    });
  }

  // --- Folder picker ---
  if (folderSelectBtn) {
    folderSelectBtn.addEventListener('click', selectFolder);
  }
  updateFolderLabel();

  // --- Textarea auto-resize and keyboard handling ---
  messageInput.addEventListener('input', () => {
    updateSendButton();
    autoResizeTextarea(messageInput);
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) {
        abortStream();
      } else if (messageInput.value.trim()) {
        sendMessage(messageInput.value);
      }
    }
  });

  // --- Form submit ---
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (isStreaming) {
        abortStream();
      } else {
        const text = messageInput.value.trim();
        if (text) sendMessage(text);
      }
    });
  }

  // --- Initialize button state ---
  updateSendButton();

  // --- Restore previous session ---
  restoreMessages();

  // --- Session indicator ---
  const hasMessages = getMessages(currentChatId).length > 0;
  updateSessionIndicator(hasMessages ? 'active' : 'idle');

  // Save currentChatId to state
  state.set('currentChatId', currentChatId);

  // --- Listen for surface changes ---
  window.electronAPI?.onSurfaceChanged?.((surfaceName) => {
    if (surfaceName === 'code') {
      messageInput.focus();
    }
  });

  // Focus input
  messageInput.focus();

  console.log('Code surface initialized', {
    chatId: currentChatId,
    model: selectedModel,
    folder: selectedFolder,
    permissionMode
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
export { startNewSession, sendMessage, abortStream, selectFolder };
