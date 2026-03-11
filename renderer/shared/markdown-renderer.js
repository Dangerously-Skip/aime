/**
 * Streaming markdown renderer module.
 *
 * Uses the `marked` library (expected to be available as a global via CDN script tag
 * or imported separately) to render markdown incrementally as text streams in.
 *
 * Implements the "chunked container" pattern from the original renderer.js:
 * each chunk of markdown text between tool calls gets its own container element
 * so that tool call cards can be interleaved with rendered markdown.
 *
 * @module markdown-renderer
 */

/* global marked */

/**
 * Creates a streaming markdown renderer attached to a container element.
 *
 * The renderer accumulates raw text via `append()` and re-renders the current
 * markdown chunk each time. Multiple chunks can be created by calling
 * `nextChunk()` (e.g., when a tool call card is inserted between text segments).
 *
 * @param {HTMLElement} containerEl - The parent element to render markdown into.
 *   This is typically the `.message-content` div of an assistant message.
 * @param {Object} [options]
 * @param {Object} [options.markedOptions] - Options passed to `marked.setOptions()`.
 * @returns {MarkdownStream}
 *
 * @typedef {Object} MarkdownStream
 * @property {Function} append - Append raw text to the current chunk and re-render.
 * @property {Function} finish - Finalize rendering (no-op currently, reserved for future use).
 * @property {Function} nextChunk - Start a new markdown chunk container.
 * @property {Function} getRawContent - Get all accumulated raw content across all chunks.
 * @property {Function} getCurrentChunkIndex - Get the current chunk index.
 *
 * @example
 * const stream = createMarkdownStream(contentDiv);
 * stream.append('Hello ');
 * stream.append('**world**');
 * stream.finish();
 */
export function createMarkdownStream(containerEl, options = {}) {
  const markedOptions = {
    breaks: true,
    gfm: true,
    ...options.markedOptions
  };

  let currentChunkIndex = parseInt(containerEl.dataset.currentChunk || '0', 10);
  let totalRawContent = containerEl.dataset.rawContent || '';

  /**
   * Get or create the markdown container for the given chunk index.
   * @param {number} index
   * @returns {HTMLElement}
   */
  function getChunkContainer(index) {
    let container = containerEl.querySelector(`.markdown-content[data-chunk="${index}"]`);

    if (!container) {
      container = document.createElement('div');
      container.className = 'markdown-content';
      container.dataset.chunk = String(index);
      container.dataset.rawContent = '';
      containerEl.appendChild(container);
    }

    return container;
  }

  /**
   * Render a chunk container's raw content as HTML via marked.
   * @param {HTMLElement} container
   */
  function renderContainer(container) {
    const rawContent = container.dataset.rawContent || '';

    if (typeof marked !== 'undefined') {
      marked.setOptions(markedOptions);
      container.innerHTML = marked.parse(rawContent);
    } else {
      // Fallback: render as plain text if marked is not available
      container.textContent = rawContent;
    }
  }

  return {
    /**
     * Append text to the current chunk and re-render it.
     * @param {string} text - Raw markdown text to append.
     */
    append(text) {
      totalRawContent += text;
      containerEl.dataset.rawContent = totalRawContent;

      const container = getChunkContainer(currentChunkIndex);
      container.dataset.rawContent += text;
      renderContainer(container);
    },

    /**
     * Finalize rendering. Currently a no-op but can be extended for
     * post-processing (e.g., syntax highlighting, link decoration).
     */
    finish() {
      // Future: could run syntax highlighting or other post-processing
    },

    /**
     * Advance to the next chunk. Call this before inserting a non-markdown
     * element (like a tool call card) so that subsequent markdown text
     * renders in a new container after the inserted element.
     *
     * @returns {number} The new chunk index.
     */
    nextChunk() {
      currentChunkIndex += 1;
      containerEl.dataset.currentChunk = String(currentChunkIndex);
      return currentChunkIndex;
    },

    /**
     * Get all accumulated raw content across every chunk.
     * @returns {string}
     */
    getRawContent() {
      return totalRawContent;
    },

    /**
     * Get the current chunk index.
     * @returns {number}
     */
    getCurrentChunkIndex() {
      return currentChunkIndex;
    }
  };
}

/**
 * Render markdown into an element from stored raw content.
 * Useful for restoring saved messages from localStorage.
 *
 * @param {HTMLElement} contentDiv - The `.message-content` element.
 * @param {Object} [options]
 * @param {Object} [options.markedOptions] - Options passed to `marked.setOptions()`.
 */
export function renderMarkdownFromRaw(contentDiv, options = {}) {
  const rawContent = contentDiv.dataset.rawContent || '';
  const markedOptions = {
    breaks: true,
    gfm: true,
    ...options.markedOptions
  };

  if (typeof marked !== 'undefined') {
    marked.setOptions(markedOptions);
  }

  let markdownContainer = contentDiv.querySelector('.markdown-content');
  if (!markdownContainer) {
    markdownContainer = document.createElement('div');
    markdownContainer.className = 'markdown-content';
    contentDiv.appendChild(markdownContainer);
  }

  if (typeof marked !== 'undefined') {
    markdownContainer.innerHTML = marked.parse(rawContent);
  } else {
    markdownContainer.textContent = rawContent;
  }
}
