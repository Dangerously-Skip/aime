"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, RotateCcw, WifiOff, ShieldAlert, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  classifyLoadError,
  isUserVisibleLoadFailure,
  type LoadFailure,
} from "@/lib/browser/load-error";

/**
 * Loading and failure state for the Browser surface's `<webview>`, from the
 * element's own events.
 *
 * A failed load used to leave a blank white page — nothing said it had failed,
 * what the URL was, or offered a retry — and a slow one looked identical to a
 * dead one. `did-start-loading` / `did-stop-loading` drive a progress bar;
 * `did-fail-load` (main frame, not ERR_ABORTED) drives an error overlay.
 */

type FailEvent = Event & {
  errorCode?: number;
  errorDescription?: string;
  validatedURL?: string;
  isMainFrame?: boolean;
};

export function useWebviewLoadState() {
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const nodeRef = useRef<EventTarget | null>(null);

  const onStart = useCallback(() => {
    setLoading(true);
    setFailure(null);
  }, []);
  const onStop = useCallback(() => setLoading(false), []);
  const onFail = useCallback((e: Event) => {
    const ev = e as FailEvent;
    if (!isUserVisibleLoadFailure(ev)) return;
    setFailure(classifyLoadError(ev.errorCode!, ev.errorDescription ?? "", ev.validatedURL ?? ""));
    setLoading(false);
  }, []);

  /** Pass the webview element (or null on unmount) — called from its callback ref. */
  const attach = useCallback(
    (node: EventTarget | null) => {
      const prev = nodeRef.current;
      if (prev) {
        prev.removeEventListener("did-start-loading", onStart);
        prev.removeEventListener("did-stop-loading", onStop);
        prev.removeEventListener("did-fail-load", onFail);
      }
      nodeRef.current = node;
      if (node) {
        node.addEventListener("did-start-loading", onStart);
        node.addEventListener("did-stop-loading", onStop);
        node.addEventListener("did-fail-load", onFail);
      }
    },
    [onStart, onStop, onFail],
  );

  const clearFailure = useCallback(() => setFailure(null), []);

  return { loading, failure, attach, clearFailure };
}

/** A thin indeterminate bar across the top of the page while it loads. */
export function LoadProgressBar() {
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/15"
    >
      <div className="h-full w-full bg-primary animate-pulse" />
    </div>
  );
}

const ICONS = {
  dns: SearchX,
  offline: WifiOff,
  tls: ShieldAlert,
  refused: AlertTriangle,
  timeout: AlertTriangle,
  generic: AlertTriangle,
} as const;

export function LoadErrorOverlay({ failure, onRetry }: { failure: LoadFailure; onRetry: () => void }) {
  const Icon = ICONS[failure.kind];
  return (
    <div
      role="alert"
      className="absolute inset-0 z-10 flex items-center justify-center bg-background p-6"
    >
      <div className="max-w-md space-y-3 text-center">
        <Icon className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-base font-medium">{failure.title}</h2>
        {failure.url && (
          <p className="break-all font-mono text-xs text-muted-foreground">{failure.url}</p>
        )}
        <p className="text-sm text-muted-foreground">{failure.hint}</p>
        {failure.description && (
          <p className="font-mono text-[11px] text-muted-foreground/70">{failure.description}</p>
        )}
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    </div>
  );
}
