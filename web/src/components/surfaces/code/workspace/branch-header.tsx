"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ExternalLink,
  FolderOpen,
  GitBranch,
  GitCommit as CommitIcon,
  GitCompare,
  GitPullRequestArrow,
  History,
  Loader2,
  MoreVertical,
  RotateCcw,
} from "lucide-react";
import { FolderPicker } from "@/components/shared/folder-picker";
import { useGitStatus } from "@/hooks/use-git-status";
import { useCodeWorkspace } from "@/hooks/use-code-workspace";
import { useSettingsStore } from "@/stores/settings-store";
import { useElectron } from "@/hooks/use-electron";
import {
  getGitLog,
  openExternalUrl,
  pushGitBranch,
} from "@/lib/code-workspace/ipc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BranchPicker } from "./branch-picker";

interface BranchHeaderProps {
  workspace: string | null;
  onFolderChange: (folder: string | null) => void;
  /** Toggle the history view (rendered in the viewer slot by the parent). */
  historyOpen: boolean;
  onToggleHistory: () => void;
  /** Optional base branch override — when the user picks a base from BranchPicker. */
  baseBranch: string | null;
  onBaseBranchChange: (branch: string | null) => void;
}

/**
 * Top-of-workspace strip. Shows the current branch state, folder picker, and
 * actions: open history, create PR, editor / Finder / reset via kebab.
 */
export function BranchHeader({
  workspace,
  onFolderChange,
  historyOpen,
  onToggleHistory,
  baseBranch,
  onBaseBranchChange,
}: BranchHeaderProps) {
  const { status } = useGitStatus(workspace);
  const { resetLayout } = useCodeWorkspace(workspace);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const { showNotification } = useElectron();

  const [creatingPr, setCreatingPr] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prError, setPrError] = useState<string | null>(null);

  const currentBranch = status?.branch ?? "—";
  const effectiveBase = baseBranch ?? status?.baseBranch ?? "main";

  // Sum line stats across changed files. `additions` / `deletions` may not be
  // populated by Agent B yet; fall back to 0 so the header still renders.
  const lineStats = useMemo(() => {
    if (!status) return { added: 0, deleted: 0 };
    return status.files.reduce(
      (acc, f) => ({
        added: acc.added + (f.additions ?? 0),
        deleted: acc.deleted + (f.deletions ?? 0),
      }),
      { added: 0, deleted: 0 },
    );
  }, [status]);

  const isProtectedBranch =
    !currentBranch || currentBranch === "main" || currentBranch === "master";
  const canCreatePr =
    !!workspace && !!status?.branch && !isProtectedBranch && (status?.ahead ?? 0) > 0;

  const handleCreatePr = useCallback(async () => {
    if (!workspace || !status?.branch || creatingPr) return;
    setCreatingPr(true);
    setPrError(null);
    setPrUrl(null);

    try {
      // 1. Pre-fill PR title + body from the last few commits.
      const recent = await getGitLog(workspace, { limit: 5 });
      const title = recent[0]?.subject || `Changes on ${status.branch}`;
      const body =
        recent.length > 0
          ? recent.map((c) => `- ${c.subject}`).join("\n")
          : "_No commit messages available._";

      // 2. Push -u origin <branch>. Idempotent — git no-ops if up to date.
      const pushed = await pushGitBranch(workspace, status.branch);
      if (!pushed.ok) {
        // Soft-fail when the only error is "already up-to-date" or upstream
        // already configured. Otherwise surface the failure to the user.
        const msg = pushed.message.toLowerCase();
        if (!msg.includes("up-to-date") && !msg.includes("everything up to date")) {
          throw new Error(`Push failed: ${pushed.message}`);
        }
      }

      // 3. Spawn a sub-agent to call the GitHub MCP. The sub-agent route
      //    already loads provisioned MCP servers (including GitHub) so this is
      //    the lowest-friction integration path that doesn't require a
      //    bespoke server endpoint.
      const task = [
        `Create a GitHub pull request for the current repository.`,
        ``,
        `Working directory: ${workspace}`,
        `Head branch: ${status.branch}`,
        `Base branch: ${effectiveBase}`,
        ``,
        `Title: ${title}`,
        ``,
        `Body:`,
        body,
        ``,
        `Use the mcp__github__create_pull_request tool. Detect the repository`,
        `owner and name from the workspace's git remote 'origin'. After`,
        `creating the PR, respond with ONLY the PR URL (no commentary).`,
      ].join("\n");

      const res = await fetch("/api/subagent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentChatId: `code-pr-${Date.now()}`,
          task,
          surfaceId: "code",
          cwd: workspace,
          apiKey: anthropicApiKey || undefined,
          extraAllowedTools: ["mcp__github__create_pull_request"],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Subagent error (${res.status})`);
      }

      const data = (await res.json()) as { ok: boolean; output: string };
      const url = extractPrUrl(data.output);
      if (!url) {
        throw new Error(
          `PR creation responded but no URL was returned. Output: ${data.output.slice(0, 200)}`,
        );
      }

      setPrUrl(url);
      showNotification("Pull request created", url);
      await openExternalUrl(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPrError(msg);
    } finally {
      setCreatingPr(false);
    }
  }, [workspace, status?.branch, effectiveBase, creatingPr, anthropicApiKey, showNotification]);

  const handleOpenInFinder = useCallback(() => {
    if (!workspace || typeof window === "undefined") return;
    window.electronAPI?.openPath(workspace);
  }, [workspace]);

  const handleOpenInEditor = useCallback((editorId: string) => {
    if (!workspace || typeof window === "undefined") return;
    window.electronAPI?.openInEditor?.(editorId, workspace);
  }, [workspace]);

  return (
    <div className="flex items-center h-10 px-2 border-b border-border/40 bg-muted/20 gap-2 shrink-0">
      <FolderPicker
        folder={workspace}
        onFolderChange={onFolderChange}
        className="h-7 border-0 bg-transparent shadow-none text-foreground/80 hover:bg-muted/60"
      />

      <div className="h-4 w-px bg-border/60" />

      <BranchPicker
        workspace={workspace}
        currentBranch={effectiveBase}
        disabled={!workspace}
        onSelect={(b) => onBaseBranchChange(b === currentBranch ? null : b)}
        className="text-muted-foreground hover:text-foreground"
      />
      <span className="text-xs text-muted-foreground">←</span>
      <span
        className="inline-flex items-center gap-1 px-1.5 h-6 text-xs font-mono text-foreground"
        title={`Current branch: ${currentBranch}`}
      >
        <GitBranch className="h-3 w-3 text-primary" strokeWidth={1.75} />
        <span className="truncate max-w-[180px]">{currentBranch}</span>
      </span>

      {/* Ahead/behind */}
      {status && (status.ahead > 0 || status.behind > 0) && (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground ml-1">
          {status.ahead > 0 && <span title="commits ahead">↑{status.ahead}</span>}
          {status.behind > 0 && <span title="commits behind">↓{status.behind}</span>}
        </span>
      )}

      {/* Line stats */}
      {status && status.files.length > 0 && (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono ml-1">
          {lineStats.added > 0 && (
            <span className="text-green-600 dark:text-green-400" title="lines added">
              +{lineStats.added}
            </span>
          )}
          {lineStats.deleted > 0 && (
            <span className="text-red-600 dark:text-red-400" title="lines deleted">
              −{lineStats.deleted}
            </span>
          )}
          {lineStats.added === 0 && lineStats.deleted === 0 && (
            <span className="text-muted-foreground">{status.files.length} changed</span>
          )}
        </span>
      )}

      <div className="flex-1 min-w-0" />

      {/* Inline PR result chip */}
      {prUrl && (
        <button
          type="button"
          onClick={() => openExternalUrl(prUrl)}
          className="inline-flex items-center gap-1 text-[11px] font-mono px-2 h-6 rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          title={prUrl}
        >
          <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
          <span className="truncate max-w-[200px]">PR opened</span>
        </button>
      )}
      {prError && !prUrl && (
        <span
          className="inline-flex items-center gap-1 text-[11px] px-2 h-6 rounded-md border border-destructive/40 bg-destructive/10 text-destructive max-w-[260px]"
          title={prError}
        >
          <span className="truncate">PR error: {prError}</span>
        </span>
      )}

      {/* History toggle */}
      <button
        type="button"
        onClick={onToggleHistory}
        className={
          "h-7 inline-flex items-center gap-1.5 rounded-md px-2 text-xs transition-colors " +
          (historyOpen
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/60")
        }
        title="Toggle commit history"
        aria-pressed={historyOpen}
      >
        <History className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>History</span>
      </button>

      {/* Review N — open a diff tab for every modified file */}
      {(status?.files.length ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => {
            if (typeof window === "undefined" || !status) return;
            const openDiff = (window as unknown as Record<string, unknown>).__ideOpenDiff as
              | ((p: string) => void)
              | undefined;
            if (!openDiff || !workspace) return;
            const root = workspace.replace(/\/+$/, "");
            for (const f of status.files) {
              if (f.status === "deleted") continue; // diffing a deleted file is awkward
              openDiff(`${root}/${f.path}`);
            }
          }}
          className="h-7 inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs border border-border/60 bg-card hover:bg-muted/60 hover:border-border transition-colors"
          title={`Open a diff tab for each of the ${status?.files.length} changed file(s)`}
        >
          <GitCompare className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>Review {status?.files.length}</span>
        </button>
      )}

      {/* Create PR */}
      <button
        type="button"
        onClick={handleCreatePr}
        disabled={!canCreatePr || creatingPr}
        className="h-7 inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title={
          !workspace
            ? "Open a folder first"
            : isProtectedBranch
              ? "Switch off main / master to open a PR"
              : (status?.ahead ?? 0) === 0
                ? "No commits ahead of base — nothing to PR"
                : `Open PR: ${currentBranch} → ${effectiveBase}`
        }
      >
        {creatingPr ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <GitPullRequestArrow className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
        <span>{creatingPr ? "Creating…" : "Create PR"}</span>
      </button>

      {/* Kebab menu */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title="More actions"
              aria-label="More actions"
            />
          }
        >
          <MoreVertical className="h-3.5 w-3.5" strokeWidth={1.75} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" sideOffset={6} className="w-56">
          <DropdownMenuItem
            onClick={handleOpenInFinder}
            disabled={!workspace}
            className="gap-2"
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.75} />
            Open in Finder
          </DropdownMenuItem>
          <EditorMenuItems onSelect={handleOpenInEditor} disabled={!workspace} />
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => onBaseBranchChange(null)}
            disabled={!baseBranch}
            className="gap-2"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.75} />
            Reset base branch
          </DropdownMenuItem>
          <DropdownMenuItem onClick={resetLayout} className="gap-2">
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
            Reset layout
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onToggleHistory}
            className="gap-2"
          >
            <CommitIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {historyOpen ? "Close history" : "Show history"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Editor sub-menu — detects available editors via the existing electron IPC.
 * Falls back to nothing if no editors are found (mirrors EditorPicker).
 */
function EditorMenuItems({
  onSelect,
  disabled,
}: {
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const [editors, setEditors] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.detectEditors) return;
    window.electronAPI
      .detectEditors()
      .then((list) => setEditors(list.map(({ id, name }) => ({ id, name }))))
      .catch(() => {});
  }, []);

  if (editors.length === 0) return null;
  return (
    <>
      {editors.map((e) => (
        <DropdownMenuItem
          key={e.id}
          disabled={disabled}
          onClick={() => onSelect(e.id)}
          className="gap-2"
        >
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
          Open in {e.name}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/**
 * Extract the first https://github.com/.../pull/123 URL from text. The
 * sub-agent is told to reply with just the URL, but Claude sometimes wraps
 * it in markdown or prose — this is a small belt-and-braces parser.
 */
function extractPrUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)>\]]+\/pull\/\d+/i);
  return m ? m[0] : null;
}
