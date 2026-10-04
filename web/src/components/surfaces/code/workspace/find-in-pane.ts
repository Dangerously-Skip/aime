/**
 * Find-in-file for the Code viewer pane.
 *
 * The pane had a find bar for a long time — ⌘F opened it, the toolbar button
 * toggled it, the cheat sheet advertised it — and typing into it did nothing.
 * The query went into state that nothing read. So this does the actual finding.
 *
 * It works on the rendered DOM, not on the file text, because the pane shows
 * many things that are not the file text verbatim (markdown, CSV tables, DOCX)
 * and "find" means find what you can SEE. In edit mode the thing you can see is
 * the highlighted overlay under the transparent textarea, whose text is the
 * draft character for character — so offsets there are draft offsets too.
 *
 * Matches are painted with the CSS Custom Highlight API rather than by
 * wrapping them in `<mark>`: the body is React-owned `dangerouslySetInnerHTML`
 * output, and inserting elements into it would be undone on the next render or,
 * worse, confuse React's reconciliation. A Highlight is a set of Ranges; it
 * changes no DOM at all.
 */

export interface FindMatch {
  start: number;
  end: number;
}

/**
 * Enough for any real search. Past this a one-letter query in a large file is
 * building tens of thousands of Ranges on every keystroke to tell you "lots".
 */
export const FIND_MATCH_CAP = 2000;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Case-insensitive literal matches, non-overlapping, in order.
 *
 * A RegExp with `i` rather than `toLowerCase()` on both sides: lowercasing can
 * change a string's LENGTH (`'İ'.toLowerCase()` is two code units), and every
 * offset after it would then point at the wrong character.
 */
export function findMatches(text: string, query: string, cap = FIND_MATCH_CAP): FindMatch[] {
  if (!query) return [];
  const re = new RegExp(escapeRegExp(query), "gi");
  const out: FindMatch[] = [];
  let m: RegExpExecArray | null;
  while (out.length < cap && (m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export interface TextSegments {
  text: string;
  nodes: Text[];
  /** Offset of each node's first character in `text`. */
  starts: number[];
}

/**
 * The searchable text under `root`, and where each text node sits in it.
 *
 * A textarea's text child is skipped: React seeds it with the INITIAL value and
 * never updates it, so in edit mode it is a stale second copy of the file that
 * would double every match. The overlay above it is the live copy.
 */
export function textSegments(root: Node): TextSegments {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest("textarea, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(text.length);
    text += (n as Text).data;
  }
  return { text, nodes, starts };
}

/**
 * One Range per match. A match can span nodes — highlight.js splits a line into
 * many spans — so start and end are located independently. Both lists are in
 * document order, so one forward pass does it.
 */
export function rangesFor(seg: TextSegments, matches: FindMatch[]): Range[] {
  const { nodes, starts } = seg;
  if (nodes.length === 0) return [];
  const doc = nodes[0].ownerDocument;
  const ranges: Range[] = [];
  let i = 0;
  const nodeAt = (offset: number, isEnd: boolean) => {
    // The node containing `offset`; an END offset may sit at a node's very end.
    while (
      i < nodes.length - 1 &&
      (isEnd ? offset > starts[i] + nodes[i].data.length : offset >= starts[i] + nodes[i].data.length)
    ) {
      i++;
    }
    return i;
  };
  for (const m of matches) {
    const a = nodeAt(m.start, false);
    const startNode = nodes[a];
    const startOffset = m.start - starts[a];
    const b = nodeAt(m.end, true);
    const r = doc.createRange();
    r.setStart(startNode, startOffset);
    r.setEnd(nodes[b], m.end - starts[b]);
    ranges.push(r);
    // The next match starts at or after this one's end; resume from its node.
    i = b;
  }
  return ranges;
}

// ── Painting ─────────────────────────────────────────────────────────────────

export const FIND_HIGHLIGHT = "code-find";
export const FIND_HIGHLIGHT_CURRENT = "code-find-current";

/**
 * Every open file tab mounts its own find bar, but there is one highlight
 * registry per document and the CSS names are static. So each pane publishes
 * its ranges here, and the registry entry is the union — closing one pane's
 * find bar must not wipe the one beside it in a split.
 */
const panes = new Map<symbol, { all: Range[]; current: Range | null }>();

function supported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

/*
 * The ::highlight() rules are injected at runtime rather than living in
 * globals.css: the build's CSS parser (lightningcss) rejects the pseudo-element
 * and printed a warning on every compile, although Chromium supports it.
 * CSS Custom Highlights, not <mark> elements: the body is React-owned HTML and
 * must not be rewritten. In edit mode these paint on the overlay, which shows
 * through the transparent textarea.
 */
export const FIND_HIGHLIGHT_CSS = `
::highlight(${FIND_HIGHLIGHT}) { background-color: color-mix(in oklab, #facc15 40%, transparent); }
::highlight(${FIND_HIGHLIGHT_CURRENT}) { background-color: color-mix(in oklab, #f97316 65%, transparent); color: var(--foreground); }
`;
const STYLE_ID = "aime-find-highlight-styles";

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = FIND_HIGHLIGHT_CSS;
  document.head.appendChild(style);
}

function publish() {
  if (!supported()) return;
  ensureStyles();
  const all: Range[] = [];
  const current: Range[] = [];
  for (const p of panes.values()) {
    all.push(...p.all);
    if (p.current) current.push(p.current);
  }
  if (all.length) CSS.highlights.set(FIND_HIGHLIGHT, new Highlight(...all));
  else CSS.highlights.delete(FIND_HIGHLIGHT);
  if (current.length) CSS.highlights.set(FIND_HIGHLIGHT_CURRENT, new Highlight(...current));
  else CSS.highlights.delete(FIND_HIGHLIGHT_CURRENT);
}

export function setPaneHighlights(pane: symbol, all: Range[], current: Range | null) {
  panes.set(pane, { all, current });
  publish();
}

export function clearPaneHighlights(pane: symbol) {
  if (!panes.delete(pane)) return;
  publish();
}

// ── Scrolling ────────────────────────────────────────────────────────────────

function isScroller(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  return /(auto|scroll)/.test(s.overflowY + s.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
}

/**
 * Bring a match to the middle of its scroller.
 *
 * Not `scrollIntoView`: it scrolls EVERY ancestor, `overflow: hidden` ones
 * included, which would shift the dockview layout under the user; and on a
 * highlight.js block the nearest element is often the whole `<code>`, so it
 * would scroll to the top of the file rather than to the match.
 *
 * In edit mode the match lives in the overlay, which does not scroll itself —
 * it mirrors the textarea. So the textarea is what moves; its scroll handler
 * brings the overlay along.
 */
export function scrollMatchIntoView(range: Range, root: HTMLElement) {
  if (typeof range.getBoundingClientRect !== "function") return;
  const textarea = root.querySelector("textarea");
  let scroller: HTMLElement | null = textarea;
  if (!scroller) {
    let el: HTMLElement | null = range.startContainer.parentElement;
    while (el && el !== root && !isScroller(el)) el = el.parentElement;
    scroller = el && (el !== root || isScroller(root)) ? el : null;
  }
  if (!scroller) return;
  const r = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  if (r.top < box.top || r.bottom > box.bottom) {
    scroller.scrollTop += r.top - box.top - scroller.clientHeight / 2;
  }
  if (r.left < box.left || r.right > box.right) {
    scroller.scrollLeft += r.left - box.left - scroller.clientWidth / 3;
  }
}
