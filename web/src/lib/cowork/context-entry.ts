/**
 * Cowork sidebar entries: what kind of thing a row is, and how to show it.
 *
 * Context/artifact rows are stored as plain strings (persisted per conversation
 * in cowork-store), and non-file rows carry their kind as a text prefix. That
 * convention already existed for shell commands (`bash: git status`) but search
 * queries and spawned agents used EMOJI prefixes instead — `🔍 query`, `⚡ agent`
 * — which then had to be sniffed back out with `path.startsWith("🔍 ")` in two
 * separate places to decide whether a row was clickable. Three scattered glyph
 * literals doing the work of a type tag.
 *
 * So the kinds are named here, matched in one place, and rendered as outline
 * icons. Entries keep their string shape, so no store migration is needed.
 *
 * LEGACY: the emoji prefixes are still recognised on read, because conversations
 * persisted by earlier builds contain them. Without that, an old `🔍 foo` row
 * would stop matching and become a clickable "file" that does not exist.
 */

export type ContextEntryKind = 'file' | 'search' | 'agent' | 'command' | 'url';

/** Prefixes written by new code. Space-terminated, like the original `bash: `. */
export const SEARCH_PREFIX = 'search: ';
export const AGENT_PREFIX = 'agent: ';
export const COMMAND_PREFIX = 'bash: ';

/** Prefixes only ever read — written by builds before this change. */
const LEGACY_SEARCH_PREFIX = '🔍 ';
const LEGACY_AGENT_PREFIX = '⚡ ';

interface Match {
  kind: ContextEntryKind;
  prefix: string;
}

const PREFIXES: Match[] = [
  { kind: 'search', prefix: SEARCH_PREFIX },
  { kind: 'search', prefix: LEGACY_SEARCH_PREFIX },
  { kind: 'agent', prefix: AGENT_PREFIX },
  { kind: 'agent', prefix: LEGACY_AGENT_PREFIX },
  { kind: 'command', prefix: COMMAND_PREFIX },
];

/** What kind of row this is, and the text to show once the tag is stripped. */
export function classifyContextEntry(entry: string): { kind: ContextEntryKind; label: string } {
  for (const { kind, prefix } of PREFIXES) {
    if (entry.startsWith(prefix)) {
      return { kind, label: entry.slice(prefix.length) };
    }
  }
  if (/^https?:\/\//.test(entry)) return { kind: 'url', label: entry };
  return { kind: 'file', label: entry };
}

/**
 * True when the row points at something openable — a real file or a URL.
 * Search queries, shell commands and agent labels are descriptions of work, not
 * locations, so clicking them must do nothing.
 */
export function isOpenableEntry(entry: string): boolean {
  const { kind } = classifyContextEntry(entry);
  return kind === 'file' || kind === 'url';
}

/** True when the row is a search query, which SearchResultsCard already shows. */
export function isSearchEntry(entry: string): boolean {
  return classifyContextEntry(entry).kind === 'search';
}

/** The label for a row: basename for files, the tag-stripped text otherwise. */
export function contextEntryDisplayName(entry: string): string {
  const { kind, label } = classifyContextEntry(entry);
  if (kind !== 'file') return label;
  const parts = label.split('/');
  return parts[parts.length - 1] || label;
}
