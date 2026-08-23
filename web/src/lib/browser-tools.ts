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
    description: 'Click an interactive element by the ref shown in the latest snapshot (e.g. ref=3:12).',
    input_schema: {
      type: 'object' as const,
      properties: {
        ref: { type: 'string', description: 'The element ref from the latest snapshot, e.g. "3:12". Refs expire when the page changes.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text into an element by ref, or into the focused element if ref is omitted.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'The text to type' },
        ref: { type: 'string', description: 'Optional. The element ref from the latest snapshot, e.g. "3:12". Refs expire when the page changes.' },
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
    description: 'Hover over an element by ref. Triggers mouseenter/mouseover — reveals tooltips, dropdown menus and hover states.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ref: { type: 'string', description: 'The element ref from the latest snapshot, e.g. "3:12". Refs expire when the page changes.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'drag',
    description: 'Drag an element from one position to another. Uses HTML5 drag and drop events.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startRef: { type: 'string', description: 'Ref to drag FROM. The element ref from the latest snapshot, e.g. "3:12". Refs expire when the page changes.' },
        endRef: { type: 'string', description: 'Ref to drop ONTO. The element ref from the latest snapshot, e.g. "3:12". Refs expire when the page changes.' },
      },
      required: ['startRef', 'endRef'],
    },
  },
  {
    name: 'select_option',
    description: 'Select an option in a <select> dropdown by value or visible text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        ref: { type: 'string', description: 'Ref of the <select>. The element ref from the latest snapshot, e.g. "3:12". Refs expire when the page changes.' },
        value: { type: 'string', description: 'The value or visible text of the option to select' },
      },
      required: ['ref', 'value'],
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
     * VISION, DELIBERATELY A LAST RESORT.
     *
     * The agent reads pages through a structured element list and the
     * accessibility tree, which is where the field has settled: an a11y
     * snapshot is a few hundred tokens where a screenshot is thousands, and
     * screenshots are read less reliably on dense layouts. Best practice is
     * a11y-primary with vision used SELECTIVELY — so the description steers
     * away from it, because a model given a camera will reach for it.
     *
     * It earns its place where text genuinely cannot answer: a canvas, an
     * image-only chart, a layout that renders nothing accessible, or "is this
     * actually visible".
     */
    name: 'screenshot',
    description:
      'Capture what the page LOOKS like, as an image. Expensive and slow — prefer the element list you already receive, or the `snapshot` tool for structure. Use this only when the text representation cannot answer the question: canvas or image-only content, a visual layout problem, or checking whether something is actually visible on screen.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: {
          type: 'string',
          description: 'Why the text representation is insufficient here. Required, to keep this from becoming the default.',
        },
      },
      required: ['reason'],
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

/**
 * Stamp every interactive element with a VERSIONED ref, and bump the version.
 *
 * WHY THIS EXISTS AT ALL. `data-agent-index` was written by exactly one script,
 * `DOM_EXTRACTION_SCRIPT`, imported by exactly one file — the old hand-rolled
 * loop. The agent path never ran it, and `snapshot` returned an accessibility
 * tree with NO addresses in it. So the model was shown a picture of the page
 * with nothing to point at, and every acting tool resolved an attribute that had
 * never been written. Seven clicks in two real runs, seven failures.
 *
 * The fix is the one Playwright MCP settled on: THE SNAPSHOT MINTS THE REFS IT
 * RETURNS. One operation, one numbering, no second script to forget.
 *
 * WHY VERSIONED. A ref is a pointer into "what the page looked like when you
 * last looked", not a stable id. The literature is blunt about the danger: a
 * Cancel button with ref 10 in one snapshot can be a DELETE button with ref 10
 * after a re-render, and an agent holding the old number will happily press it.
 * Prefixing the snapshot version makes a stale ref unresolvable instead of
 * wrong — the failure becomes "look again", not "you deleted the thing".
 */
export const MARK_INTERACTIVE_JS = `
  const INTERACTIVE_SEL = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="option"]',
    '[onclick]', '[tabindex]',
  ].join(', ');

  function markInteractive() {
    // A monotonic counter on the document. Survives re-marking, resets with the
    // page — which is exactly right: a navigation invalidates every old ref.
    const version = (window.__aimeSnapVersion = (window.__aimeSnapVersion || 0) + 1);
    document.querySelectorAll('[data-agent-ref]').forEach(function (el) {
      el.removeAttribute('data-agent-ref');
    });
    document.querySelectorAll('[data-agent-index]').forEach(function (el) {
      el.removeAttribute('data-agent-index');
    });
    const map = new Map();
    let n = 0;
    document.querySelectorAll(INTERACTIVE_SEL).forEach(function (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
      if (el.getAttribute('aria-hidden') === 'true') return;
      if (map.has(el)) return;
      const ref = version + ':' + n;
      el.setAttribute('data-agent-ref', ref);
      // Legacy numeric, still read by the quick-ask loop's page-state formatter.
      el.setAttribute('data-agent-index', String(n));
      map.set(el, ref);
      n++;
    });
    return { version: version, count: n, map: map };
  }
`;

/**
 * Resolve a ref inside the page, and explain precisely why if it fails.
 *
 * THREE DISTINCT ANSWERS, because they need three different reactions and the
 * old single message ("Element not found at index 5") produced the wrong one
 * every time — it reads as bad luck, so the model retried the same index.
 *
 *   - no snapshot yet      → take one; you are pointing at nothing
 *   - stale version        → the page moved under you; look again
 *   - current but missing  → that element is gone specifically; the rest stand
 */
export const RESOLVE_REF_JS = `
  function resolveRef(ref) {
    // The quick-ask loop addresses by plain number against data-agent-index,
    // which its own page-state script stamps. Kept working rather than migrated:
    // that loop is deliberately small and is not where the agent runs.
    if (String(ref).indexOf('LEGACY:') === 0) {
      const n = String(ref).slice(7);
      const legacyEl = document.querySelector('[data-agent-index="' + n + '"]');
      return legacyEl
        ? { el: legacyEl, why: null }
        : { el: null, why: 'No element at index ' + n + '. The page has changed since it was ' +
            'listed — get the page state again, and do not retry this index.' };
    }
    const current = window.__aimeSnapVersion || 0;
    if (current === 0) {
      return { el: null, why: 'No snapshot has been taken of this page yet, so "' + ref +
        '" points at nothing. Call snapshot first — it returns the refs you can act on.' };
    }
    const el = document.querySelector('[data-agent-ref="' + ref + '"]');
    if (el) return { el: el, why: null };
    const askedVersion = parseInt(String(ref).split(':')[0], 10);
    if (askedVersion !== current) {
      return { el: null, why: 'Ref "' + ref + '" is from snapshot ' + askedVersion +
        ' and the page is now at snapshot ' + current + '. The page changed under you. ' +
        'Call snapshot again and use a ref from the new one — do NOT retry this ref, and ' +
        'do not assume the same number means the same element.' };
    }
    return { el: null, why: 'Ref "' + ref + '" was in the current snapshot but that element ' +
      'is no longer in the page. Other refs from this snapshot may still be good; call ' +
      'snapshot again if several fail.' };
  }
`;

export const ARIA_SNAPSHOT_SCRIPT = `
(function() {
  ${MARK_INTERACTIVE_JS}
  const marked = markInteractive();

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

  /*
   * Roles whose accessible name comes from their content (ARIA "name from
   * author and content"). Everything else must be named explicitly or go
   * unnamed — borrowing a descendant's text is what produced four identical
   * lines for one button.
   */
  const NAME_FROM_CONTENT = new Set([
    'button', 'link', 'heading', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'radio', 'checkbox', 'switch', 'tab', 'treeitem', 'cell',
    'columnheader', 'rowheader', 'gridcell', 'tooltip', 'legend', 'caption',
  ]);

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
        /*
         * NAME FROM CONTENT — the ARIA rule, not a guess.
         *
         * The problem this solves: textContent on a CONTAINER returns the whole
         * subtree, so a button inside main > ul > li produced four lines all
         * reading "Place bid" with a ref on only one.
         *
         * My first fix was "leaves only", and it was wrong in a way the e2e
         * test could not see because the fixture said a text-only button.
         * Real markup nests a span inside the button — so the
         * button has an element child, so it got NO label, and the model was
         * handed an unlabelled button line: it can see there is a button and not what
         * it does. Strictly worse than the duplication it replaced.
         *
         * The accessibility spec already draws this line. Certain roles take
         * their accessible name FROM THEIR CONTENT however deeply it is nested
         * (button, link, heading, tab, option…); containers like main,
         * navigation, list and listitem do not. That is exactly the distinction
         * needed, it is what a screen reader does, and it is not something we
         * have to invent or tune.
         */
        if (NAME_FROM_CONTENT.has(role)) {
          const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
          if (text.length > 0 && text.length <= 80) label = text;
        }
      }
      const states = getStates(el);
      let line = indent + '[' + role + ']';
      if (label) line += ' "' + label.substring(0, 80) + '"';
      if (states.length > 0) line += ' (' + states.join(', ') + ')';
      /*
       * THE REF, on the line the model reads.
       *
       * This is the whole fix. The tree used to describe the page and name
       * nothing in it, so there was no way to say WHICH button. Only elements
       * that were actually marked get one — a heading has no ref because you
       * cannot click a heading, and offering one would invite the attempt.
       */
      const ref = el.getAttribute && el.getAttribute('data-agent-ref');
      if (ref) line += ' ref=' + ref;
      lines.push(line);
    }

    if (el.childNodes) {
      for (const child of el.childNodes) {
        if (child.nodeType === 1) walk(child, role ? depth + 1 : depth);
      }
    }
  }

  walk(document.body, 0);
  if (lines.length === 0) {
    /*
     * Canvas, WebGL, or a page that renders no semantics. The accessibility tree
     * is empty BY CONSTRUCTION here, so saying "empty page" invites a retry that
     * cannot succeed. Name the alternative instead — screenshot is the only tool
     * that can see this kind of page.
     */
    return 'No accessible elements on this page — it may be canvas- or WebGL-rendered. ' +
      'The accessibility tree cannot describe it, so re-snapshotting will not help. ' +
      'Use screenshot to see it, or extract_content for any text it does expose.';
  }
  return 'Snapshot ' + marked.version + ' — ' + marked.count + ' interactive elements. ' +
    'Refs are valid only until the page changes; re-snapshot after any navigation.\\n\\n' +
    lines.join('\\n');
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

    /*
     * Which landmark this element sits in.
     *
     * The model is shown a bounded number of elements and they were collected in
     * DOM order, so page furniture won the budget: on a listings page the
     * masthead, category tabs and a sidebar of filters can be sixty to eighty
     * elements before the first result. The agent was asked to compare listings
     * and shown mostly navigation.
     *
     * Ranking needs to know what is chrome, and the page already says so — that
     * is what landmarks are for. Walk up to the nearest one.
     */
    let region = 'content';
    for (let p = el.parentElement, hops = 0; p && hops < 12; p = p.parentElement, hops++) {
      const t = p.tagName.toLowerCase();
      const r = (p.getAttribute('role') || '').toLowerCase();
      if (t === 'nav' || r === 'navigation') { region = 'nav'; break; }
      if (t === 'header' || r === 'banner') { region = 'header'; break; }
      if (t === 'footer' || r === 'contentinfo') { region = 'footer'; break; }
      if (t === 'aside' || r === 'complementary') { region = 'aside'; break; }
      if (t === 'main' || t === 'article' || r === 'main') { region = 'main'; break; }
    }
    info.region = region;

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
    /** Nearest landmark: 'main' | 'content' | 'nav' | 'header' | 'footer' | 'aside'. */
    region?: string;
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
  /**
   * An optional image to hand the model alongside the message.
   *
   * Only `screenshot` sets it. Kept out of the message string because an image
   * has to travel as its own content block, and base64 in a text field would be
   * both useless and enormous.
   */
  image?: { mediaType: 'image/png'; data: string };
}

// ── Tool executor ────────────────────────────────────────────────────────────

/**
 * The ref a tool call is addressing.
 *
 * Accepts the legacy numeric `index` too, because the quick-ask loop still
 * addresses that way and its own page-state formatter still emits plain
 * numbers. A bare number is read as "current snapshot", which is what it meant.
 */
function refOf(input: Record<string, unknown>): string {
  /*
   * A BARE NUMBER IS A LEGACY INDEX, whichever key it arrives under.
   *
   * The `LEGACY:` branch was unreachable: the schemas now say `ref: string`, so
   * the quick-ask loop — whose page state still numbers elements `[12]` — sends
   * `ref: "12"`, which fell through as a versioned ref and produced "no
   * snapshot has been taken" on a page it had just described. The loop looked
   * broken by the fix that was supposed to leave it alone.
   *
   * Versioned refs always contain a colon, so the two are unambiguous.
   */
  if (typeof input.ref === 'string' && input.ref) {
    return /^\d+$/.test(input.ref.trim()) ? `LEGACY:${input.ref.trim()}` : input.ref;
  }
  const legacy = input.index;
  if (typeof legacy === 'number') return `LEGACY:${legacy}`;
  return String(input.ref ?? input.index ?? '');
}

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
      const ref = refOf(input);
      try {
        const result = await webview.executeJavaScript(`
          (function() {
            ${RESOLVE_REF_JS}
            const found = resolveRef(${JSON.stringify(ref)});
            if (!found.el) return { success: false, message: found.why };
            const label = (found.el.textContent || '').trim().substring(0, 60);
            found.el.click();
            return { success: true, message: 'Clicked ' + ${JSON.stringify(ref)} + (label ? ': ' + label : '') };
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
      // Either addressing works: a ref from the snapshot, or the legacy numeric
      // index the quick-ask loop still emits. Absent means "the focused element".
      const hasTarget = input.ref !== undefined || input.index !== undefined;
      const pressEnter = input.pressEnter as boolean | undefined;
      try {
        const escapedText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
        const result = await webview.executeJavaScript(`
          (function() {
            ${RESOLVE_REF_JS}
            let el;
            ${hasTarget ? `
              const _f = resolveRef(${JSON.stringify(refOf(input))});
              if (!_f.el) return { success: false, message: _f.why };
              el = _f.el;
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
      try {
        const result = await webview.executeJavaScript(`
          (function() {
            ${RESOLVE_REF_JS}
            const _f = resolveRef(${JSON.stringify(refOf(input))});
            if (!_f.el) return { success: false, message: _f.why };
            const el = _f.el;
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }));
            el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
            return { success: true, message: 'Hovered ' + ${JSON.stringify(refOf(input))} + ': ' + (el.textContent || '').trim().substring(0, 50) };
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
            ${RESOLVE_REF_JS}
            const _s = resolveRef(${JSON.stringify(String(input.startRef ?? input.start_ref ?? `LEGACY:${input.startIndex}`))});
            const _d = resolveRef(${JSON.stringify(String(input.endRef ?? input.end_ref ?? `LEGACY:${input.endIndex}`))});
            if (!_s.el) return { success: false, message: 'Drag source — ' + _s.why };
            if (!_d.el) return { success: false, message: 'Drag target — ' + _d.why };
            const src = _s.el, dst = _d.el;
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
      const value = input.value as string;
      try {
        const escapedValue = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const result = await webview.executeJavaScript(`
          (function() {
            ${RESOLVE_REF_JS}
            const _f = resolveRef(${JSON.stringify(refOf(input))});
            if (!_f.el) return { success: false, message: _f.why };
            const el = _f.el;
            if (el.tagName !== 'SELECT') return { success: false, message: 'Ref ' + ${JSON.stringify(refOf(input))} + ' is a <' + el.tagName.toLowerCase() + '>, not a <select>. Snapshot marks selects with role combobox — pick one of those.' };
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
            return { success: true, message: 'Selected option "${escapedValue}" in ' + ${JSON.stringify(refOf(input))} };
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

    case 'screenshot': {
      try {
        const img = await webview.capturePage();
        const dataUrl = img.toDataURL();
        // `data:image/png;base64,<payload>` — the API wants the payload alone.
        // Sending the prefix fails the REQUEST rather than the tool, which reads
        // to the model as the page being broken.
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        if (!base64) return { success: false, message: 'Screenshot came back empty.' };
        if (base64.length > 8_000_000) {
          return {
            success: false,
            message: 'Screenshot too large to send. Scroll to the region you care about and try again.',
          };
        }
        return {
          success: true,
          message: `Screenshot of ${webview.getURL()}`,
          image: { mediaType: 'image/png', data: base64 },
        };
      } catch (e) {
        return { success: false, message: `Screenshot failed: ${e instanceof Error ? e.message : String(e)}` };
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

/**
 * How many elements the model is shown.
 *
 * Raised from 100. A structured row costs a handful of tokens — far less than
 * the 3,000 characters of page text sent alongside it — and a listings page
 * routinely has more than a hundred interactive elements before it has said
 * anything useful.
 */
export const ELEMENT_BUDGET = 220;

/** Landmarks that hold the page's actual content, best first. */
const REGION_RANK: Record<string, number> = {
  main: 0,
  content: 1,
  aside: 2,
  header: 3,
  nav: 4,
  footer: 5,
};

export function formatPageStateForModel(pageState: PageState): string {
  const lines = [
    `## Current Page`,
    `URL: ${pageState.url}`,
    `Title: ${pageState.title}`,
    '',
  ];

  /*
   * RANK BEFORE TRUNCATING.
   *
   * Elements arrive in DOM order and used to be cut at the first 100. On a
   * listings page the masthead, category tabs and a filter sidebar consume most
   * of that before the first result, so an agent asked to compare listings was
   * shown mostly navigation and then "... and N more elements".
   *
   * Sorting by landmark puts content first when the budget binds. Within a
   * region the original DOM order is kept — reading order is meaningful, and
   * shuffling it would cost more than the truncation does. `index` is untouched
   * either way: it is the click handle, and reordering the display must never
   * renumber it.
   */
  const ranked = pageState.elements
    .map((el, i) => ({ el, i }))
    .sort((a, b) => {
      const ra = REGION_RANK[a.el.region ?? 'content'] ?? 1;
      const rb = REGION_RANK[b.el.region ?? 'content'] ?? 1;
      return ra === rb ? a.i - b.i : ra - rb;
    })
    .map((x) => x.el);

  const shown = ranked.slice(0, ELEMENT_BUDGET);
  const dropped = ranked.slice(ELEMENT_BUDGET);

  lines.push(`## Interactive Elements (${pageState.elementCount} total, showing ${shown.length})`);

  for (const el of shown) {
    const parts = [`[${el.index}]`, el.tag];
    if (el.region && el.region !== 'content') parts.push(`in=${el.region}`);
    if (el.role) parts.push(`role=${el.role}`);
    if (el.type) parts.push(`type=${el.type}`);
    if (el.text) parts.push(`"${el.text}"`);
    if (el.href) parts.push(`href=${el.href.substring(0, 80)}`);
    if (el.value) parts.push(`value="${el.value}"`);
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
    lines.push(parts.join(' '));
  }

  if (dropped.length > 0) {
    /*
     * Say WHAT was dropped, not just how many.
     *
     * "... and 137 more elements" reads as incidental, so a model asked to be
     * exhaustive will answer from what it can see and stop. Naming the regions
     * makes the omission legible — and if content was dropped, says plainly that
     * the page is not fully visible and scrolling or paging is required.
     */
    const byRegion = new Map<string, number>();
    for (const el of dropped) {
      const r = el.region ?? 'content';
      byRegion.set(r, (byRegion.get(r) ?? 0) + 1);
    }
    const summary = [...byRegion.entries()].map(([r, n]) => `${n} in ${r}`).join(', ');
    lines.push('', `## Omitted (${dropped.length}): ${summary}`);
    const contentDropped = (byRegion.get('main') ?? 0) + (byRegion.get('content') ?? 0);
    if (contentDropped > 0) {
      lines.push(
        `${contentDropped} of these are CONTENT elements — this page is not fully visible. ` +
          `Scroll or use pagination before concluding you have seen everything.`,
      );
    }
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

/** A block in a tool result's content array. */
export type ToolResultBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };

/**
 * Pack a tool result into what the Messages API expects.
 *
 * A FUNCTION rather than an inline ternary in the loop, because the first
 * version of the test for this scanned the hook's source for `result.image` and
 * `type: 'image'` — and those strings survive a sabotage that drops the image on
 * the floor. The test passed while the feature was broken, which is the exact
 * shape this repo keeps getting caught by. Behaviour has to be callable to be
 * checked.
 *
 * A string when there is no image, because that is the common case and an array
 * of one text block is noise on every single tool call.
 */
export function toolResultContent(result: ToolResult): string | ToolResultBlock[] {
  if (!result.image) return result.message;
  return [
    { type: 'text', text: result.message },
    {
      type: 'image',
      source: { type: 'base64', media_type: result.image.mediaType, data: result.image.data },
    },
  ];
}
