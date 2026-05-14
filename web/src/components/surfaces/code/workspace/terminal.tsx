"use client";

import { useEffect, useMemo, useRef } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { Terminal as XTerm, type ITheme } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";

import { PanelShell } from "./panel-shell";
import { usePty } from "@/hooks/use-pty";

/**
 * IDE-mode terminal panel. Phase 4 (Agent D).
 *
 * Wraps xterm.js + xterm-addon-fit + xterm-addon-web-links. The PTY itself
 * runs in the Electron main process (see `pty-manager.js`); `usePty` brokers
 * IPC and keeps the session alive across mount/unmount cycles.
 *
 * The xterm theme is derived from CSS custom properties so light/dark switch
 * follows the rest of the app. We re-read the theme on `class` mutations of
 * `documentElement` so toggling the theme repaints the terminal.
 *
 * Right-click context menu (Copy / Paste / Clear / New Terminal) is wired up
 * with a TODO marker for `New Terminal` — multi-tab support is deferred.
 */

interface TerminalPanelProps {
  /** Working directory for the PTY — same as the code-surface folder. */
  workspace: string | null;
  /** PanelShell close handler; toggles visibility in the layout store. */
  onClose?: () => void;
  /** Tells the hook to refresh the last-visible stamp. Defaults to true. */
  visible?: boolean;
  /**
   * Optional unique key to separate multiple terminals on the same
   * workspace. Without it, two terminal panels share one PTY (and show
   * identical output). Pass the dockview panel id.
   */
  sessionKey?: string;
}

/** Read a CSS variable from documentElement, fall back to `def`. */
function readCssVar(name: string, def: string): string {
  if (typeof window === "undefined") return def;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || def;
}

/**
 * Most Quarry CSS vars use the OKLCH/HSL function syntax which xterm.js can't
 * render — it needs concrete hex/rgb strings. We sample the computed colour
 * by writing a hidden element and reading its computed style.
 */
function resolveColor(cssExpr: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const probe = document.createElement("span");
    probe.style.color = cssExpr;
    probe.style.display = "none";
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    if (computed && computed !== "rgba(0, 0, 0, 0)") return computed;
  } catch {
    // ignore — fall back to default
  }
  return fallback;
}

function deriveTheme(): ITheme {
  // Quarry's CSS variables are colour expressions (oklch / hsl). Pipe each
  // through the probe so xterm.js gets a literal rgb() string.
  const bg = resolveColor(`var(--background, #0a0a0a)`, "#0a0a0a");
  const fg = resolveColor(`var(--foreground, #fafafa)`, "#fafafa");
  const muted = resolveColor(`var(--muted-foreground, #888)`, "#888");
  const accent = resolveColor(`var(--primary, #5b9dff)`, "#5b9dff");
  // Selection alpha — xterm needs an rgba.
  const selectionBg = resolveColor(`var(--accent, rgba(90,140,255,0.3))`, "rgba(90,140,255,0.3)");

  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: selectionBg,
    // ANSI palette — sensible defaults that read well in either theme.
    black: "#1e1e1e",
    red: "#f48771",
    green: "#89d185",
    yellow: "#dcdcaa",
    blue: "#569cd6",
    magenta: "#c586c0",
    cyan: "#9cdcfe",
    white: fg,
    brightBlack: muted,
    brightRed: "#f97583",
    brightGreen: "#a5e3a3",
    brightYellow: "#f1e05a",
    brightBlue: accent,
    brightMagenta: "#d19a66",
    brightCyan: "#56b6c2",
    brightWhite: fg,
  };
}

export function TerminalPanel({ workspace, onClose, visible = true, sessionKey }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const linksRef = useRef<WebLinksAddon | null>(null);
  const writeRef = useRef<((data: string) => Promise<void>) | null>(null);
  const resizeRef = useRef<((cols: number, rows: number) => Promise<void>) | null>(null);

  const initialCols = 80;
  const initialRows = 24;
  const { session, write, resize, onData } = usePty(workspace, {
    cols: initialCols,
    rows: initialRows,
    visible,
    sessionKey,
  });

  // Keep stable refs into the latest write/resize closures so the xterm
  // event listeners (registered once at mount) always hit the live IPC.
  useEffect(() => {
    writeRef.current = write;
    resizeRef.current = resize;
  }, [write, resize]);

  // Mount xterm.js once the host element has measurable dimensions. Doing
  // it before that causes "Cannot read properties of undefined (reading
  // 'dimensions')" because xterm's internal Viewport queries its renderer
  // size synchronously on open() and silently corrupts state if there's
  // nothing to measure.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;

    const init = () => {
      if (disposed || xtermRef.current) return;
      if (host.clientWidth < 16 || host.clientHeight < 16) return; // try again on next resize
      const term = new XTerm({
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 5000,
        allowProposedApi: true,
        theme: deriveTheme(),
      });
      const fit = new FitAddon();
      const links = new WebLinksAddon((evt, uri) => {
        evt.preventDefault();
        if (typeof window !== "undefined") {
          try { window.open(uri, "_blank", "noopener"); } catch { /* ignore */ }
        }
      });
      term.loadAddon(fit);
      term.loadAddon(links);
      term.open(host);
      term.onData((data) => { writeRef.current?.(data).catch(() => {}); });
      term.onResize(({ cols, rows }) => { resizeRef.current?.(cols, rows).catch(() => {}); });
      // Defer fit to next frame so xterm's render service has settled.
      requestAnimationFrame(() => {
        if (!host || host.clientWidth < 16 || host.clientHeight < 16) return;
        try { fit.fit(); } catch { /* ignore */ }
      });
      xtermRef.current = term;
      fitRef.current = fit;
      linksRef.current = links;
    };

    // Try once now; if size is zero, the ResizeObserver below picks it up.
    init();

    const ro = new ResizeObserver(() => {
      if (!host || host.clientWidth < 16 || host.clientHeight < 16) return;
      if (!xtermRef.current) {
        init();
      } else {
        try { fitRef.current?.fit(); } catch { /* ignore */ }
      }
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      const term = xtermRef.current;
      const fit = fitRef.current;
      const links = linksRef.current;
      try { term?.dispose(); } catch { /* already disposed */ }
      try { fit?.dispose(); } catch { /* ignore */ }
      try { links?.dispose(); } catch { /* ignore */ }
      xtermRef.current = null;
      fitRef.current = null;
      linksRef.current = null;
    };
  }, []);

  // Theme follow: re-derive when documentElement's class changes (light/dark).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      const t = xtermRef.current;
      if (!t) return;
      t.options.theme = deriveTheme();
    };
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  // Wire PTY output → xterm.
  useEffect(() => {
    if (!session) return;
    onData((chunk) => {
      xtermRef.current?.write(chunk);
    });
  }, [session, onData]);

  // Once the PTY session exists, sync our current dimensions to it (the PTY
  // was opened with the initial 80x24 default; xterm-addon-fit knows the
  // truth now that the host is laid out). Guard on host size — if the panel
  // is mounted but not visible yet, xterm's RenderService.dimensions is
  // undefined and fit() throws.
  useEffect(() => {
    if (!session) return;
    const t = xtermRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!t || !fit || !host) return;
    if (host.clientWidth < 16 || host.clientHeight < 16) return;
    try {
      fit.fit();
      resizeRef.current?.(t.cols, t.rows).catch(() => {});
    } catch {
      /* ignore */
    }
  }, [session]);

  // Right-click context menu — Copy / Paste / Clear / (TODO) New Terminal.
  const contextMenu = useMemo(
    () => async (evt: React.MouseEvent<HTMLDivElement>) => {
      evt.preventDefault();
      const term = xtermRef.current;
      if (!term) return;
      // Bare-bones: if there's a selection, copy; otherwise paste.
      // A real popover menu would be nicer; defer to v2.
      const sel = term.getSelection();
      if (sel) {
        try { await navigator.clipboard.writeText(sel); } catch { /* ignore */ }
        return;
      }
      try {
        const text = await navigator.clipboard.readText();
        if (text) writeRef.current?.(text).catch(() => {});
      } catch {
        /* clipboard not available */
      }
      // TODO(v2): proper context menu with Copy / Paste / Clear / New Terminal.
    },
    [],
  );

  const handleKeyDown = (evt: React.KeyboardEvent<HTMLDivElement>) => {
    // Cmd+K / Ctrl+K — clear screen (keeps scrollback). Common terminal-app default.
    if ((evt.metaKey || evt.ctrlKey) && evt.key.toLowerCase() === "k") {
      evt.preventDefault();
      xtermRef.current?.clear();
    }
  };

  return (
    <PanelShell icon={TerminalIcon} title="Terminal" onClose={onClose}>
      <div
        ref={hostRef}
        onContextMenu={contextMenu}
        onKeyDown={handleKeyDown}
        className="h-full w-full bg-[var(--background)]"
        style={{ padding: 4 }}
        data-testid="terminal-host"
      />
    </PanelShell>
  );
}
