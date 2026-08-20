/**
 * Browser agent tools — schemas, DOM extraction, and client-side execution.
 *
 * These tools run in the Electron renderer process against the <webview> element.
 * The API never executes them; it only returns tool_use blocks that the client handles.
 */

// ── Console log buffer ───────────────────────────────────────────────────────

interface ConsoleLogEntry {
  level: string;
  message: string;
  line: number;
  sourceId: string;
  timestamp: number;
}

const MAX_CONSOLE_BUFFER = 200;

export class ConsoleLogBuffer {
  private entries: ConsoleLogEntry[] = [];

  push(level: string, message: string, line: number = 0, sourceId: string = '') {
    this.entries.push({ level, message, line, sourceId, timestamp: Date.now() });
    if (this.entries.length > MAX_CONSOLE_BUFFER) {
      this.entries = this.entries.slice(-MAX_CONSOLE_BUFFER);
    }
  }

  flush(): string {
    if (this.entries.length === 0) return 'No console logs captured.';
    const lines = this.entries.map(
      (e) => `[${e.level.toUpperCase()}] ${e.message}${e.line > 0 ? ` (line ${e.line})` : ''}`
    );
    this.entries = [];
    return lines.join('\n');
  }
}

// ── Tool schemas (Anthropic format) ──────────────────────────────────────────

export const BROWSER_TOOL_SCHEMAS = [
  {
    name: 'navigate',
    description: 'Navigate the browser to a URL.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'click',
    description: 'Click an interactive element by its index number (shown in brackets like [3]).',
    input_schema: {
      type: 'object' as const,
      properties: {
        index: { type: 'number', description: 'The element index to click' },
      },
      required: ['index'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text into a focused input or a specific element by index. If index is omitted, types into the currently focused element.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'The text to type' },
        index: { type: 'number', description: 'Optional element index to focus first' },
        pressEnter: { type: 'boolean', description: 'Press Enter after typing (default: false)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the page up or down.',
    input_schema: {
      type: 'object' as const,
      properties: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Pixels to scroll (default: 500)' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'extract_content',
    description: 'Extract the text content of the current page or a specific element.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector to extract from (default: full page)' },
      },
    },
  },
  {
    name: 'go_back',
    description: 'Go back to the previous page in browser history.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'go_forward',
    description: 'Go forward to the next page in browser history.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'hover',
    description: 'Hover over an interactive element by its index number. Triggers mouseenter and mouseover events, useful for revealing tooltips, dropdown menus, or hover states.',
    input_schema: {
      type: 'object' as const,
      properties: {
        index: { type: 'number', description: 'The element index to hover over' },
      },
      required: ['index'],
    },
  },
  {
    name: 'drag',
    description: 'Drag an element from one position to another. Uses HTML5 drag and drop events.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startIndex: { type: 'number', description: 'The element index to drag from' },
        endIndex: { type: 'number', description: 'The element index to drop onto' },
      },
      required: ['startIndex', 'endIndex'],
    },
  },
  {
    name: 'select_option',
    description: 'Select an option in a <select> dropdown by value or visible text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        index: { type: 'number', description: 'The element index of the <select> element' },
        value: { type: 'string', description: 'The value or visible text of the option to select' },
      },
      required: ['index', 'value'],
    },
  },
  {
    name: 'press_key',
    description: 'Press a keyboard key. Supports keys like Enter, Escape, Tab, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Backspace, Delete, Space, and single characters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'The key to press (e.g. "Enter", "Escape", "Tab", "a")' },
      },
      required: ['key'],
    },
  },
  {
    name: 'snapshot',
    description: 'Take an ARIA accessibility tree snapshot of the current page. Returns a structured tree of roles, labels, and states. Useful for understanding page structure beyond visual elements.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_console_logs',
    description: 'Get buffered browser console log entries (log, info, warn, error). Returns and clears the buffer.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'wait',
    description: 'Wait for a specified number of milliseconds (useful after navigation or actions that trigger loading).',
    input_schema: {
      type: 'object' as const,
      properties: {
        ms: { type: 'number', description: 'Milliseconds to wait (default: 1000)' },
      },
    },
  },
  {
    /*
     * The tool whose absence caused an infinite loop.
     *
     * A user asked the agent to "open them in new tabs". Sixteen tools existed
     * and `switch_tab` only switches to a tab that ALREADY exists, so the
     * instruction was not executable — and nothing in the agent loop can notice
     * a plan step no tool satisfies. It restated the same intent four times and
     * drifted onto another page.
     */
    name: 'new_tab',
    description:
      'Open a URL in a NEW background tab and stay on the current page. Use this to collect several pages for comparison — it is the right tool when asked to "open these in tabs". Returns the new tab index; use switch_tab to go to it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The absolute URL to open in a new tab' },
      },
      required: ['url'],
    },
  },
  {
    name: 'close_tab',
    description:
      'Close a tab by its 0-based index from the open tabs list. Use to tidy up after comparing pages so the tab list stays legible.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tab_index: { type: 'number', description: 'The 0-based index of the tab to close' },
      },
      required: ['tab_index'],
    },
  },
  {
    name: 'switch_tab',
    description: 'Switch to a different browser tab by its index (0-based) from the open tabs list. After switching, the page state will be re-observed automatically. Use this to work across multiple tabs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tab_index: { type: 'number', description: 'The 0-based index of the tab to switch to (from the open_tabs list)' },
      },
      required: ['tab_index'],
    },
  },
  {
    name: 'done',
    description: 'Signal that the task is complete. Call this when you have finished the user\'s request.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'Brief summary of what was accomplished' },
      },
    },
  },
] as const;

// ── All browser tool names (for server-side interception) ────────────────────

export const BROWSER_TOOL_NAMES: Set<string> = new Set(
  BROWSER_TOOL_SCHEMAS.map((s) => s.name)
);

// ── ARIA snapshot script ─────────────────────────────────────────────────────
// Injected into the webview to build an accessibility tree representation.

const ARIA_SNAPSHOT_SCRIPT = `
(function() {
  const IMPLICIT_ROLES = {
    A: 'link', BUTTON: 'button', H1: 'heading', H2: 'heading', H3: 'heading',
    H4: 'heading', H5: 'heading', H6: 'heading', IMG: 'img', INPUT: 'textbox',
    TEXTAREA: 'textbox', SELECT: 'combobox', TABLE: 'table', THEAD: 'rowgroup',
    TBODY: 'rowgroup', TFOOT: 'rowgroup', TR: 'row', TH: 'columnheader',
    TD: 'cell', UL: 'list', OL: 'list', LI: 'listitem', NAV: 'navigation',
    MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary',
    SECTION: 'region', ARTICLE: 'article', FORM: 'form', DIALOG: 'dialog',
    DETAILS: 'group', SUMMARY: 'button', PROGRESS: 'progressbar', METER: 'meter',
  };

  const MAX_DEPTH = 10;
  const MAX_NODES = 500;
  let nodeCount = 0;
  const lines = [];

  function getRole(el) {
    return el.getAttribute('role') || IMPLICIT_ROLES[el.tagName] || null;
  }

  function getLabel(el) {
    return el.getAttribute('aria-label')
      || el.getAttribute('alt')
      || el.getAttribute('title')
      || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.getAttribute('placeholder') : null)
      || null;
  }

  function getStates(el) {
    const states = [];
    const expanded = el.getAttribute('aria-expanded');
    if (expanded) states.push(expanded === 'true' ? 'expanded' : 'collapsed');
    if (el.getAttribute('aria-checked') === 'true') states.push('checked');
    if (el.getAttribute('aria-selected') === 'true') states.push('selected');
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) states.push('disabled');
    if (el.getAttribute('aria-required') === 'true' || el.required) states.push('required');
    return states;
  }

  function walk(el, depth) {
    if (nodeCount >= MAX_NODES || depth > MAX_DEPTH) return;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return;
    const style = el.nodeType === 1 ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return;
    const rect = el.nodeType === 1 ? el.getBoundingClientRect() : null;
    if (rect && rect.width === 0 && rect.height === 0) return;

    const role = el.nodeType === 1 ? getRole(el) : null;
    if (role) {
      nodeCount++;
      const indent = '  '.repeat(depth);
      let label = getLabel(el);
      if (!label) {
        const text = (el.textContent || '').trim();
        if (text.length > 0 && text.length <= 80) label = text;
      }
      const states = getStates(el);
      let line = indent + '[' + role + ']';
      if (label) line += ' "' + label.substring(0, 80) + '"';
      if (states.length > 0) line += ' (' + states.join(', ') + ')';
      lines.push(line);
    }

    if (el.childNodes) {
      for (const child of el.childNodes) {
        if (child.nodeType === 1) walk(child, role ? depth + 1 : depth);
      }
    }
  }

  walk(document.body, 0);
  return lines.join('\\n') || 'Empty page — no ARIA roles detected.';
})()
`;

// ── DOM extraction script ────────────────────────────────────────────────────
// Injected into the webview via executeJavaScript(). Returns a snapshot of
// the page: URL, title, visible text, and interactive elements with indices.

export const DOM_EXTRACTION_SCRIPT = `
(function() {
  // Remove previous agent-index attributes
  document.querySelectorAll('[data-agent-index]').forEach(el => el.removeAttribute('data-agent-index'));

  const interactiveSelectors = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[onclick]',
    '[tabindex]',
  ].join(', ');

  const elements = [];
  let index = 0;
  const seen = new Set();

  document.querySelectorAll(interactiveSelectors).forEach(el => {
    // Skip hidden or zero-size elements
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

    // Dedup
    if (seen.has(el)) return;
    seen.add(el);

    el.setAttribute('data-agent-index', String(index));

    const tag = el.tagName.toLowerCase();
    const text = (el.textContent || '').trim().substring(0, 100);
    const info = { index, tag };

    if (tag === 'a') info.href = el.getAttribute('href') || '';
    if (tag === 'input' || tag === 'textarea') {
      info.type = el.getAttribute('type') || 'text';
      info.value = el.value || '';
      info.placeholder = el.getAttribute('placeholder') || '';
    }
    if (tag === 'select') {
      info.options = Array.from(el.options).slice(0, 10).map(o => o.textContent.trim());
    }
    if (el.getAttribute('role')) info.role = el.getAttribute('role');
    if (text) info.text = text;

    elements.push(info);
    index++;
  });

  // Get visible text (truncated)
  const bodyText = (document.body.innerText || '').substring(0, 5000);

  return {
    url: window.location.href,
    title: document.title,
    text: bodyText,
    elements: elements,
    elementCount: elements.length,
  };
})()
`;

// ── Types ────────────────────────────────────────────────────────────────────

export interface PageState {
  url: string;
  title: string;
  text: string;
  elements: Array<{
    index: number;
    tag: string;
    text?: string;
    href?: string;
    type?: string;
    value?: string;
    placeholder?: string;
    role?: string;
    options?: string[];
  }>;
  elementCount: number;
}

export interface WebviewRef {
  executeJavaScript: (code: string) => Promise<unknown>;
  loadURL: (url: string) => Promise<void>;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  getURL: () => string;
  capturePage: () => Promise<{ toDataURL: () => string }>;
}

export interface ToolResult {
  success: boolean;
  message: string;
  isDone?: boolean;
}

// ── Tool executor ────────────────────────────────────────────────────────────

export async function executeToolInWebview(
  webview: WebviewRef,
  toolName: string,
  input: Record<string, unknown>,
  consoleBuffer?: ConsoleLogBuffer,
): Promise<ToolResult> {
  switch (toolName) {
    case 'navigate': {
      const url = input.url as string;
      try {
        await webview.loadURL(url);
        await new Promise(r => setTimeout(r, 500));
        return { success: true, message: `Navigated to ${url}` };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // ERR_ABORTED (-3) = redirect happened, navigation still succeeded
        if (msg.includes('(-3)') || msg.includes('ERR_ABORTED')) {
          await new Promise(r => setTimeout(r, 500));
          return { success: true, message: `Navigated to ${url} (redirected)` };
        }
        return { success: false, message: `Navigation failed: ${msg}` };
      }
    }

    case 'click': {
      const index = input.index as number;
      try {
        const result = await webview.executeJavaScript(`
          (function() {
            const el = document.querySelector('[data-agent-index="${index}"]');
            if (!el) return { success: false, message: 'Element not found at index ${index}' };
            el.click();
            return { success: true, message: 'Clicked element at index ${index}: ' + (el.textContent || '').trim().substring(0, 50) };
          })()
        `);
        await new Promise(r => setTimeout(r, 300));
        return result as ToolResult;
      } catch (e) {
        return { success: false, message: `Click failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'type_text': {
      const text = input.text as string;
      const index = input.index as number | undefined;
      const pressEnter = input.pressEnter as boolean | undefined;
      try {
        const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
        const result = await webview.executeJavaScript(`
          (function() {
            let el;
            ${index !== undefined ? `
              el = document.querySelector('[data-agent-index="${index}"]');
              if (!el) return { success: false, message: 'Element not found at index ${index}' };
              el.focus();
            ` : `
              el = document.activeElement;
              if (!el || el === document.body) return { success: false, message: 'No element is focused' };
            `}
            // Clear existing value and set new one
            if ('value' in el) {
              el.value = '';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.value = '${escapedText}';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            ${pressEnter ? `
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
              if (el.form) el.form.submit();
            ` : ''}
            return { success: true, message: 'Typed text into element' };
          })()
        `);
        await new Promise(r => setTimeout(r, 200));
        return result as ToolResult;
      } catch (e) {
        return { success: false, message: `Type failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'scroll': {
      const direction = input.direction as string;
      const amount = (input.amount as number) || 500;
      const delta = direction === 'up' ? -amount : amount;
      try {
        await webview.executeJavaScript(`window.scrollBy(0, ${delta})`);
        return { success: true, message: `Scrolled ${direction} by ${amount}px` };
      } catch (e) {
        return { success: false, message: `Scroll failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'extract_content': {
      const selector = input.selector as string | undefined;
      try {
        const escapedSelector = selector ? selector.replace(/'/g, "\\'") : '';
        const text = await webview.executeJavaScript(`
          (function() {
            ${selector ? `
              const el = document.querySelector('${escapedSelector}');
              return el ? el.innerText.substring(0, 10000) : 'Selector not found: ${escapedSelector}';
            ` : `
              return document.body.innerText.substring(0, 10000);
            `}
          })()
        `);
        return { success: true, message: text as string };
      } catch (e) {
        return { success: false, message: `Extract failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'go_back': {
      try {
        webview.goBack();
        await new Promise(r => setTimeout(r, 500));
        return { success: true, message: 'Navigated back' };
      } catch (e) {
        return { success: false, message: `Go back failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'go_forward': {
      try {
        webview.goForward();
        await new Promise(r => setTimeout(r, 500));
        return { success: true, message: 'Navigated forward' };
      } catch (e) {
        return { success: false, message: `Go forward failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'hover': {
      const index = input.index as number;
      try {
        const result = await webview.executeJavaScript(`
          (function() {
            const el = document.querySelector('[data-agent-index="${index}"]');
            if (!el) return { success: false, message: 'Element not found at index ${index}' };
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
            el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
            return { success: true, message: 'Hovered element at index ${index}: ' + (el.textContent || '').trim().substring(0, 50) };
          })()
        `);
        await new Promise(r => setTimeout(r, 300));
        return result as ToolResult;
      } catch (e) {
        return { success: false, message: `Hover failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'drag': {
      const startIndex = input.startIndex as number;
      const endIndex = input.endIndex as number;
      try {
        const result = await webview.executeJavaScript(`
          (function() {
            const src = document.querySelector('[data-agent-index="${startIndex}"]');
            const dst = document.querySelector('[data-agent-index="${endIndex}"]');
            if (!src) return { success: false, message: 'Source element not found at index ${startIndex}' };
            if (!dst) return { success: false, message: 'Target element not found at index ${endIndex}' };
            const srcRect = src.getBoundingClientRect();
            const dstRect = dst.getBoundingClientRect();
            const dt = new DataTransfer();
            src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, clientX: srcRect.left + srcRect.width/2, clientY: srcRect.top + srcRect.height/2, dataTransfer: dt }));
            dst.dispatchEvent(new DragEvent('dragenter', { bubbles: true, clientX: dstRect.left + dstRect.width/2, clientY: dstRect.top + dstRect.height/2, dataTransfer: dt }));
            dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: dstRect.left + dstRect.width/2, clientY: dstRect.top + dstRect.height/2, dataTransfer: dt }));
            dst.dispatchEvent(new DragEvent('drop', { bubbles: true, clientX: dstRect.left + dstRect.width/2, clientY: dstRect.top + dstRect.height/2, dataTransfer: dt }));
            src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
            return { success: true, message: 'Dragged element from index ${startIndex} to index ${endIndex}' };
          })()
        `);
        await new Promise(r => setTimeout(r, 300));
        return result as ToolResult;
      } catch (e) {
        return { success: false, message: `Drag failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'select_option': {
      const index = input.index as number;
      const value = input.value as string;
      try {
        const escapedValue = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const result = await webview.executeJavaScript(`
          (function() {
            const el = document.querySelector('[data-agent-index="${index}"]');
            if (!el) return { success: false, message: 'Element not found at index ${index}' };
            if (el.tagName !== 'SELECT') return { success: false, message: 'Element at index ${index} is not a <select>' };
            // Try matching by value first, then by visible text
            let found = false;
            for (const opt of el.options) {
              if (opt.value === '${escapedValue}' || opt.textContent.trim() === '${escapedValue}') {
                el.value = opt.value;
                found = true;
                break;
              }
            }
            if (!found) return { success: false, message: 'Option "${escapedValue}" not found in select' };
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, message: 'Selected option "${escapedValue}" in element at index ${index}' };
          })()
        `);
        await new Promise(r => setTimeout(r, 200));
        return result as ToolResult;
      } catch (e) {
        return { success: false, message: `Select failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'press_key': {
      const key = input.key as string;
      try {
        // Map common key names to their code values
        const keyCodeMap: Record<string, number> = {
          Enter: 13, Escape: 27, Tab: 9, Backspace: 8, Delete: 46,
          ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
          Space: 32, ' ': 32,
        };
        const keyCode = keyCodeMap[key] || key.charCodeAt(0);
        const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
        const escapedKey = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        await webview.executeJavaScript(`
          (function() {
            const target = document.activeElement || document.body;
            target.dispatchEvent(new KeyboardEvent('keydown', { key: '${escapedKey}', code: '${code}', keyCode: ${keyCode}, bubbles: true }));
            target.dispatchEvent(new KeyboardEvent('keypress', { key: '${escapedKey}', code: '${code}', keyCode: ${keyCode}, bubbles: true }));
            target.dispatchEvent(new KeyboardEvent('keyup', { key: '${escapedKey}', code: '${code}', keyCode: ${keyCode}, bubbles: true }));
          })()
        `);
        await new Promise(r => setTimeout(r, 200));
        return { success: true, message: `Pressed key: ${key}` };
      } catch (e) {
        return { success: false, message: `Key press failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'snapshot': {
      try {
        const tree = await webview.executeJavaScript(ARIA_SNAPSHOT_SCRIPT);
        return { success: true, message: tree as string };
      } catch (e) {
        return { success: false, message: `Snapshot failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    }

    case 'get_console_logs': {
      if (!consoleBuffer) {
        return { success: true, message: 'Console log capture is not available.' };
      }
      return { success: true, message: consoleBuffer.flush() };
    }

    case 'wait': {
      const ms = (input.ms as number) || 1000;
      await new Promise(r => setTimeout(r, ms));
      return { success: true, message: `Waited ${ms}ms` };
    }

    case 'done': {
      const summary = (input.summary as string) || 'Task complete';
      return { success: true, message: summary, isDone: true };
    }

    default:
      return { success: false, message: `Unknown tool: ${toolName}` };
  }
}

// ── Tab list formatter ────────────────────────────────────────────────────────

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

export function formatTabListForModel(tabs: TabInfo[]): string {
  if (tabs.length <= 1) return '';
  const lines = [`## Open Tabs (${tabs.length})`];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const marker = tab.isActive ? ' (active)' : '';
    const url = tab.url || '(empty)';
    lines.push(`[${i}] ${tab.title || 'New Tab'}${marker} — ${url}`);
  }
  lines.push('', 'Use new_tab to open a URL in the background, switch_tab to move between them, close_tab to tidy up.');
  return lines.join('\n');
}

// ── Page state formatter ─────────────────────────────────────────────────────

export function formatPageStateForModel(pageState: PageState): string {
  const lines = [
    `## Current Page`,
    `URL: ${pageState.url}`,
    `Title: ${pageState.title}`,
    '',
    `## Interactive Elements (${pageState.elementCount} total)`,
  ];

  for (const el of pageState.elements.slice(0, 100)) {
    const parts = [`[${el.index}]`, el.tag];
    if (el.role) parts.push(`role=${el.role}`);
    if (el.type) parts.push(`type=${el.type}`);
    if (el.text) parts.push(`"${el.text}"`);
    if (el.href) parts.push(`href=${el.href.substring(0, 80)}`);
    if (el.value) parts.push(`value="${el.value}"`);
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
    lines.push(parts.join(' '));
  }

  if (pageState.elementCount > 100) {
    lines.push(`... and ${pageState.elementCount - 100} more elements`);
  }

  lines.push('', '## Page Text (truncated)', pageState.text.substring(0, 3000));

  return lines.join('\n');
}

/**
 * What CHANGED since the last observation.
 *
 * Agent-E ("change observation", arXiv 2407.13032) names this as one of three
 * mechanisms behind a 10–30% gain over prior SOTA on WebVoyager, and its
 * absence is visible in our own failure: the agent navigated off the camera
 * results onto the site's advanced search and never registered that it had.
 * Every step it received a fresh, complete page state with nothing marking it
 * as a different page, so drift was indistinguishable from staying put.
 *
 * Deliberately terse — URL, title, element count. A second full snapshot per
 * step would double the token cost to say something a diff says in a line.
 * Returns '' when nothing moved, so a settled page adds no noise.
 */
export function formatPageChangeForModel(
  before: Pick<PageState, 'url' | 'title' | 'elementCount'> | null,
  after: Pick<PageState, 'url' | 'title' | 'elementCount'>,
): string {
  if (!before) return '';

  const changes: string[] = [];
  if (before.url !== after.url) {
    changes.push(`URL changed: ${before.url} -> ${after.url}`);
  }
  if (before.title !== after.title) {
    changes.push(`Title changed: "${before.title}" -> "${after.title}"`);
  }
  if (before.elementCount !== after.elementCount) {
    changes.push(`Interactive elements: ${before.elementCount} -> ${after.elementCount}`);
  }

  if (changes.length === 0) {
    /*
     * Saying "nothing changed" is the useful half. An action that alters
     * nothing is the signature of a click that missed, and silence reads to the
     * model as success — which is how four identical attempts happen.
     */
    return '## Change\nNothing changed on the page after that action. If you expected it to, the action did not do what you intended.';
  }
  return ['## Change', ...changes].join('\n');
}
