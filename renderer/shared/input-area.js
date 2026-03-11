/**
 * Reusable input area component module.
 *
 * Renders a chat input area with an auto-expanding textarea, send/stop button,
 * file attachment button, and model selector display. Supports Enter to send,
 * Shift+Enter for newline, and loading state management.
 *
 * Uses CSS classes and variables from the existing stylesheet:
 *   .input-container, .input-form, .input-wrapper, .message-input,
 *   .input-controls, .left-controls, .right-controls, .control-btn,
 *   .send-btn, .send-icon, .stop-icon, .file-input-hidden, .attached-files
 *
 * @module input-area
 */

/**
 * Escape HTML entities for safe display.
 * @param {string} str
 * @returns {string}
 * @private
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Auto-resize a textarea to fit its content, up to a maximum height.
 * @param {HTMLTextAreaElement} textarea
 * @param {number} [maxHeight=200]
 * @private
 */
function autoResizeTextarea(textarea, maxHeight = 200) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
}

/**
 * Create a reusable input area component.
 *
 * This function takes an existing container element and attaches event handlers
 * to the expected DOM structure within it. It does NOT create DOM elements from
 * scratch -- it binds to elements that already exist in the HTML template.
 *
 * Expected DOM structure inside containerEl:
 * ```html
 * <form class="input-form">
 *   <div class="input-wrapper">
 *     <textarea class="message-input" ...></textarea>
 *     <div class="input-controls">
 *       <div class="left-controls">
 *         <input type="file" class="file-input-hidden" multiple />
 *         <button type="button" class="control-btn attach-btn">...</button>
 *       </div>
 *       <div class="right-controls">
 *         <button type="submit" class="send-btn">
 *           <svg class="send-icon">...</svg>
 *           <svg class="stop-icon hidden">...</svg>
 *         </button>
 *       </div>
 *     </div>
 *   </div>
 * </form>
 * ```
 *
 * @param {HTMLElement} containerEl - The container element holding the input form.
 * @param {Object} [options]
 * @param {string} [options.placeholder='Ask me anything'] - Textarea placeholder text.
 * @param {number} [options.maxFiles=5] - Maximum number of attached files.
 * @param {number} [options.maxHeight=200] - Maximum textarea height in pixels.
 * @returns {InputArea}
 *
 * @typedef {Object} InputArea
 * @property {Function} onSubmit - Register a submit handler.
 * @property {Function} onAbort - Register an abort handler.
 * @property {Function} setValue - Set the textarea value.
 * @property {Function} getValue - Get the current textarea value.
 * @property {Function} setModel - Update the model selector display text.
 * @property {Function} setLoading - Toggle loading state.
 * @property {Function} focus - Focus the textarea.
 * @property {Function} getAttachedFiles - Get the list of attached files.
 * @property {Function} clearAttachedFiles - Clear all attached files.
 *
 * @example
 * const input = createInputArea(document.getElementById('chatForm').parentElement, {
 *   placeholder: 'Reply...'
 * });
 *
 * input.onSubmit((text, files) => {
 *   console.log('User sent:', text, files);
 * });
 *
 * input.onAbort(() => {
 *   console.log('User clicked stop');
 * });
 *
 * input.setLoading(true);  // show stop button, disable input
 * input.setLoading(false); // show send button, enable input
 */
export function createInputArea(containerEl, options = {}) {
  const {
    placeholder = 'Ask me anything',
    maxFiles = 5,
    maxHeight = 200
  } = options;

  // Find DOM elements
  const form = containerEl.querySelector('.input-form') || containerEl.querySelector('form');
  const textarea = containerEl.querySelector('.message-input') || containerEl.querySelector('textarea');
  const sendBtn = containerEl.querySelector('.send-btn');
  const sendIcon = sendBtn?.querySelector('.send-icon');
  const stopIcon = sendBtn?.querySelector('.stop-icon');
  const attachBtn = containerEl.querySelector('.attach-btn');
  const fileInput = containerEl.querySelector('.file-input-hidden') || containerEl.querySelector('input[type="file"]');
  const modelLabel = containerEl.querySelector('.model-selector .model-label');

  let isLoading = false;
  let attachedFiles = [];
  let submitHandler = null;
  let abortHandler = null;

  // Set placeholder
  if (textarea && placeholder) {
    textarea.placeholder = placeholder;
  }

  /**
   * Update the send button's visual state.
   */
  function updateSendButton() {
    if (!sendBtn) return;

    if (isLoading) {
      sendBtn.disabled = false;
      sendBtn.classList.add('streaming');
      if (sendIcon) sendIcon.classList.add('hidden');
      if (stopIcon) stopIcon.classList.remove('hidden');
    } else {
      sendBtn.disabled = !(textarea && textarea.value.trim());
      sendBtn.classList.remove('streaming');
      if (sendIcon) sendIcon.classList.remove('hidden');
      if (stopIcon) stopIcon.classList.add('hidden');
    }
  }

  /**
   * Render attached files preview inside the input wrapper.
   */
  function renderAttachedFiles() {
    const inputWrapper = containerEl.querySelector('.input-wrapper');
    if (!inputWrapper) return;

    let filesContainer = inputWrapper.querySelector('.attached-files');

    if (attachedFiles.length === 0) {
      if (filesContainer) filesContainer.remove();
      return;
    }

    if (!filesContainer) {
      filesContainer = document.createElement('div');
      filesContainer.className = 'attached-files';
      inputWrapper.insertBefore(filesContainer, inputWrapper.firstChild);
    }

    filesContainer.innerHTML = attachedFiles.map((file, index) => `
      <div class="attached-file" data-index="${index}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <span>${escapeHtml(file.name)}</span>
        <svg class="remove-file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </div>
    `).join('');

    // Attach remove handlers
    filesContainer.querySelectorAll('.remove-file').forEach(removeBtn => {
      removeBtn.addEventListener('click', (e) => {
        const fileDiv = e.target.closest('.attached-file');
        const idx = parseInt(fileDiv.dataset.index, 10);
        attachedFiles.splice(idx, 1);
        renderAttachedFiles();
      });
    });
  }

  /**
   * Handle file selection from the file input.
   * @param {Event} event
   */
  function handleFileSelect(event) {
    const files = Array.from(event.target.files);

    for (const file of files) {
      if (attachedFiles.length >= maxFiles) {
        break;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        attachedFiles.push({
          name: file.name,
          type: file.type,
          size: file.size,
          data: e.target.result
        });
        renderAttachedFiles();
      };

      if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    }

    // Reset file input so the same file can be re-selected
    event.target.value = '';
  }

  // Wire up event listeners
  if (textarea) {
    textarea.addEventListener('input', () => {
      updateSendButton();
      autoResizeTextarea(textarea, maxHeight);
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

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      if (isLoading) {
        // In loading state, the submit button acts as abort
        if (typeof abortHandler === 'function') {
          abortHandler();
        }
        return;
      }

      const text = textarea ? textarea.value.trim() : '';
      if (!text) return;

      if (typeof submitHandler === 'function') {
        submitHandler(text, [...attachedFiles]);
      }
    });
  }

  if (attachBtn && fileInput) {
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
  }

  // Initialize button state
  updateSendButton();

  return {
    /**
     * Register a handler called when the user submits a message.
     * @param {Function} callback - Called with `(text: string, files: Array)`.
     */
    onSubmit(callback) {
      submitHandler = callback;
    },

    /**
     * Register a handler called when the user clicks the stop/abort button.
     * @param {Function} callback - Called with no arguments.
     */
    onAbort(callback) {
      abortHandler = callback;
    },

    /**
     * Set the textarea value programmatically.
     * @param {string} text
     */
    setValue(text) {
      if (textarea) {
        textarea.value = text;
        autoResizeTextarea(textarea, maxHeight);
        updateSendButton();
      }
    },

    /**
     * Get the current textarea value.
     * @returns {string}
     */
    getValue() {
      return textarea ? textarea.value : '';
    },

    /**
     * Update the model selector display text.
     * @param {string} modelName - The label to display (e.g., 'Sonnet 4.5').
     */
    setModel(modelName) {
      if (modelLabel) {
        modelLabel.textContent = modelName;
      }
    },

    /**
     * Toggle the loading/streaming state.
     *
     * When loading is true:
     *   - Send button shows the stop icon
     *   - Textarea is visually dimmed (but not disabled, so user can still see it)
     *
     * When loading is false:
     *   - Send button shows the send icon
     *   - Send button is enabled only if textarea has content
     *
     * @param {boolean} loading
     */
    setLoading(loading) {
      isLoading = loading;
      updateSendButton();

      if (textarea) {
        textarea.style.opacity = loading ? '0.6' : '1';
      }
    },

    /**
     * Focus the textarea.
     */
    focus() {
      if (textarea) {
        textarea.focus();
      }
    },

    /**
     * Reset the textarea height and clear its value.
     */
    reset() {
      if (textarea) {
        textarea.value = '';
        textarea.style.height = 'auto';
        updateSendButton();
      }
    },

    /**
     * Get the current list of attached files.
     * @returns {Array<{name: string, type: string, size: number, data: string}>}
     */
    getAttachedFiles() {
      return [...attachedFiles];
    },

    /**
     * Clear all attached files and remove the preview.
     */
    clearAttachedFiles() {
      attachedFiles = [];
      renderAttachedFiles();
    }
  };
}
