"use client";

import { useEffect, useState } from "react";
import { GitBranch, Folder, Activity } from "lucide-react";
import { useGitStatus } from "@/hooks/use-git-status";
import { onFsChange } from "@/lib/code-workspace/ipc";

/**
 * Bottom status strip — branch, ahead/behind, line stats, cwd, last fs event.
 *
 * Designed to be quiet: muted text, single horizontal line, no chrome. Sits
 * outside the dockview area so the panels never have to make room.
 */

interface StatusBarProps {
  workspace: string | null;
}

export function StatusBar({ workspace }: StatusBarProps) {
  const { status } = useGitStatus(workspace);
  const [lastEvent, setLastEvent] = useState<{ kind: string; path: string; at: number } | null>(null);

  useEffect(() => {
    if (!workspace) return;
    return onFsChange((evt) => {
      setLastEvent({ kind: evt.kind, path: evt.path, at: Date.now() });
    });
  }, [workspace]);

  // Tick once per 10s to keep "Xs ago" fresh without re-renders on every frame.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  if (!workspace) return null;

  const cwdShort = workspace.split("/").slice(-2).join("/");
  const additions = (status?.files ?? []).reduce((a, f) => a + (f.additions ?? 0), 0);
  const deletions = (status?.files ?? []).reduce((a, f) => a + (f.deletions ?? 0), 0);
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const branch = status?.branch ?? "—";
  const lastEventLabel = lastEvent
    ? `${lastEvent.kind} ${lastEvent.path.split("/").pop() ?? lastEvent.path} · ${timeAgo(lastEvent.at)}`
    : null;

  return (
    <div className="dv-status-bar shrink-0 flex items-center gap-3 px-3 h-6 text-[10px] text-muted-foreground border-t border-border/40 bg-card/40">
      <span className="inline-flex items-center gap-1" title={workspace}>
        <Folder className="h-3 w-3" strokeWidth={1.75} />
        <span className="truncate max-w-[18ch]">{cwdShort}</span>
      </span>
      <span className="inline-flex items-center gap-1" title={`Branch: ${branch}`}>
        <GitBranch className="h-3 w-3" strokeWidth={1.75} />
        <span className="font-mono">{branch}</span>
      </span>
      {(ahead > 0 || behind > 0) && (
        <span className="inline-flex items-center gap-1 font-mono" title={`${ahead} ahead, ${behind} behind`}>
          {ahead > 0 && <span>↑{ahead}</span>}
          {behind > 0 && <span>↓{behind}</span>}
        </span>
      )}
      {(additions > 0 || deletions > 0) && (
        <span className="inline-flex items-center gap-2 font-mono">
          {additions > 0 && <span className="text-emerald-500/80">+{additions}</span>}
          {deletions > 0 && <span className="text-destructive/80">−{deletions}</span>}
        </span>
      )}
      <div className="flex-1" />
      {lastEventLabel && (
        <span className="inline-flex items-center gap-1 truncate max-w-[40ch]" title={lastEvent?.path}>
          <Activity className="h-3 w-3" strokeWidth={1.75} />
          <span className="truncate">{lastEventLabel}</span>
        </span>
      )}
    </div>
  );
}

function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 5) return "now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}
