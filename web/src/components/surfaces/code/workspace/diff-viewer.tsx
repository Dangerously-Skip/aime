"use client";

/**
 * Diff viewer — Wave 2 (Agent B / Phase 2)
 *
 * Renders a unified diff for `filePath` between `fromRef` and `toRef`
 * (defaults: HEAD vs working tree). Uses `@git-diff-view/react`'s
 * `DiffView` under the hood with auto-detected language and a
 * unified/side-by-side toggle.
 *
 * The component:
 *   - Fetches the diff via `getGitDiff` IPC.
 *   - Splits the raw unified-diff output into per-file blocks (so the
 *     `DiffView` `data.hunks` array gets one entry per file).
 *   - Provides j/k hunk navigation when focused.
 *   - Falls back to an empty / error / loading state when appropriate.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";
import {
  ArrowLeftRight,
  AlignJustify,
  FileDiff,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import { getGitDiff } from "@/lib/code-workspace/ipc";
import { useAppStore } from "@/stores/app-store";
import { PanelShell } from "./panel-shell";

// ── language detection ───────────────────────────────────────────────────

/** Best-effort filename → lowlight language token. */
function detectLang(filePath: string): string {
  const m = filePath.match(/\.([a-z0-9]+)$/i);
  const ext = m ? m[1].toLowerCase() : "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "rb":
      return "ruby";
    case "java":
      return "java";
    case "kt":
      return "kotlin";
    case "swift":
      return "swift";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "toml";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "html":
    case "htm":
      return "html";
    case "xml":
      return "xml";
    case "sql":
      return "sql";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "hpp":
      return "cpp";
    case "cs":
      return "csharp";
    case "php":
      return "php";
    default:
      return "plaintext";
  }
}

// ── unified-diff splitting ───────────────────────────────────────────────

/**
 * Split a raw multi-file unified diff into per-file hunk strings. Each
 * resulting string starts with `diff --git ...` and contains everything
 * up to (but not including) the next `diff --git` header.
 *
 * Single-file diffs pass through unchanged.
 */
function splitDiffByFile(diff: string): string[] {
  if (!diff.trim()) return [];
  // The `diff --git` header is the canonical per-file separator in git's
  // output. Split on it (with positive lookahead) so each result keeps
  // its header.
  const parts = diff.split(/(?=^diff --git )/m);
  return parts.filter((p) => p.trim().length > 0);
}

/** Parse +N/-N counts from a unified diff blob (best effort). */
function countDiffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

// ── modes ────────────────────────────────────────────────────────────────

export type DiffMode =
  | { kind: "working-vs-head" }
  | { kind: "head-vs-base"; baseRef: string }
  | { kind: "branch-vs-branch"; fromRef: string; toRef: string };

interface DiffViewerProps {
  workspace: string;
  filePath: string;
  fromRef?: string;
  toRef?: string;
  /** Override mode externally (overrides fromRef/toRef when present). */
  mode?: DiffMode;
  /** Called when the user requests to close this diff tab. */
  onClose?: () => void;
}

export function DiffViewer({
  workspace,
  filePath,
  fromRef,
  toRef,
  mode: modeProp,
  // onClose is part of the props contract but this view has no close affordance.
}: DiffViewerProps) {
  const theme = useAppStore((s) => s.theme);
  const containerRef = useRef<HTMLDivElement>(null);

  // Local mode state. Defaults to working-vs-HEAD unless caller passes
  // fromRef/toRef.
  const initialMode: DiffMode =
    modeProp ??
    (fromRef || toRef
      ? { kind: "branch-vs-branch", fromRef: fromRef ?? "HEAD", toRef: toRef ?? "" }
      : { kind: "working-vs-head" });
  const [mode, setMode] = useState<DiffMode>(initialMode);

  // Unified vs split toggle. Default to unified (matches Claude Code).
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  const [diffText, setDiffText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  // Resolve mode → IPC opts
  const ipcOpts = useMemo(() => {
    if (mode.kind === "working-vs-head") return { path: filePath };
    if (mode.kind === "head-vs-base") {
      // HEAD vs base branch — compare base...HEAD so the diff shows
      // "what this branch changes relative to base"
      return { path: filePath, fromRef: mode.baseRef, toRef: "HEAD" };
    }
    return { path: filePath, fromRef: mode.fromRef, toRef: mode.toRef };
  }, [mode, filePath]);

  // Fetch diff
  useEffect(() => {
    if (!workspace || !filePath) return;
    const myReq = ++reqIdRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- spinner for the git IPC call this effect starts; nothing to derive during render
    setLoading(true);
    setError(null);
    getGitDiff(workspace, ipcOpts)
      .then((text) => {
        if (myReq !== reqIdRef.current) return;
        setDiffText(text);
      })
      .catch((e: unknown) => {
        if (myReq !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setDiffText("");
      })
      .finally(() => {
        if (myReq === reqIdRef.current) setLoading(false);
      });
  }, [workspace, filePath, ipcOpts]);

  const filesInDiff = useMemo(() => splitDiffByFile(diffText), [diffText]);
  const stats = useMemo(() => countDiffStats(diffText), [diffText]);
  const lang = useMemo(() => detectLang(filePath), [filePath]);

  // Hunk navigation: j → next, k → previous. Implemented by scrolling the
  // viewer to the next `.diff-view-hunk` marker. `@git-diff-view/react`
  // renders hunk separators which we can find via DOM query (no public
  // imperative API exposed at v0.1.3).
  const hunkIndexRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      // Only react if the diff container has focus (or contains the
      // active element).
      const root = containerRef.current;
      if (!root) return;
      if (
        document.activeElement &&
        !root.contains(document.activeElement) &&
        document.activeElement !== root
      ) return;
      if (e.key !== "j" && e.key !== "k") return;
      // Don't steal typing focus from text inputs / contenteditable
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) {
        return;
      }
      const hunks = root.querySelectorAll<HTMLElement>(
        // Try a few class names — `@git-diff-view/react` v0.1.x uses
        // `diff-line-extend` for the "@@" header rows. We're tolerant
        // here so this keeps working across minor version bumps.
        ".diff-line-extend, [data-type='hunk'], .diff-view-hunk",
      );
      if (hunks.length === 0) return;
      e.preventDefault();
      if (e.key === "j") {
        hunkIndexRef.current = Math.min(hunkIndexRef.current + 1, hunks.length - 1);
      } else {
        hunkIndexRef.current = Math.max(hunkIndexRef.current - 1, 0);
      }
      hunks[hunkIndexRef.current]?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  // Reset hunk pointer when the diff content changes
  useEffect(() => {
    hunkIndexRef.current = 0;
  }, [diffText]);

  // ── Mode picker (placeholder dropdown) ──────────────────────────────────
  // Working tree vs HEAD (default)
  // HEAD vs base branch — TODO(Agent C): wire baseRef from layout/picker
  // Two arbitrary branches — placeholder for future picker
  // For now we hard-code "main" as the base branch.
  // TODO(Agent C): replace literal "main" with the picker-resolved base.
  const HARDCODED_BASE = "main";

  function setModeFromPicker(value: string) {
    if (value === "working-vs-head") setMode({ kind: "working-vs-head" });
    else if (value === "head-vs-base") setMode({ kind: "head-vs-base", baseRef: HARDCODED_BASE });
    else if (value === "branch-vs-branch")
      setMode({ kind: "branch-vs-branch", fromRef: HARDCODED_BASE, toRef: "HEAD" });
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const diffViewTheme: "light" | "dark" = theme === "dark" || theme === "emma" ? "dark" : "light";

  const headerActions = (
    <>
      <select
        aria-label="Diff mode"
        className="text-[11px] bg-transparent border border-border/40 rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
        value={mode.kind}
        onChange={(e) => setModeFromPicker(e.target.value)}
      >
        <option value="working-vs-head">Working tree vs HEAD</option>
        <option value="head-vs-base">HEAD vs base branch</option>
        <option value="branch-vs-branch">Two branches…</option>
      </select>
      <button
        type="button"
        onClick={() => setViewMode((m) => (m === "unified" ? "split" : "unified"))}
        title={viewMode === "unified" ? "Switch to side-by-side" : "Switch to unified"}
        className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        aria-label="Toggle view mode"
      >
        {viewMode === "unified" ? (
          <ArrowLeftRight className="h-3 w-3" strokeWidth={1.75} />
        ) : (
          <AlignJustify className="h-3 w-3" strokeWidth={1.75} />
        )}
      </button>
    </>
  );

  const title = (
    <span className="flex items-baseline gap-2 min-w-0">
      <span className="truncate font-mono text-[11px]">{filePath}</span>
      {(stats.additions > 0 || stats.deletions > 0) && (
        <span className="text-[10px] tabular-nums shrink-0">
          <span className="text-emerald-500">+{stats.additions}</span>{" "}
          <span className="text-rose-500">−{stats.deletions}</span>
        </span>
      )}
    </span>
  );

  return (
    <PanelShell floatingActions={headerActions}>
      <div
        ref={containerRef}
        tabIndex={0}
        className="h-full flex flex-col min-h-0 outline-none"
      >
        <div className="flex items-center gap-2 px-2 h-7 shrink-0 min-w-0">
          {title}
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <div className="h-full flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
              Loading diff…
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground px-6 text-center">
              <AlertCircle className="h-5 w-5 text-rose-500/80" strokeWidth={1.75} />
              <p className="font-medium text-foreground/80">Failed to load diff</p>
              <p className="font-mono text-[11px] break-all max-w-md">{error}</p>
            </div>
          ) : filesInDiff.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <FileDiff className="h-6 w-6 opacity-40" strokeWidth={1.5} />
              <p>No changes</p>
              <p className="opacity-70">The file is unmodified for the current diff mode.</p>
            </div>
          ) : (
            <DiffView<string>
              data={{
                oldFile: { fileName: filePath, fileLang: lang },
                newFile: { fileName: filePath, fileLang: lang },
                hunks: filesInDiff,
              }}
              diffViewMode={viewMode === "unified" ? DiffModeEnum.Unified : DiffModeEnum.Split}
              diffViewTheme={diffViewTheme}
              diffViewHighlight
              diffViewWrap={false}
              diffViewFontSize={12}
            />
          )}
        </div>
        <div className="px-2 py-1 border-t border-border/40 bg-muted/10 text-[10px] text-muted-foreground shrink-0">
          Press <kbd className="px-1 py-0.5 bg-muted/60 border border-border/40 rounded font-mono">j</kbd>
          {" / "}
          <kbd className="px-1 py-0.5 bg-muted/60 border border-border/40 rounded font-mono">k</kbd>
          {" to navigate hunks"}
        </div>
      </div>
    </PanelShell>
  );
}
