'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { walkFs } from '@/lib/code-workspace/ipc';
import { subscribe as subscribeToFs, debounce } from '@/lib/code-workspace/file-watcher';
import type { FsNode } from '@/lib/code-workspace/types';
import { matchesFilter, isContentSearch } from '@/lib/code-workspace/fs-tree';

/**
 * Production hook for the IDE file tree.
 *
 * - Walks the workspace root lazily; directories are expanded on demand.
 * - Subscribes to the main-process file watcher and refreshes affected
 *   nodes (full tree refresh for now — Phase 1 keeps it simple).
 * - Tracks expand/collapse state per node path and a filter input.
 * - `?` prefix in the filter is reserved for content search; the hook
 *   surfaces a `contentSearchPlaceholder` flag so the UI can show a
 *   "coming soon" hint without forking the input.
 */
export interface FlatNode {
  node: FsNode;
  depth: number;
  expanded: boolean;
  loading: boolean;
}

export interface UseFileTreeResult {
  /** Root nodes (children of the workspace folder). */
  roots: FsNode[];
  /** Flat list for virtualised rendering, honouring expand state + filter. */
  flatNodes: FlatNode[];
  loading: boolean;
  error: string | null;
  filter: string;
  setFilter: (next: string) => void;
  showHidden: boolean;
  setShowHidden: (next: boolean) => void;
  /** True when the user typed `?…` — content search is not implemented yet. */
  contentSearchPlaceholder: boolean;
  /** Set of node paths currently expanded. */
  expanded: ReadonlySet<string>;
  toggleExpand: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useFileTree(workspace: string | null): UseFileTreeResult {
  const [roots, setRoots] = useState<FsNode[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FsNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  const contentSearchPlaceholder = isContentSearch(filter);

  // Stable workspace reference to avoid stale closures.
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const refresh = useCallback(async () => {
    const ws = workspaceRef.current;
    if (!ws) {
      setRoots([]);
      setChildrenByPath({});
      setExpanded(new Set());
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await walkFs(ws, { depth: 1, respectGitignore: !showHidden });
      setRoots(next);
      // Refresh children for any expanded directory (best-effort).
      const pathsToRefresh = Array.from(expanded);
      if (pathsToRefresh.length > 0) {
        const results = await Promise.all(
          pathsToRefresh.map(async (p) => {
            try {
              const kids = await walkFs(p, {
                depth: 1,
                respectGitignore: !showHidden,
              } as { depth?: number; respectGitignore?: boolean });
              return [p, kids] as const;
            } catch {
              return [p, [] as FsNode[]] as const;
            }
          }),
        );
        setChildrenByPath((prev) => {
          const next = { ...prev };
          for (const [p, kids] of results) next[p] = kids;
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [expanded, showHidden]);

  const toggleExpand = useCallback(
    async (path: string) => {
      let willExpand = false;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          willExpand = true;
        }
        return next;
      });
      if (!willExpand) return;
      if (childrenByPath[path]) return; // cached
      setLoadingPaths((prev) => new Set(prev).add(path));
      try {
        const kids = await walkFs(path, {
          depth: 1,
          respectGitignore: !showHidden,
        });
        // eslint-disable-next-line no-console
        console.log("[file-tree] expand", path, "→", kids.length, "children");
        setChildrenByPath((prev) => ({ ...prev, [path]: kids }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [childrenByPath, showHidden],
  );

  // Initial load + reload when showHidden flips.
  useEffect(() => {
    refresh();
  }, [workspace, showHidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch the workspace for fs changes; debounce-refresh.
  useEffect(() => {
    if (!workspace) return;
    let off: (() => void) | null = null;
    let mounted = true;
    const debouncedRefresh = debounce(() => {
      if (!mounted) return;
      refresh();
    }, 250);
    (async () => {
      off = await subscribeToFs(workspace, () => debouncedRefresh());
    })();
    return () => {
      mounted = false;
      if (off) off();
    };
  }, [workspace, refresh]);

  // Warn once when the user opens content search.
  useEffect(() => {
    if (contentSearchPlaceholder) {
      // eslint-disable-next-line no-console
      console.warn(
        '[file-tree] content search (?prefix) is not implemented in Phase 1 — falling back to filename filter on the remaining text',
      );
    }
  }, [contentSearchPlaceholder]);

  // Flatten the tree honouring expand state + filename filter.
  const flatNodes = useMemo<FlatNode[]>(() => {
    const out: FlatNode[] = [];
    // Filename-substring filter. If content-search prefix is present, drop
    // the `?` and treat the rest as a filename filter for now.
    const effectiveFilter = contentSearchPlaceholder ? filter.trimStart().slice(1) : filter;

    function nodeMatches(node: FsNode): boolean {
      if (!effectiveFilter) return true;
      if (matchesFilter(node, effectiveFilter)) return true;
      if (node.type === 'dir') {
        const kids = childrenByPath[node.path] ?? [];
        return kids.some((k) => nodeMatches(k));
      }
      return false;
    }

    function walk(nodes: FsNode[], depth: number) {
      for (const node of nodes) {
        if (effectiveFilter && !nodeMatches(node)) continue;
        const isExp = expanded.has(node.path);
        out.push({
          node,
          depth,
          expanded: isExp,
          loading: loadingPaths.has(node.path),
        });
        if (node.type === 'dir' && isExp) {
          const kids = childrenByPath[node.path];
          // Auto-expand when filtering so matches deeper in the tree are
          // visible without manual interaction.
          if (kids) walk(kids, depth + 1);
        } else if (node.type === 'dir' && effectiveFilter) {
          const kids = childrenByPath[node.path];
          if (kids) walk(kids, depth + 1);
        }
      }
    }
    walk(roots, 0);
    return out;
  }, [roots, childrenByPath, expanded, loadingPaths, filter, contentSearchPlaceholder]);

  return {
    roots,
    flatNodes,
    loading,
    error,
    filter,
    setFilter,
    showHidden,
    setShowHidden,
    contentSearchPlaceholder,
    expanded,
    toggleExpand,
    refresh,
  };
}
