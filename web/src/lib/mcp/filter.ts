/**
 * How many tools are mounted, and which service is responsible (P3.5).
 *
 * Why anyone cares: each connected service contributes tens of tool definitions —
 * the GitHub MCP alone is around a hundred — and model quality degrades from
 * tool-choice pressure well before the context window is the binding constraint.
 * Connecting more must never silently make AIME worse, so the user needs to be
 * told which service to switch off.
 *
 * This module used to ALSO hold `filterMcpServers`, a per-request deny list of
 * connector ids that the chat route applied to the loaded server map. It is gone:
 * switching a connector off calls `/api/connectors/provision?intent=disable`, which
 * moves the entry into `config.disabledMcpServers`, and `loadProvisionedMcpServers`
 * reads only `config.mcpServers`. Both mechanisms gave the same answer, but the
 * deny list ran AFTER the load, so a switched-off connector still cost three
 * AES-256-GCM credential decrypts, an outbound OAuth token-refresh POST and a
 * config rewrite on every message — measured in disabled-connector-cost.test.ts.
 * Keeping two representations of one fact is also how they come to disagree.
 *
 * Pure: no fs, no network.
 */

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
