/**
 * Renderer-side filesystem helpers for the IDE workspace.
 *
 * The actual main-process walker lives in `web/lib/code-workspace-fs.js`
 * (CJS, required by main-web.js). This module hosts shared utilities the
 * renderer uses — extension parsing, name predicates, gitignore-aware
 * filter helpers.
 */

import type { FsNode } from "./types";

/** Maximum file size we'll auto-load into the viewer (in bytes). 2 MB. */
export const MAX_AUTO_LOAD_BYTES = 2 * 1024 * 1024;

/** Hard-hidden directory names — never shown regardless of gitignore. */
export const HARD_HIDDEN_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  ".DS_Store",
]);

/** Lowercase extension including the leading dot. Returns '' for no extension. */
export function getExt(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx).toLowerCase();
}

/** True if a node name should be hidden by default (dotfile etc). */
export function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

/** Case-insensitive substring match on the node name. Empty filter = match all. */
export function matchesFilter(node: FsNode, filter: string): boolean {
  if (!filter) return true;
  return node.name.toLowerCase().includes(filter.toLowerCase());
}

/** Recursively filters a tree, keeping any directory that contains a match. */
export function filterTree(nodes: FsNode[], filter: string): FsNode[] {
  if (!filter) return nodes;
  const out: FsNode[] = [];
  for (const n of nodes) {
    if (n.type === "file") {
      if (matchesFilter(n, filter)) out.push(n);
      continue;
    }
    const kids = n.children ? filterTree(n.children, filter) : [];
    if (kids.length > 0 || matchesFilter(n, filter)) {
      out.push({ ...n, children: kids });
    }
  }
  return out;
}

/** Sort nodes: dirs first, then alphabetical. Matches the main-side ordering. */
export function sortNodes(nodes: FsNode[]): FsNode[] {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** True if the input begins with the content-search prefix (`?`). */
export function isContentSearch(input: string): boolean {
  return input.trimStart().startsWith("?");
}

/** Strip the `?` prefix from a content-search query. */
export function stripContentSearchPrefix(input: string): string {
  return input.trimStart().slice(1);
}
