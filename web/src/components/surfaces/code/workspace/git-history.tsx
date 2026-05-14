"use client";

import { useEffect, useMemo, useState } from "react";
import { useGitLog } from "@/hooks/use-git-log";
import { getGitDiff } from "@/lib/code-workspace/ipc";
import type { GitCommit } from "@/lib/code-workspace/types";
import { BlameView } from "./blame-view";
import { ChevronRight, GitCommit as CommitIcon, RefreshCw, X } from "lucide-react";

interface GitHistoryProps {
  workspace: string | null;
  onClose?: () => void;
}

/**
 * Commit history view. Shows the recent commit list; selecting a commit
 * expands its body and changed files. Selecting a file opens the blame in
 * the right pane.
 */
export function GitHistory({ workspace, onClose }: GitHistoryProps) {
  const { commits, loading, error, refresh } = useGitLog(workspace);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  // When the user picks a commit, load the list of files it touched via
  // `git diff <hash>^..<hash> --name-only`. We piggy-back on Agent B's
  // gitDiff IPC by asking for the full diff and parsing filenames out of
  // the `diff --git` headers — keeps us inside the IPC surface Wave 1 declared.
  useEffect(() => {
    if (!workspace || !selectedHash) {
      setChangedFiles([]);
      setSelectedFile(null);
      return;
    }
    let cancelled = false;
    setFilesLoading(true);
    getGitDiff(workspace, { fromRef: `${selectedHash}^`, toRef: selectedHash })
      .then((diff) => {
        if (cancelled) return;
        const files: string[] = [];
        for (const line of diff.split("\n")) {
          const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
          if (m) files.push(m[2]);
        }
        setChangedFiles(files);
        setSelectedFile(files[0] ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setChangedFiles([]);
        setSelectedFile(null);
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, selectedHash]);

  const selectedCommit = useMemo(
    () => commits.find((c) => c.hash === selectedHash) ?? null,
    [commits, selectedHash],
  );

  if (!workspace) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground p-4">
        Open a folder to see its commit history.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center gap-2 px-3 h-8 border-b border-border/40 bg-muted/30 shrink-0">
        <CommitIcon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
        <span className="text-xs font-medium text-foreground/80">History</span>
        <span className="text-xs text-muted-foreground">
          {loading ? "loading…" : `${commits.length} commits`}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => refresh()}
          className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          title="Refresh history"
        >
          <RefreshCw className="h-3 w-3" strokeWidth={1.75} />
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="Close history"
          >
            <X className="h-3 w-3" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {error ? (
        <div className="p-3 text-xs text-destructive">{error}</div>
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* Commit list */}
          <div className="w-2/5 min-w-[260px] border-r border-border/40 overflow-auto">
            {commits.length === 0 && !loading ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                No commits yet.
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {commits.map((c) => (
                  <CommitRow
                    key={c.hash}
                    commit={c}
                    active={c.hash === selectedHash}
                    onClick={() =>
                      setSelectedHash((prev) => (prev === c.hash ? null : c.hash))
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Detail panel */}
          <div className="flex-1 min-w-0 flex flex-col">
            {selectedCommit ? (
              <>
                <div className="p-3 border-b border-border/40 bg-muted/10 shrink-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-primary">
                      {selectedCommit.shortHash}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {selectedCommit.author} · {formatDate(selectedCommit.date)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {selectedCommit.subject}
                  </div>
                  {selectedCommit.body && (
                    <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground font-sans">
                      {selectedCommit.body}
                    </pre>
                  )}
                </div>

                <div className="flex flex-1 min-h-0">
                  <div className="w-1/3 min-w-[180px] border-r border-border/40 overflow-auto">
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
                      {filesLoading ? "loading files…" : `${changedFiles.length} files`}
                    </div>
                    {changedFiles.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setSelectedFile(f)}
                        className={
                          "w-full text-left text-xs font-mono px-3 py-1 truncate transition-colors " +
                          (selectedFile === f
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted/40 text-foreground")
                        }
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <BlameView
                      workspace={workspace}
                      filePath={selectedFile}
                      onSelectHash={(short) => {
                        const match = commits.find((c) =>
                          c.hash.startsWith(short),
                        );
                        if (match) setSelectedHash(match.hash);
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                Select a commit to see its details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CommitRow({
  commit,
  active,
  onClick,
}: {
  commit: GitCommit;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={
          "w-full text-left px-3 py-2 flex items-start gap-2 transition-colors " +
          (active ? "bg-primary/10" : "hover:bg-muted/40")
        }
      >
        <ChevronRight
          className={
            "h-3 w-3 mt-1 shrink-0 transition-transform text-muted-foreground " +
            (active ? "rotate-90" : "")
          }
          strokeWidth={1.75}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-primary shrink-0">
              {commit.shortHash}
            </span>
            <span className="text-xs text-foreground truncate">
              {commit.subject}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {commit.author} · {formatDate(commit.date)}
          </div>
        </div>
      </button>
    </li>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
