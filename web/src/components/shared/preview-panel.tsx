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

export function PreviewPanel({ url, open, onClose, refreshKey }: PreviewPanelProps) {
  const [currentUrl, setCurrentUrl] = useState(url);
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
      }
      webviewRef.current = node;
      if (node) {
        node.addEventListener("did-navigate", handleNav);
        node.addEventListener("did-navigate-in-page", handleNav);
        node.addEventListener("console-message", handleConsoleMessage as EventListener);
        // Clear console on new webview mount
        setConsoleLogs([]);
        setHasErrors(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function handleNav(e: Event & { url?: string }) {
    if (e.url) {
      setCurrentUrl(e.url);
      // Clear console on navigation
      setConsoleLogs([]);
      setHasErrors(false);
    }
  }

  function handleConsoleMessage(e: Event & { level?: number; message?: string; line?: number; sourceId?: string }) {
    const level = CONSOLE_LEVEL_MAP[e.level ?? 0] || "log";
    if (level === "error") setHasErrors(true);

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

  if (!open) return null;

  return (
    <div className="flex flex-col shrink-0 w-[480px] border-l border-border bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border">
        <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
        <div className="flex-1 min-w-0 rounded-md bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground truncate font-mono">
          {currentUrl}
        </div>
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
