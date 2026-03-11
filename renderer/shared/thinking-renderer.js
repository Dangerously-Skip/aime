/**
 * Extended thinking visualization module.
 *
 * Renders a collapsible "Thinking..." section within an assistant message
 * that streams reasoning/chain-of-thought text as it arrives.
 *
 * Uses CSS classes from the existing stylesheet:
 *   .thinking-section, .thinking-header, .thinking-content, .thinking-icon
 *
 * @module thinking-renderer
 */

/**
 * Render a thinking section inside a container element.
 *
 * Returns an object with `append(text)` and `finish()` methods for streaming
 * thinking text into the section. The section is collapsible via `<details>/<summary>`
 * and starts collapsed by default.
 *
 * If a thinking section already exists in the container, it will be reused
 * rather than creating a duplicate.
 *
 * @param {HTMLElement} containerEl - The parent element (typically `.message-content`).
 * @param {Object} [options]
 * @param {boolean} [options.startOpen=false] - Whether to start the details element open.
 * @returns {ThinkingStream}
 *
 * @typedef {Object} ThinkingStream
 * @property {Function} append - Append thinking text and update the display.
 * @property {Function} finish - Mark the thinking section as complete.
 * @property {Function} getRawContent - Get the accumulated thinking text.
 * @property {HTMLElement} element - The `<details>` element.
 *
 * @example
 * const thinking = renderThinkingSection(contentDiv);
 * thinking.append('Let me analyze this problem...');
 * thinking.append('\nFirst, I need to consider...');
 * thinking.finish();
 */
export function renderThinkingSection(containerEl, options = {}) {
  const { startOpen = false } = options;

  // Reuse existing thinking section if present
  let thinkingSection = containerEl.querySelector('.thinking-section');
  let thinkingContent;

  if (!thinkingSection) {
    thinkingSection = document.createElement('details');
    thinkingSection.className = 'thinking-section';
    thinkingSection.open = startOpen;

    const summary = document.createElement('summary');
    summary.className = 'thinking-header';
    summary.innerHTML = '<span class="thinking-icon">&#x1F4AD;</span> Thinking...';
    thinkingSection.appendChild(summary);

    thinkingContent = document.createElement('div');
    thinkingContent.className = 'thinking-content';
    thinkingContent.dataset.rawContent = '';
    thinkingSection.appendChild(thinkingContent);

    // Insert at the beginning of containerEl so thinking appears above content
    containerEl.insertBefore(thinkingSection, containerEl.firstChild);
  } else {
    thinkingContent = thinkingSection.querySelector('.thinking-content');
    if (!thinkingContent) {
      thinkingContent = document.createElement('div');
      thinkingContent.className = 'thinking-content';
      thinkingContent.dataset.rawContent = '';
      thinkingSection.appendChild(thinkingContent);
    }
  }

  return {
    /** The `<details>` element for direct DOM access. */
    element: thinkingSection,

    /**
     * Append reasoning text and update the display.
     * Updates the header to show character count while thinking is in progress.
     *
     * @param {string} text - Text to append.
     */
    append(text) {
      thinkingContent.dataset.rawContent += text;
      thinkingContent.textContent = thinkingContent.dataset.rawContent;

      // Update header with character count
      const length = thinkingContent.dataset.rawContent.length;
      const summary = thinkingSection.querySelector('.thinking-header');
      if (summary) {
        summary.innerHTML = `<span class="thinking-icon">&#x1F4AD;</span> Thinking (${length} chars)`;
      }
    },

    /**
     * Mark the thinking section as complete.
     * Updates the header to indicate thinking has finished and shows the
     * total character count.
     */
    finish() {
      const length = thinkingContent.dataset.rawContent.length;
      const summary = thinkingSection.querySelector('.thinking-header');
      if (summary) {
        summary.innerHTML = `<span class="thinking-icon">&#x1F4AD;</span> Thought (${length} chars)`;
      }
    },

    /**
     * Get the accumulated raw thinking text.
     * @returns {string}
     */
    getRawContent() {
      return thinkingContent.dataset.rawContent || '';
    }
  };
}
