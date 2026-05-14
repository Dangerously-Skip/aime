"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";

/**
 * Minimal split pane. CSS-flexbox-based, single drag handle.
 *
 * Wraps two children and lets the user drag the divider between them. Size
 * is reported back via `onResize(percentage)` and applied via `firstSize`.
 * Constrained by `minFirst` / `maxFirst` (percentages of the container).
 *
 * Replaced react-resizable-panels — its v4 default-sizing was unreliable
 * inside nested Groups + we want our Zustand store as the single source of
 * truth without fighting an opinionated lib.
 */
interface SplitPaneProps {
  /** "horizontal" → side-by-side, "vertical" → top/bottom. */
  orientation: "horizontal" | "vertical";
  /** Size of the first child as a percentage (0–100). */
  firstSize: number;
  /** Minimum size for the first child (default 10). */
  minFirst?: number;
  /** Maximum size for the first child (default 90). */
  maxFirst?: number;
  /** Fired while dragging; receives the new percentage. */
  onResize: (next: number) => void;
  first: ReactNode;
  second: ReactNode;
}

export function SplitPane({
  orientation,
  firstSize,
  minFirst = 10,
  maxFirst = 90,
  onResize,
  first,
  second,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const total = orientation === "horizontal" ? rect.width : rect.height;
      if (total <= 0) return;
      const offset = orientation === "horizontal" ? e.clientX - rect.left : e.clientY - rect.top;
      const pct = Math.max(minFirst, Math.min(maxFirst, (offset / total) * 100));
      onResize(pct);
    },
    [orientation, minFirst, maxFirst, onResize],
  );

  const onPointerUp = useCallback(() => {
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      document.body.style.cursor = orientation === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [orientation],
  );

  const safe = Math.max(minFirst, Math.min(maxFirst, firstSize));
  const flexFirst = `0 0 ${safe}%`;
  const flexSecond = "1 1 0%";
  const containerClass =
    orientation === "horizontal"
      ? "flex h-full min-h-0 w-full"
      : "flex flex-col h-full min-h-0 w-full";
  const handleClass =
    orientation === "horizontal"
      ? "w-1 shrink-0 hover:bg-primary/40 cursor-col-resize transition-colors"
      : "h-1 shrink-0 hover:bg-primary/40 cursor-row-resize transition-colors";

  return (
    <div ref={containerRef} className={containerClass}>
      <div style={{ flex: flexFirst, minWidth: 0, minHeight: 0 }}>{first}</div>
      <div
        className={handleClass}
        onPointerDown={onPointerDown}
        role="separator"
        aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
      />
      <div style={{ flex: flexSecond, minWidth: 0, minHeight: 0 }}>{second}</div>
    </div>
  );
}
