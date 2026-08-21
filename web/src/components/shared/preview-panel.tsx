"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, X, Globe, ExternalLink, Terminal, Bug, Trash2 } from "lucide-react";

interface WebviewNode extends HTMLElement {
  reload: () => void;
  getURL: () => string;
  loadURL: (url: string) => Promise<void>;
  openDevTools: () => void;
  closeDevTools: () => void;
  isDevToolsOpened: () => boolean;
}

interface ConsoleEntry {
  id: number;
  level: "log" | "info" | "warn" | "error";
  message: string;
  line: number;
  sourceId: string;
  timestamp: number;
}

const CONSOLE_LEVEL_MAP: Record<number, ConsoleEntry["level"]> = {
  0: "log",
  1: "info",
  2: "warn",
  3: "error",
};

const MAX_CONSOLE_ENTRIES = 500;

interface PreviewPanelProps {
  url: string;
  open: boolean;
  onClose: () => void;
  refreshKey?: number;
  onWebviewReady?: (ref: WebviewNode | null) => void;
  onConsoleMessage?: (level: string, message: string) => void;
}

/* ── Console log line ── */
function ConsoleLogLine({ entry }: { entry: ConsoleEntry }) {
  const levelStyles: Record<ConsoleEntry["level"], string> = {
    error: "bg-red-500/10 text-red-400 border-l-2 border-red-500",
    warn: "bg-yellow-500/10 text-yellow-400 border-l-2 border-yellow-500",
    info: "bg-blue-500/10 text-blue-300 border-l-2 border-blue-500",
    log: "text-muted-foreground border-l-2 border-transparent",
  };

  const labelStyles: Record<ConsoleEntry["level"], string> = {
    error: "text-red-400",
    warn: "text-yellow-400",
    info: "text-blue-400",
    log: "text-muted-foreground/60",
  };

  return (
    <div className={`flex items-start gap-2 px-2 py-0.5 font-mono text-[11px] ${levelStyles[entry.level]}`}>
      <span className={`shrink-0 w-10 uppercase font-semibold ${labelStyles[entry.level]}`}>
        {entry.level}
      </span>
      <span className="flex-1 min-w-0 break-all whitespace-pre-wrap">{entry.message}</span>
      {entry.line > 0 && (
        <span className="shrink-0 text-muted-foreground/50">:{entry.line}</span>
      )}
    </div>
  );
}

export function PreviewPanel({ url, open, onClose, refreshKey, onWebviewReady, onConsoleMessage }: PreviewPanelProps) {
  const [currentUrl, setCurrentUrl] = useState(url);
  /*
   * What the user is typing, separate from where the page actually is. Bound
   * directly to `currentUrl` the field would be rewritten mid-edit every time
   * the page fired a navigation event.
   */
  const [urlDraft, setUrlDraft] = useState(url);
  const webviewRef = useRef<WebviewNode | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [devToolsOpen, setDevToolsOpen] = useState(false);
  const [hasErrors, setHasErrors] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const consoleScrollRef = useRef<HTMLDivElement>(null);
  const consoleUserScrolledUp = useRef(false);
  const entryIdRef = useRef(0);

  // Auto-scroll console to bottom on new entries
  useEffect(() => {
    if (!consoleUserScrolledUp.current) {
      consoleEndRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [consoleLogs.length]);

  // Reload webview when refreshKey changes
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      webviewRef.current?.reload();
    }
  }, [refreshKey]);

  // Update URL when prop changes
  useEffect(() => {
    setCurrentUrl(url);
    setUrlDraft(url);
    if (webviewRef.current) {
      try {
        const current = webviewRef.current.getURL();
        if (current !== url) {
          webviewRef.current.loadURL(url);
        }
      } catch {
        // webview not ready yet
      }
    }
  }, [url]);

  const callbackRef = useCallback(
    (node: (HTMLElement & WebviewNode) | null) => {
      const prev = webviewRef.current;
      if (prev) {
        prev.removeEventListener("did-navigate", handleNav);
        prev.removeEventListener("did-navigate-in-page", handleNav);
        prev.removeEventListener("console-message", handleConsoleMessage as EventListener);
        onWebviewReady?.(null);
      }
      webviewRef.current = node;
      if (node) {
        node.addEventListener("did-navigate", handleNav);
        node.addEventListener("did-navigate-in-page", handleNav);
        node.addEventListener("console-message", handleConsoleMessage as EventListener);
        // Clear console on new webview mount
        setConsoleLogs([]);
        setHasErrors(false);
        onWebviewReady?.(node);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onWebviewReady]
  );

  function handleNav(e: Event & { url?: string }) {
    if (e.url) {
      setCurrentUrl(e.url);
      setUrlDraft(e.url);
      // Clear console on navigation
      setConsoleLogs([]);
      setHasErrors(false);
    }
  }

  function handleConsoleMessage(e: Event & { level?: number; message?: string; line?: number; sourceId?: string }) {
    const level = CONSOLE_LEVEL_MAP[e.level ?? 0] || "log";
    if (level === "error") setHasErrors(true);

    onConsoleMessage?.(level, e.message || "");

    setConsoleLogs((prev) => {
      const next = [
        ...prev,
        {
          id: ++entryIdRef.current,
          level,
          message: e.message || "",
          line: e.line ?? 0,
          sourceId: e.sourceId || "",
          timestamp: Date.now(),
        },
      ];
      // Cap at MAX_CONSOLE_ENTRIES
      return next.length > MAX_CONSOLE_ENTRIES ? next.slice(-MAX_CONSOLE_ENTRIES) : next;
    });
  }

  function handleRefresh() {
    webviewRef.current?.reload();
  }

  function handleOpenExternal() {
    window.open(currentUrl, "_blank");
  }

  function handleToggleConsole() {
    setDevToolsOpen((prev) => !prev);
  }

  function handleOpenFullDevTools() {
    webviewRef.current?.openDevTools();
  }

  function handleClearConsole() {
    setConsoleLogs([]);
    setHasErrors(false);
  }

  /*
     `open` used to mean "the overlay is showing". A dockview panel decides that
     by existing, so an internal guard can only ever hide content inside a panel
     the user deliberately opened — which is precisely what happened: the tab
     appeared and the body was blank.
     
     Kept in the props for the callers that still toggle it, but it no longer
     suppresses render.
  */

  return (
    /*
       FILLS ITS CONTAINER now, rather than being a 480px slab.
       
       This was written as an overlay docked to the right of the chat column, so
       it carried its own width, `shrink-0` and a left border. Inside a dockview
       panel that is wrong twice over: the panel already has a size, and the
       border draws a seam where the gutter does the job.
       
       `min-h-0` matters — a flex child defaults to `min-height:auto` and refuses
       to shrink below its content, which is what left the webview with no room
       and the panel looking blank.
    */
    <div className="flex flex-col h-full min-h-0 w-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
        {/*
          AN ADDRESS BAR, not a label.
          
          This was a read-only div showing wherever the agent had navigated. That
          was fine while the panel only ever appeared as a side effect of the
          agent writing an HTML file or starting a dev server — but it meant a
          user could not point the preview anywhere, and browser tools are only
          offered to the agent when this webview is live. So the most capable
          agent in the app could drive a browser, and nobody could give it a page
          to start from.
        */}
        <input
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const next = normaliseUrl(urlDraft);
              if (next) {
                setCurrentUrl(next);
                webviewRef.current?.loadURL(next);
              }
            }
            if (e.key === 'Escape') setUrlDraft(currentUrl);
          }}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          placeholder="Enter a URL"
          aria-label="Preview address"
          className="flex-1 min-w-0 rounded-md bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground font-mono outline-none focus:text-foreground focus:ring-1 focus:ring-primary/40"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleRefresh}
          title="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`h-6 w-6 shrink-0 relative ${devToolsOpen ? "bg-accent" : ""}`}
          onClick={handleToggleConsole}
          title="Toggle console"
        >
          <Terminal className="h-3 w-3" />
          {hasErrors && !devToolsOpen && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleOpenFullDevTools}
          title="Open DevTools"
        >
          <Bug className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={handleOpenExternal}
          title="Open in browser"
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={onClose}
          title="Close preview"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Webview + Console */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Webview */}
        <div className={devToolsOpen ? "flex-1 min-h-0" : "flex-1 min-h-0"}>
          <webview
            ref={callbackRef as unknown as React.RefObject<never>}
            src={url}
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        </div>

        {/* Console panel */}
        {devToolsOpen && (
          <div className="h-[200px] shrink-0 border-t border-border flex flex-col bg-background">
            {/* Console header */}
            <div className="flex items-center justify-between px-2 py-1 border-b border-border/50 bg-muted/30">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                Console
                {consoleLogs.length > 0 && (
                  <span className="ml-1.5 text-muted-foreground/60">({consoleLogs.length})</span>
                )}
              </span>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={handleClearConsole}
                  title="Clear console"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={handleToggleConsole}
                  title="Close console"
                >
                  <X className="h-2.5 w-2.5" />
                </Button>
              </div>
            </div>
            {/* Console entries */}
            <div
              ref={consoleScrollRef}
              className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
              onScroll={(e) => {
                const el = e.currentTarget;
                consoleUserScrolledUp.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight >= 20;
              }}
            >
              {consoleLogs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[11px] text-muted-foreground/50">
                  No console output
                </div>
              ) : (
                consoleLogs.map((entry) => (
                  <ConsoleLogLine key={entry.id} entry={entry} />
                ))
              )}
              <div ref={consoleEndRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Turn what someone typed into something loadable.
 *
 * `http(s)` only, deliberately: this webview is handed to an agent, and a
 * preview that will load `file://` on request is a way to read the disk through
 * a text box. Bare hostnames get https rather than being treated as a search —
 * the address bar of a preview panel is not a search engine.
 */
export function normaliseUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}
