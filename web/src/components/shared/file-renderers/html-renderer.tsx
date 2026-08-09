"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { prepareDeckForPreview, looksLikeDeck, countSlides } from "@/lib/deck-preview";

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

export function HtmlRenderer({ content, name, path, onOpenExternal }: HtmlRendererProps) {
  const { html, isDeck, slides } = useMemo(() => {
    const prepared = prepareDeckForPreview(content);
    return {
      html: prepared.html,
      isDeck: looksLikeDeck(content),
      slides: countSlides(content),
    };
  }, [content]);

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

  const step = (delta: number) => {
    frameRef.current?.contentWindow?.postMessage({ type: "deck:step", delta }, "*");
  };

  if (!isDeck) {
    // Not a deck — still better rendered than shown as source, but with none of
    // the slide chrome, which would be meaningless here.
    return (
      <div className="flex h-full flex-col">
        <div ref={boxRef} className="flex-1 overflow-hidden rounded-lg border border-border">
          <iframe
            title={name}
            srcDoc={html}
            sandbox="allow-scripts"
            className="h-full w-full bg-white"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div
        ref={boxRef}
        className="relative w-full overflow-hidden rounded-lg border border-border bg-black/20"
        style={{ aspectRatio: `${DECK_W} / ${DECK_H}` }}
      >
        <iframe
          ref={frameRef}
          title={name}
          srcDoc={html}
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

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
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

        {/* Full-screen, presenter mode and print-to-PDF live in the browser, so
            the way out stays one click even though the deck now renders here. */}
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
