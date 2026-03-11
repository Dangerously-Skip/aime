/**
 * Tool call visualization module.
 *
 * Renders inline tool call cards within assistant messages and updates them
 * with results. Cards are collapsible (click header to expand/collapse).
 *
 * Uses CSS classes from the existing stylesheet:
 *   .inline-tool-call, .inline-tool-header, .inline-tool-result,
 *   .tool-section, .tool-section-label, .tool-output-section, .tool-output-content
 *
 * @module tool-call-renderer
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
 * Generate a short preview string from tool input for display in the collapsed header.
 *
 * Looks for common key names (pattern, command, file_path, etc.) and shows
 * a truncated value. Falls back to the first key in the input object.
 *
 * @param {*} toolInput - The tool's input object.
 * @returns {string} A short preview string.
 * @private
 */
function formatToolPreview(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') {
    return String(toolInput || '').substring(0, 50);
  }

  const keys = Object.keys(toolInput);
  if (keys.length === 0) return '';

  const previewKeys = ['pattern', 'command', 'file_path', 'path', 'query', 'content', 'description'];
  const key = previewKeys.find(k => toolInput[k]) || keys[0];
  const value = toolInput[key];

  if (typeof value === 'string') {
    return `${key}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`;
  } else if (Array.isArray(value)) {
    return `${key}: [${value.length} items]`;
  } else if (typeof value === 'object') {
    return `${key}: {...}`;
  }
  return `${key}: ${String(value).substring(0, 30)}`;
}

/**
 * Render an inline tool call card inside a container element.
 *
 * The card starts expanded by default and contains the tool name, a preview
 * of the input, and a collapsible details section showing the full input JSON.
 * An output section is included but hidden until `updateToolResult()` is called.
 *
 * @param {HTMLElement} containerEl - The parent element (typically `.message-content`).
 * @param {Object} params
 * @param {string} params.toolName - The name of the tool being called.
 * @param {string} params.toolId - A unique identifier for this tool call.
 * @param {Object} [params.input={}] - The tool's input parameters.
 * @returns {HTMLElement} The created tool call card element.
 *
 * @example
 * const card = renderToolCall(contentDiv, {
 *   toolName: 'Read',
 *   toolId: 'tool_123',
 *   input: { file_path: '/src/index.ts' }
 * });
 */
export function renderToolCall(containerEl, { toolName, toolId, input = {} }) {
  const toolDiv = document.createElement('div');
  toolDiv.className = 'inline-tool-call expanded';
  toolDiv.dataset.toolId = toolId;

  const inputPreview = formatToolPreview(input);
  const inputStr = JSON.stringify(input, null, 2);

  toolDiv.innerHTML = `
    <div class="inline-tool-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
      </svg>
      <span class="tool-name">${escapeHtml(toolName)}</span>
      <span class="tool-preview">${escapeHtml(inputPreview)}</span>
      <svg class="expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </div>
    <div class="inline-tool-result">
      <div class="tool-section">
        <div class="tool-section-label">Input</div>
        <pre>${escapeHtml(inputStr)}</pre>
      </div>
      <div class="tool-section tool-output-section" style="display: none;">
        <div class="tool-section-label">Output</div>
        <pre class="tool-output-content"></pre>
      </div>
    </div>
  `;

  // Attach toggle handler to the header
  const header = toolDiv.querySelector('.inline-tool-header');
  header.addEventListener('click', () => {
    toolDiv.classList.toggle('expanded');
  });

  containerEl.appendChild(toolDiv);
  return toolDiv;
}

/**
 * Update an existing tool call card with the result output.
 *
 * Finds the card by `toolId` within the given container (or the entire document
 * if containerEl is not provided) and populates the output section.
 *
 * @param {HTMLElement|null} containerEl - The parent to search within, or null to search the whole document.
 * @param {Object} params
 * @param {string} params.toolId - The unique identifier of the tool call to update.
 * @param {*} params.output - The tool result (will be JSON-stringified if object).
 * @param {boolean} [params.isError=false] - Whether the result represents an error.
 * @returns {boolean} True if the card was found and updated, false otherwise.
 *
 * @example
 * updateToolResult(contentDiv, {
 *   toolId: 'tool_123',
 *   output: { success: true, data: '...' },
 *   isError: false
 * });
 */
export function updateToolResult(containerEl, { toolId, output, isError = false }) {
  const searchRoot = containerEl || document;
  const toolDiv = searchRoot.querySelector(`.inline-tool-call[data-tool-id="${toolId}"]`);

  if (!toolDiv) {
    return false;
  }

  const outputSection = toolDiv.querySelector('.tool-output-section');
  const outputContent = toolDiv.querySelector('.tool-output-content');

  if (!outputSection || !outputContent) {
    return false;
  }

  const resultStr = typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output);

  // Truncate very long results for display
  const maxLength = 2000;
  outputContent.textContent = resultStr.substring(0, maxLength) + (resultStr.length > maxLength ? '...' : '');
  outputSection.style.display = 'block';

  // Optionally style errors differently
  if (isError) {
    outputContent.style.borderLeftColor = '#ef4444';
    outputContent.style.background = '#3a1a1a';
    outputContent.style.color = '#f87171';
  }

  return true;
}
