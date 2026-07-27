/**
 * Which MCP servers actually get mounted (P3.5).
 *
 * The Connectors screen has had an enable/disable toggle all along and
 * `getEnabledConnectors()` was never called by anything: every provisioned
 * connector was mounted on every request regardless. So the switch did nothing,
 * and a user who noticed the agent was drowning in tools had no way to trim it.
 *
 * That matters beyond the dead switch. Each connected service contributes tens of
 * tool definitions — the GitHub MCP alone is around a hundred — and model
 * quality degrades from tool-choice pressure well before the context window is
 * the binding constraint. Connecting more must never silently make AIME worse.
 *
 * A DENY list, not an allow list, is deliberate: if the client sends nothing (an
 * older renderer, a scheduled server-side run with no UI state), every server
 * stays mounted. Defaulting to "mount nothing" would silently strip an
 * unattended run of its tools, which is a far worse failure than mounting one
 * server too many.
 *
 * Pure: no fs, no network.
 */

/** Recover the connector id a provisioned server key belongs to. */
export function connectorIdForServerKey(serverKey: string): string | null {
  const match = /^(?:aime|nib)-(?:connector|mcp)-(.+)$/.exec(serverKey);
  return match ? match[1] : null;
}

export interface FilterResult<T> {
  servers: Record<string, T>;
  /** Server keys that were left out, for logging and for telling the user. */
  removed: string[];
}

/**
 * Drop the servers whose connector the user has switched off.
 *
 * Servers that aren't ours (a hand-written entry in `.mcp.json`, the web-search
 * MCP) are never filtered — the toggle only governs connectors the app manages.
 */
export function filterMcpServers<T>(
  servers: Record<string, T> | undefined,
  disabledConnectorIds: Iterable<string> | undefined,
): FilterResult<T> {
  const all = servers ?? {};
  const disabled = new Set(disabledConnectorIds ?? []);
  if (disabled.size === 0) return { servers: all, removed: [] };

  const kept: Record<string, T> = {};
  const removed: string[] = [];
  for (const [key, value] of Object.entries(all)) {
    const id = connectorIdForServerKey(key);
    if (id && disabled.has(id)) {
      removed.push(key);
      continue;
    }
    kept[key] = value;
  }
  return { servers: kept, removed: removed.sort() };
}

// ── Tool budget ───────────────────────────────────────────────────────────

/**
 * Beyond roughly this many tools, selection accuracy falls off noticeably. It is
 * a soft signal used to warn, never to silently truncate — dropping tools behind
 * the user's back would make failures inexplicable.
 */
export const TOOL_BUDGET = 120;

export interface ToolBudgetReport {
  total: number;
  /** Tool count per MCP server, descending, then by name. */
  perServer: Array<{ server: string; count: number }>;
  builtinCount: number;
  overBudget: boolean;
  /** Present when over budget — what to switch off first. */
  advice?: string;
}

/**
 * Summarise a live tool list (the names the SDK reports at session init) into
 * something the UI can show. Tool names arrive as `mcp__<server>__<tool>`;
 * anything else is a built-in.
 */
export function summarizeToolBudget(toolNames: string[]): ToolBudgetReport {
  const perServerMap = new Map<string, number>();
  let builtinCount = 0;

  for (const name of toolNames) {
    const match = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(name);
    if (match) {
      perServerMap.set(match[1], (perServerMap.get(match[1]) ?? 0) + 1);
    } else {
      builtinCount++;
    }
  }

  const perServer = [...perServerMap.entries()]
    .map(([server, count]) => ({ server, count }))
    .sort((a, b) => b.count - a.count || a.server.localeCompare(b.server));

  const total = toolNames.length;
  const overBudget = total > TOOL_BUDGET;

  return {
    total,
    perServer,
    builtinCount,
    overBudget,
    ...(overBudget && perServer.length > 0
      ? {
          advice:
            `${total} tools are mounted (over ${TOOL_BUDGET}). ` +
            `The largest is ${perServer[0].server} with ${perServer[0].count} — ` +
            `switching off services you are not using will improve tool selection.`,
        }
      : {}),
  };
}
