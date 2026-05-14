"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getGitBranches } from "@/lib/code-workspace/ipc";
import { Cloud, GitBranch, HardDrive, Search } from "lucide-react";

interface BranchPickerProps {
  workspace: string | null;
  /** The branch label to render in the trigger. */
  currentBranch: string;
  /** Disable the trigger when no workspace / no branches. */
  disabled?: boolean;
  /** Fires with the selected branch name when the user picks one. */
  onSelect: (branch: string) => void;
  /** Optional className for the trigger. */
  className?: string;
}

/**
 * Popover that lists local and remote branches with a filter. Used in the
 * branch header to switch the diff-base branch and to retarget the picker
 * itself.
 */
export function BranchPicker({
  workspace,
  currentBranch,
  disabled,
  onSelect,
  className,
}: BranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !workspace) return;
    let cancelled = false;
    setLoading(true);
    getGitBranches(workspace)
      .then((next) => {
        if (!cancelled) setBranches(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspace]);

  const { local, remote } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? branches.filter((b) => b.toLowerCase().includes(q))
      : branches;
    return {
      local: filtered.filter((b) => !b.includes("/")),
      remote: filtered.filter((b) => b.includes("/")),
    };
  }, [branches, filter]);

  function pick(branch: string) {
    onSelect(branch);
    setOpen(false);
    setFilter("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            className={
              "inline-flex items-center gap-1 rounded-md px-1.5 h-6 text-xs font-mono hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
              (className ?? "")
            }
            title="Switch branch"
          />
        }
      >
        <GitBranch className="h-3 w-3" strokeWidth={1.75} />
        <span className="truncate max-w-[180px]">{currentBranch}</span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={6} className="w-72 p-1">
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/40">
          <Search className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.75} />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter branches…"
            autoFocus
            className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-72 overflow-auto py-1">
          {loading ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">Loading branches…</div>
          ) : branches.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              No branches found.
            </div>
          ) : (
            <>
              {local.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <HardDrive className="h-3 w-3" strokeWidth={1.75} />
                    Local
                  </div>
                  {local.map((b) => (
                    <BranchRow
                      key={b}
                      name={b}
                      active={b === currentBranch}
                      onClick={() => pick(b)}
                    />
                  ))}
                </>
              )}
              {remote.length > 0 && (
                <>
                  <div className="px-2 py-1 mt-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Cloud className="h-3 w-3" strokeWidth={1.75} />
                    Remote
                  </div>
                  {remote.map((b) => (
                    <BranchRow
                      key={b}
                      name={b}
                      active={b === currentBranch}
                      onClick={() => pick(b)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BranchRow({
  name,
  active,
  onClick,
}: {
  name: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "w-full text-left flex items-center gap-2 px-2 py-1 rounded text-xs font-mono transition-colors " +
        (active
          ? "bg-primary/10 text-primary"
          : "hover:bg-muted/60 text-foreground")
      }
    >
      <GitBranch className="h-3 w-3 shrink-0" strokeWidth={1.75} />
      <span className="truncate flex-1">{name}</span>
      {active && <span className="text-[10px] text-muted-foreground">current</span>}
    </button>
  );
}
