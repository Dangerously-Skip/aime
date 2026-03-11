/**
 * Message list component module.
 *
 * Manages the chat message container: adding user messages, assistant messages
 * (with streaming handles), system messages, and auto-scrolling.
 *
 * Uses CSS classes from the existing stylesheet:
 *   .message, .message.user, .message.assistant, .message-content,
 *   .message-actions, .action-btn, .loading-indicator, .loading-asterisk
 *
 * @module message-list
 */

/**
 * Escape HTML entities to prevent XSS when rendering user-controlled strings.
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
 * Create a message list component attached to a container element.
 *
 * @param {HTMLElement} containerEl - The messages container element
 *   (e.g., `#chatMessages` / `.messages-container`).
 * @returns {MessageList}
 *
 * @typedef {Object} MessageList
 * @property {Function} addUserMessage - Add a user message bubble.
 * @property {Function} addAssistantMessage - Create an assistant message with loading state.
 * @property {Function} addSystemMessage - Add a system/info message.
 * @property {Function} scrollToBottom - Scroll the container to the bottom.
 * @property {Function} clear - Remove all messages.
 *
 * @example
 * const messages = createMessageList(document.getElementById('chatMessages'));
 * messages.addUserMessage('Hello!');
 * const handle = messages.addAssistantMessage();
 * // ... stream content into handle.contentEl ...
 * handle.showActions();
 */
export function createMessageList(containerEl) {
  let userHasScrolledUp = false;

  // Track whether the user has scrolled away from the bottom
  containerEl.addEventListener('scroll', () => {
    const threshold = 50; // px from bottom
    const atBottom = containerEl.scrollHeight - containerEl.scrollTop - containerEl.clientHeight < threshold;
    userHasScrolledUp = !atBottom;
  });

  return {
    /**
     * Add a user message bubble to the list.
     *
     * @param {string} text - The message text.
     * @param {Array} [attachments=[]] - Optional array of attachment objects
     *   (reserved for future use; currently not rendered).
     * @returns {HTMLElement} The created message element.
     */
    addUserMessage(text, attachments = []) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message user';

      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.textContent = text;

      messageDiv.appendChild(contentDiv);

      // Render attachment previews if provided
      if (attachments.length > 0) {
        const attachmentsDiv = document.createElement('div');
        attachmentsDiv.className = 'message-attachments';
        attachmentsDiv.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;';

        for (const attachment of attachments) {
          const badge = document.createElement('span');
          badge.style.cssText = 'font-size:12px;padding:2px 8px;background:rgba(0,0,0,0.06);border-radius:4px;color:#6b6b6b;';
          badge.textContent = escapeHtml(attachment.name || 'file');
          attachmentsDiv.appendChild(badge);
        }

        messageDiv.appendChild(attachmentsDiv);
      }

      containerEl.appendChild(messageDiv);
      this.scrollToBottom();

      return messageDiv;
    },

    /**
     * Create an assistant message with a loading indicator.
     * Returns a handle for streaming content into the message.
     *
     * @returns {AssistantMessageHandle}
     *
     * @typedef {Object} AssistantMessageHandle
     * @property {HTMLElement} element - The root `.message.assistant` element.
     * @property {HTMLElement} contentEl - The `.message-content` element for appending content.
     * @property {Function} removeLoading - Remove the loading indicator.
     * @property {Function} showActions - Show the action buttons (copy, etc.).
     * @property {Function} hideActions - Hide the action buttons.
     */
    addAssistantMessage() {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message assistant';

      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';

      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'loading-indicator';
      loadingDiv.innerHTML = `
        <svg class="loading-asterisk" viewBox="0 0 24 24" fill="none">
          <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      `;

      contentDiv.appendChild(loadingDiv);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'message-actions hidden';
      actionsDiv.innerHTML = `
        <button class="action-btn" title="Copy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
      `;

      // Attach copy handler to the action button
      const copyBtn = actionsDiv.querySelector('.action-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const text = contentDiv.dataset.rawContent || contentDiv.textContent;
          navigator.clipboard.writeText(text).then(() => {
            copyBtn.style.color = '#27ae60';
            setTimeout(() => {
              copyBtn.style.color = '';
            }, 1000);
          });
        });
      }

      messageDiv.appendChild(contentDiv);
      messageDiv.appendChild(actionsDiv);
      containerEl.appendChild(messageDiv);
      this.scrollToBottom();

      return {
        element: messageDiv,
        contentEl: contentDiv,

        /** Remove the loading indicator. */
        removeLoading() {
          const indicator = contentDiv.querySelector('.loading-indicator');
          if (indicator) indicator.remove();
        },

        /** Show the message action buttons (copy, etc.). */
        showActions() {
          actionsDiv.classList.remove('hidden');
        },

        /** Hide the message action buttons. */
        hideActions() {
          actionsDiv.classList.add('hidden');
        }
      };
    },

    /**
     * Add a system/info message to the list.
     *
     * @param {string} text - The message text.
     * @returns {HTMLElement} The created message element.
     */
    addSystemMessage(text) {
      const messageDiv = document.createElement('div');
      messageDiv.className = 'message system';
      messageDiv.style.cssText = 'justify-content:center;';

      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      contentDiv.style.cssText = 'font-size:13px;color:#6b6b6b;text-align:center;font-style:italic;';
      contentDiv.textContent = text;

      messageDiv.appendChild(contentDiv);
      containerEl.appendChild(messageDiv);
      this.scrollToBottom();

      return messageDiv;
    },

    /**
     * Scroll the messages container to the bottom.
     *
     * @param {boolean} [force=false] - If true, scroll even if the user has
     *   scrolled up (overriding scroll-lock behavior).
     */
    scrollToBottom(force = false) {
      if (force || !userHasScrolledUp) {
        containerEl.scrollTop = containerEl.scrollHeight;
      }
    },

    /**
     * Remove all messages from the container.
     */
    clear() {
      containerEl.innerHTML = '';
      userHasScrolledUp = false;
    }
  };
}
