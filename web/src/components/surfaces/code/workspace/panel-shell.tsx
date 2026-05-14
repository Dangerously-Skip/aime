"use client";

import { type ReactNode } from "react";

/**
 * Thin wrapper for panel content.
 *
 * dockview already renders the panel chrome — tab, border, drag handles —
 * so PanelShell no longer renders its own header bar. We just normalise
 * the flex/min-height invariants every panel needs and optionally float
 * a small action strip in the top-right corner of the panel body (used by
 * diff-viewer for view-mode toggles, etc.).
 *
 * The legacy `title`, `icon`, `dragHandleRef` props are dropped; existing
 * callers should simply nest their content directly.
 */
interface PanelShellProps {
  children: ReactNode;
  /** Optional floating top-right action strip. */
  floatingActions?: ReactNode;
  className?: string;
}

export function PanelShell({ children, floatingActions, className }: PanelShellProps) {
  return (
    <div className={`relative flex flex-col h-full min-h-0 overflow-hidden ${className ?? ""}`}>
      {floatingActions && (
        <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1">
          {floatingActions}
        </div>
      )}
      {children}
    </div>
  );
}
