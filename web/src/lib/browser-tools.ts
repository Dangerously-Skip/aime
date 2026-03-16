/**
 * Browser agent tools — schemas, DOM extraction, and client-side execution.
 *
 * These tools run in the Electron renderer process against the <webview> element.
 * The API never executes them; it only returns tool_use blocks that the client handles.
 */

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
