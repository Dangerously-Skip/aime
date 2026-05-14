"use client";

import { useEffect, useState } from "react";
import { getGitBlame } from "@/lib/code-workspace/ipc";
import type { BlameLine } from "@/lib/code-workspace/types";

interface BlameViewProps {
  workspace: string | null;
  filePath: string | null;
  /** Called with a short hash when the user clicks one in the gutter. */
  onSelectHash?: (hash: string) => void;
}

/**
 * Renders the blame for a single file. Each row is `<hash> <author> <date>`
 * followed by the source line. Cap at 5000 lines is enforced in main-web.js.
 */
export function BlameView({ workspace, filePath, onSelectHash }: BlameViewProps) {
  const [lines, setLines] = useState<BlameLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace || !filePath) {
      setLines([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getGitBlame(workspace, filePath)
      .then((next) => {
        if (cancelled) return;
        setLines(next);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, filePath]);

  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Pick a file from a commit to see its blame.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Loading blame for {filePath}…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-destructive">
        Couldn&apos;t load blame: {error}
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No blame data for this file.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto font-mono text-[11px] leading-[1.45] bg-card">
      <table className="min-w-full">
        <tbody>
          {lines.map((line, idx) => (
            <tr key={idx} className="hover:bg-muted/40">
              <td className="pr-2 pl-2 align-top whitespace-nowrap select-none">
                <button
                  type="button"
                  className="text-primary/70 hover:text-primary hover:underline transition-colors"
                  onClick={() => onSelectHash?.(line.hash)}
                  title={`View commit ${line.hash}`}
                >
                  {line.hash.slice(0, 7)}
                </button>
              </td>
              <td className="pr-2 align-top whitespace-nowrap text-muted-foreground select-none">
                {(line.author || "unknown").slice(0, 8).padEnd(8, " ")}
              </td>
              <td className="pr-3 align-top whitespace-nowrap text-muted-foreground select-none">
                {line.date}
              </td>
              <td className="pr-2 align-top whitespace-nowrap text-muted-foreground/60 select-none text-right">
                {line.lineNumber}
              </td>
              <td className="align-top whitespace-pre">{line.content}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
