"use client";

import { Search, Eye, EyeOff } from "lucide-react";

interface FileTreeFilterProps {
  value: string;
  onChange: (next: string) => void;
  showHidden: boolean;
  onToggleHidden: () => void;
}

/**
 * Filter bar above the file tree. Filename substring filter + "Show hidden"
 * toggle. A `?` prefix is reserved for content search; the parent decides
 * how to interpret that.
 */
export function FileTreeFilter({
  value,
  onChange,
  showHidden,
  onToggleHidden,
}: FileTreeFilterProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/40 bg-muted/20">
      <div className="relative flex-1 min-w-0">
        <Search
          className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground"
          strokeWidth={1.75}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Filter files… (? for content)"
          className="w-full h-6 pl-6 pr-2 text-xs rounded bg-background border border-border/40 focus:border-border focus:outline-none placeholder:text-muted-foreground/60"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
      <button
        type="button"
        onClick={onToggleHidden}
        className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
        title={showHidden ? "Hide gitignored files" : "Show gitignored files"}
        aria-pressed={showHidden}
      >
        {showHidden ? (
          <Eye className="h-3 w-3" strokeWidth={1.75} />
        ) : (
          <EyeOff className="h-3 w-3" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}
