"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A horizontally scrolling row of filter chips that shows it scrolls.
 *
 * The Marketplace has more categories than fit, and the row simply clipped at
 * the edge: with overlay scrollbars (the macOS default) nothing said there was
 * more, so the categories past the fold were effectively hidden. The fade and
 * the arrow appear only on a side that actually has more to show.
 */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Content arrives after the fetch, and the pane resizes with the window.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [children]);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy?.({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: "smooth" });
  };

  return (
    <div className="relative border-b border-border shrink-0">
      <div
        ref={ref}
        role="group"
        aria-label={label}
        className="flex items-center gap-1.5 px-6 py-2.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      {edges.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center bg-gradient-to-r from-background via-background/90 to-transparent pl-1">
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll categories left"
            className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {edges.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-l from-background via-background/90 to-transparent pr-1">
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label="Scroll categories right"
            className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
