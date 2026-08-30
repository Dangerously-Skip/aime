"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Share2 } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { prepareDeckForPreview, looksLikeDeck, countSlides } from "@/lib/deck-preview";
import { inlineDeckAssets } from "@/lib/deck-inline-assets";

/**
 * View a generated HTML page — and, when it is one of our decks, view it as a
 * deck rather than as source.
 *
 * `.html` used to fall through to the code renderer, so a finished deck arrived
 * in the artifact panel as a wall of markup with an "Open" button to a browser.
 * The deck was good; there was just no way to look at it without leaving.
 *
 * Two things make this awkward enough to be worth explaining.
 *
 * 1. The deck links its stylesheets by absolute filesystem path, which resolves
 *    on `file://` and nowhere else. `prepareDeckForPreview` repoints those at
 *    the app's asset route; without it the iframe renders unstyled text, which
 *    looks like the theme failed rather than the preview failing.
 * 2. A slide is authored at a fixed 1280×720 and scaled to fit, exactly as the
 *    theme gallery does. `scale()` takes a UNITLESS number — a `calc()` with
 *    units silently does nothing, which is how the gallery previews shipped
 *    blank the first time.
 */

const DECK_W = 1280;
const DECK_H = 720;

interface HtmlRendererProps {
  content: string;
  name: string;
  path: string;
  onOpenExternal: (path: string) => void;
}

/**
 * Asset text by URL, fetched once for the whole session.
 *
 * Every deck pulls the same `base.css` and `runtime.js`. Promises rather than
 * strings so two decks opening in the same tick share one request, and a
 * failure is never cached — the session guard may reload with a fresh token,
 * and a cached rejection would outlive the problem.
 */
const assetCache = new Map<string, Promise<string>>();

function fetchAssetText(url: string): Promise<string> {
  const hit = assetCache.get(url);
  if (hit) return hit;
  const p = fetch(url)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .catch((e) => {
      assetCache.delete(url);
      throw e;
    });
  assetCache.set(url, p);
  return p;
}

export function HtmlRenderer({ content, name, path, onOpenExternal }: HtmlRendererProps) {
  const { html: linkedHtml, isDeck, slides } = useMemo(() => {
    const prepared = prepareDeckForPreview(content, path);
    return {
      html: prepared.html,
      isDeck: looksLikeDeck(content),
      slides: countSlides(content),
    };
  }, [content, path]);

  /*
   * The frame gets the deck with its assets ALREADY IN IT.
   *
   * See `deck-inline-assets.ts`: the sandboxed frame cannot fetch the
   * credentialed asset route in Electron, `runtime.js` never ran, and the deck
   * was inert — no buttons, no keys, no clicks. Measured in the real app.
   *
   * `null` until they are in hand, rather than mounting the linked version
   * first: that would start a load the frame cannot finish and then replace it,
   * giving every deck two frames, one of them dead.
   */
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    inlineDeckAssets(linkedHtml, fetchAssetText)
      .then((h) => alive && setHtml(h))
      // Worst case is the behaviour we already had, not a blank panel.
      .catch(() => alive && setHtml(linkedHtml));
    return () => {
      alive = false;
    };
  }, [linkedHtml]);

  const frameRef = useRef<HTMLIFrameElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [index, setIndex] = useState(0);
  const [reported, setReported] = useState<number | null>(null);
  const total = reported ?? slides;

  // Scale to the container's real width, remeasured as the panel resizes.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / DECK_W);
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  /**
   * Position is reported BY the deck, never guessed here.
   *
   * The frame is sandboxed without `allow-same-origin`, so it is an opaque
   * origin and `contentWindow.document` is unreachable. An earlier version
   * reached for it anyway and every click on "next" threw a SecurityError — the
   * sandbox choice and the navigation code contradicting each other.
   *
   * Relaxing the sandbox was never the fix: `allow-scripts` plus
   * `allow-same-origin` lets framed content remove its own sandbox, and this
   * HTML is model-written from web pages. So the shim injected by
   * `prepareDeckForPreview` posts the real index back, which also removes the
   * second source of truth a locally-incremented counter would create.
   */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Origin is "null" for a sandboxed frame, so identity is the only usable
      // check — and the only one that matters: is this OUR iframe?
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { type?: string; index?: number; total?: number } | null;
      if (d?.type !== "deck:position" || typeof d.index !== "number") return;
      setIndex(d.index);
      if (typeof d.total === "number" && d.total > 0) setReported(d.total);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const step = useCallback((delta: number) => {
    frameRef.current?.contentWindow?.postMessage({ type: "deck:step", delta }, "*");
  }, []);

  /**
   * Arrow keys move the deck.
   *
   * The bridge could always do this — `deck:step` dispatches a real keydown
   * inside the frame, where runtime.js is listening — but nothing in the PARENT
   * ever listened, so the keys only worked in full screen. Reported as "arrow
   * keys aren't working on slides in the panel view".
   *
   * WHY NOT JUST FOCUS THE IFRAME. The frame is sandboxed to an opaque origin
   * on purpose (`allow-scripts` without `allow-same-origin`, because this HTML
   * is model-written from web pages). We cannot reach into it to focus it, and
   * even when the user clicks the slide the key events belong to the frame's
   * document, not ours. So the parent listens for itself and forwards.
   *
   * SCOPED TO THIS PANEL, deliberately. A window-level listener would take the
   * arrow keys away from the file tree, the editor and every text field in the
   * app — the classic way a viewer breaks the rest of a workspace. The handler
   * sits on the deck's own container, which is focusable and takes focus when
   * you click it, so it fires only when the deck is what you are using.
   */
  const deckRef = useRef<HTMLDivElement>(null);

  /** Which way a key moves the deck, or 0 if it is not ours. */
  const deltaFor = (key: string) =>
    key === "ArrowRight" || key === "PageDown" || key === " "
      ? 1
      : key === "ArrowLeft" || key === "PageUp"
        ? -1
        : 0;

  /** A key typed into a field is never deck navigation. */
  const isTypingTarget = (el: Element | null) =>
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      (el as HTMLElement).isContentEditable);

  const onDeckKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isTypingTarget(e.target as Element)) return;
      const delta = deltaFor(e.key);
      if (!delta) return;
      // Space and PageDown scroll a pane by default; arrows move a list.
      e.preventDefault();
      step(delta);
    },
    [step],
  );

  /*
   * ALSO LISTEN WHEN NOTHING IS FOCUSED.
   *
   * The container handler covers the case where you have clicked inside the
   * panel, and clicking the SLIDE puts focus in the frame where `runtime.js`
   * handles the keys itself. Neither covers the ordinary one: open a deck and
   * press the right arrow without clicking anything first. Focus is still on
   * `<body>`, the event never enters this subtree, and the key reaches nobody —
   * which is exactly what "arrow keys aren't working" meant, and why fixing
   * only the container did not fix it.
   *
   * The guard is what keeps this from being the window-level listener that
   * breaks everything else: it acts ONLY when focus is nowhere in particular
   * (`body`, or nothing). The moment the user is in a text field, a tree item,
   * a button in another panel — anything focusable — this stands down and that
   * component keeps its arrow keys.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The container handler above already dealt with it.
      if (e.defaultPrevented) return;
      const active = document.activeElement;
      const box = deckRef.current;
      if (!box) return;

      /*
       * WHOSE KEY IS IT? Three shapes count as "the deck's", and the middle one
       * is what this fix is about.
       *
       *   nothing focused        — a freshly opened panel; focus is on <body>.
       *   focus INSIDE the deck  — the container handler ran; we are the
       *                            fallback if it did not preventDefault.
       *   focus on an ANCESTOR   — the deck sits inside a modal Sheet, and a
       *                            dialog moves focus to its own wrapper on
       *                            open. `activeElement` is then never <body>
       *                            and never inside the deck, so both earlier
       *                            versions of this stood down and the arrows
       *                            did nothing. The deck is a DESCENDANT of the
       *                            focused element, which is exactly the case
       *                            neither `contains` check covered.
       */
      const inert = !active || active === document.body;
      const inside = !!active && box.contains(active);
      const wrapping = !!active && active !== document.body && active.contains(box);
      if (!inert && !inside && !wrapping) return;

      if (isTypingTarget(active)) return;
      const delta = deltaFor(e.key);
      if (!delta) return;
      /*
       * Only if this deck is actually on screen. Surfaces stay mounted while
       * hidden in this app, so a deck in a background tab would otherwise
       * answer keys meant for whatever the user is looking at.
       */
      if (box.offsetParent === null) return;
      e.preventDefault();
      step(delta);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step]);

  const deckStorage = useSettingsStore((st) => st.deckStorage);
  const [sharing, setSharing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [shareResult, setShareResult] = useState<{ url: string; summary: string } | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  /**
   * Publish to storage the user has already connected.
   *
   * `audience` is sent as the user's intent and the SERVER decides what it can
   * honour — a target that cannot restrict to named people refuses rather than
   * downgrading to an unguessable link, and the reply carries what was actually
   * granted. So the confirmation below reports `effective`, not what was asked.
   */
  const handleShare = useCallback(
    async (kind: 'link' | 'people', target: 'google-drive' | 's3' = 'google-drive') => {
      setSharing(true);
      setShareError(null);
      setShareResult(null);
      try {
        const res = await fetch('/api/deck/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path,
            target,
            // Identifiers only — the bucket's secret key is read server-side
            // from the encrypted store, never sent from here.
            ...(target === 's3' && deckStorage ? { storage: deckStorage } : {}),
            audience: kind === 'link' ? { kind } : { kind, emails: recipients.split(',') },
          }),
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.message || `Publish failed (${res.status})`);
        setShareResult({ url: out.url, summary: out.summary });
        await navigator.clipboard?.writeText(out.url).catch(() => {});
      } catch (err) {
        setShareError(err instanceof Error ? err.message : 'Publish failed');
      } finally {
        setSharing(false);
      }
    },
    [path, recipients, deckStorage],
  );

  const [exporting, setExporting] = useState(false);

  /**
   * Bundle the deck into one file and hand it to the browser's download.
   *
   * The server does the inlining because it needs the filesystem; the client
   * only saves the result. `missing` is surfaced rather than swallowed — an
   * export with an un-inlined reference looks perfect to the person who made it
   * (they have the files locally) and is broken for everyone they send it to.
   */
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/deck/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const out = (await res.json()) as {
        fileName: string; html: string; missing: string[]; remoteFonts: string[];
      };

      const url = URL.createObjectURL(new Blob([out.html], { type: 'text/html' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = out.fileName;
      a.click();
      URL.revokeObjectURL(url);

      if (out.missing.length > 0) {
        console.warn('[deck-export] could not inline:', out.missing);
      }
    } catch (err) {
      console.error('[deck-export]', err);
    } finally {
      setExporting(false);
    }
  }, [path]);

  if (!isDeck) {
    // Not a deck — still better rendered than shown as source, but with none of
    // the slide chrome, which would be meaningless here.
    return (
      <div className="flex h-full flex-col">
        <div ref={boxRef} className="flex-1 overflow-hidden rounded-lg border border-border">
          <iframe
            title={name}
            srcDoc={html ?? undefined}
            sandbox="allow-scripts"
            className="h-full w-full bg-white"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={deckRef}
      className="flex h-full min-h-0 flex-col gap-2 p-2 outline-none"
      /*
       * `tabIndex={-1}`: focusable by click and by script, but not a stop on
       * the tab order — a deck is not a control, and adding it to the sequence
       * would put a silent stop between the file tree and the buttons below.
       */
      tabIndex={-1}
      onKeyDown={onDeckKeyDown}
      /*
       * Clicking the slide focuses this container. Without it the click lands
       * on the iframe, focus goes into a document we cannot see, and the next
       * arrow key reaches nobody at all.
       */
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement)?.closest("input, textarea, button")) {
          e.currentTarget.focus({ preventScroll: true });
        }
      }}
    >
      <div
        ref={boxRef}
        className="relative w-full overflow-hidden rounded-lg border border-border bg-black/20"
        style={{ aspectRatio: `${DECK_W} / ${DECK_H}` }}
      >
        <iframe
          ref={frameRef}
          title={name}
          srcDoc={html ?? undefined}
          /*
           * `allow-scripts` WITHOUT `allow-same-origin`. The deck needs its
           * runtime, but the two together let sandboxed content remove its own
           * sandbox — and this HTML was written by a model from web content, so
           * it is not trusted with the app's origin.
           */
          sandbox="allow-scripts"
          className="absolute left-0 top-0 origin-top-left border-0 bg-white"
          style={{ width: DECK_W, height: DECK_H, transform: `scale(${scale})` }}
        />
      </div>

      {/* relative: the share panel is absolutely positioned against this row */}
      <div className="relative flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <button
            onClick={() => step(-1)}
            disabled={index === 0}
            className="rounded p-1 transition-colors hover:bg-accent disabled:opacity-40"
            aria-label="Previous slide"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => step(1)}
            disabled={index >= total - 1}
            className="rounded p-1 transition-colors hover:bg-accent disabled:opacity-40"
            aria-label="Next slide"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="tabular-nums">
            {Math.min(index + 1, total)} / {total}
          </span>
        </div>

        {shareOpen && (
          <div className="absolute bottom-10 right-2 z-20 w-80 rounded-md border border-border bg-popover p-3 text-xs shadow-lg">
            {shareResult ? (
              <div className="space-y-2">
                <p className="text-foreground">{shareResult.summary}</p>
                <input
                  readOnly
                  value={shareResult.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px]"
                />
                <p className="text-muted-foreground">Copied to your clipboard.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-muted-foreground">
                  Publishes a self-contained copy to your Google Drive.
                </p>
                <button
                  disabled={sharing}
                  onClick={() => handleShare('link')}
                  className="w-full rounded border border-border px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
                >
                  <span className="font-medium">Anyone with the link</span>
                  <span className="block text-muted-foreground">
                    No sign-in needed. Treat the link itself as the secret.
                  </span>
                </button>
                <input
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder="name@company.com, other@company.com"
                  className="w-full rounded border border-border bg-background px-2 py-1"
                />
                <button
                  disabled={sharing || !recipients.trim()}
                  onClick={() => handleShare('people')}
                  className="w-full rounded border border-border px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
                >
                  <span className="font-medium">Only these people</span>
                  <span className="block text-muted-foreground">
                    Enforced by Google — they sign in to open it.
                  </span>
                </button>
                {deckStorage?.bucket && (
                  <button
                    disabled={sharing}
                    onClick={() => handleShare('link', 's3')}
                    className="w-full rounded border border-border px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
                  >
                    <span className="font-medium">Link on your own storage</span>
                    <span className="block text-muted-foreground">
                      Unguessable, but anyone holding it can open it.
                    </span>
                  </button>
                )}
                {shareError && <p className="text-orange-500">{shareError}</p>}
                {sharing && <p className="text-muted-foreground">Publishing…</p>}
              </div>
            )}
          </div>
        )}

        {/* A deck as written links its stylesheets by absolute path into the
            author's home directory and its images relatively, so sending
            someone the file gives them unstyled text and broken pictures. This
            is the one-file version. */}
        <button
          onClick={handleExport}
          disabled={exporting}
          title="Save a single self-contained file you can email or share"
          className="flex items-center gap-1.5 rounded px-2 py-1 transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {exporting ? 'Packaging…' : 'Export to share'}
        </button>

        <button
          onClick={() => setShareOpen((v) => !v)}
          title="Publish to Google Drive and get a link"
          className="flex items-center gap-1.5 rounded px-2 py-1 transition-colors hover:bg-accent hover:text-foreground"
        >
          <Share2 className="h-3.5 w-3.5" />
          Share
        </button>

        <button
          onClick={() => onOpenExternal(path)}
          className="flex items-center gap-1.5 rounded px-2 py-1 transition-colors hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open full screen
        </button>
      </div>
    </div>
  );
}
