/**
 * Per-tool watchdog deadlines.
 *
 * ONE deadline for every tool punished exactly the work the Code surface exists
 * to do: a Bash build or test suite routinely runs past three minutes, and
 * nothing streams between `tool_use` and `tool_result`, so wall-clock time is
 * the only signal available — and it cannot distinguish a productive build from
 * a hung fetch. Both look identical to a timer; they are not equally safe to
 * kill.
 *
 * Two classes instead:
 *
 *   network — WebFetch/WebSearch and every MCP tool. Their work happens behind
 *             an HTTP boundary with no progress signal, so elapsed silence IS
 *             the evidence of a hang, and the budget stays tight. (The built-in
 *             WebFetch is denied in favour of `mcp__aime__FetchUrl`, which has
 *             its own ~120s timeout — but connector MCP tools have none.)
 *   local   — Bash, Skill, and everything that runs in-process or spawns a
 *             local process. These report progress by finishing, so the budget
 *             derives from the surface's own silence budget minus headroom,
 *             which keeps "a hung tool is NAMED by the watchdog before the
 *             generic timeout fires" true on every surface without maintaining
 *             the numbers in two places.
 *
 * Pure and dependency-free, so both the provider and its tests can use it.
 */

/** Network-bound tools, by exact name or prefix. */
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch']);
const NETWORK_TOOL_PREFIX = 'mcp__';

/**
 * The network deadline. Above the observed slow-but-legitimate fetch (120.5s,
 * correct and complete) and below every surface's silence budget.
 */
export const NETWORK_TOOL_DEADLINE_MS = 180_000;

/**
 * Kept back from the surface's silence budget so a hung local tool is named as
 * the cause before the generic "stopped producing output" message can fire.
 */
export const TOOL_DEADLINE_HEADROOM_MS = 30_000;

export function isNetworkTool(name: string): boolean {
  return NETWORK_TOOLS.has(name) || name.startsWith(NETWORK_TOOL_PREFIX);
}

/**
 * The watchdog deadline for one tool on one surface.
 *
 * @param toolName          e.g. 'Bash', 'WebFetch', 'mcp__aime__FetchUrl'
 * @param queryTimeoutSecs  the surface's silence budget (`queryTimeoutSecs`);
 *                          0/undefined when the surface declares none
 */
export function toolDeadlineMs(toolName: string, queryTimeoutSecs?: number | null): number {
  if (!isNetworkTool(toolName)) {
    const budgetMs = (queryTimeoutSecs ?? 0) * 1000;
    // The guard keeps this above NETWORK_TOOL_DEADLINE_MS: at the boundary
    // (budget = network + headroom) the subtraction lands exactly on it.
    if (budgetMs > NETWORK_TOOL_DEADLINE_MS + TOOL_DEADLINE_HEADROOM_MS) {
      return budgetMs - TOOL_DEADLINE_HEADROOM_MS;
    }
  }
  return NETWORK_TOOL_DEADLINE_MS;
}
