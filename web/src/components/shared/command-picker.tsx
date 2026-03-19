'use client';

import { useEffect, useRef } from 'react';
import { Zap, File } from 'lucide-react';

export interface CommandSuggestion {
  type: 'slash' | 'at';
  /** Inserted value: command name for slash, absolute file path for at */
  value: string;
  /** Primary label shown in bold */
  label: string;
  /** Secondary text (args hint, file ext, etc.) */
  description?: string;
  /** Right-aligned meta text (relative path, etc.) */
  meta?: string;
}

interface CommandPickerProps {
  suggestions: CommandSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: CommandSuggestion) => void;
  onSelectedIndexChange: (index: number) => void;
}

export function CommandPicker({
  suggestions,
  selectedIndex,
  onSelect,
  onSelectedIndexChange,
}: CommandPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep selected item scrolled into view
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const selected = container.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (suggestions.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="mb-1 rounded-lg border border-border bg-popover shadow-md overflow-hidden max-h-[240px] overflow-y-auto"
    >
      {suggestions.map((s, i) => (
        <button
          key={`${s.type}-${s.value}-${i}`}
          type="button"
          onMouseEnter={() => onSelectedIndexChange(i)}
          onClick={() => onSelect(s)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
            i === selectedIndex
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50'
          }`}
        >
          {s.type === 'slash' ? (
            <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="font-mono text-primary">{s.label}</span>
          {s.description && (
            <span className="text-muted-foreground text-xs">{s.description}</span>
          )}
          {s.meta && (
            <span className="ml-auto text-muted-foreground text-xs truncate max-w-[200px]">
              {s.meta}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
