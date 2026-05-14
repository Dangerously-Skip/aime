"use client";

import { type ReactNode } from "react";
import { type LucideIcon, X } from "lucide-react";

/**
 * Shared chrome for every workspace panel: header + collapse button +
 * draggable handle area. Wave 2 panels mount inside this so the look is
 * consistent.
 */
interface PanelShellProps {
  icon?: LucideIcon;
  title: string;
  /** Right-aligned actions in the header. */
  actions?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  /** Hint for the drag-to-rearrange affordance — Wave 1 doesn't implement DnD. */
  dragHandleRef?: React.Ref<HTMLDivElement>;
  className?: string;
}

export function PanelShell({
  icon: Icon,
  title,
  actions,
  onClose,
  children,
  dragHandleRef,
  className,
}: PanelShellProps) {
  return (
    <div className={`flex flex-col h-full min-h-0 bg-card border border-border/40 rounded-md overflow-hidden ${className ?? ""}`}>
      <div
        ref={dragHandleRef}
        className="flex items-center gap-1.5 px-2 h-8 border-b border-border/40 bg-muted/30 shrink-0 select-none"
      >
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />}
        <span className="text-xs font-medium text-foreground/80 truncate flex-1">{title}</span>
        <div className="flex items-center gap-1">
          {actions}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Hide panel"
              title="Hide panel (Cmd+B / Cmd+J / Cmd+\\)"
            >
              <X className="h-3 w-3" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}
