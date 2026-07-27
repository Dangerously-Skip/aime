/**
 * Per-tool permission policy for remote MCP servers (P3.6b).
 *
 * Adding a server is one click. Without this, so is granting it the right to
 * delete, send and publish on your behalf: interactive surfaces run with
 * `bypassPermissions` and an approval policy of 'never' (the human is watching
 * the stream), so a freshly added server's destructive tools execute with no
 * prompt. Unattended runs were already covered — they infer the 'consequential'
 * policy, and C3's classifier fails closed on unknown names — but an interactive
 * session had nothing between "connected" and "ran".
 *
 * The SDK takes `tools: [{name, permission_policy}]` per server, so the C3
 * classifier can be pushed down to the SDK rather than only intercepting in
 * canUseTool. Reads and in-app actions are allowed outright; anything with
 * outside-world side effects, or that we cannot classify, is `always_ask`.
 *
 * TWO HONEST LIMITS:
 *
 *  1. Only http and sse server configs accept `tools` — `McpStdioServerConfig`
 *     has no such field. So the 7 stdio connectors (google-workspace, buildkite,
 *     aws, sumologic, zoom, …) cannot be governed this way and remain covered
 *     only by canUseTool. This is an SDK constraint, not a choice.
 *
 *  2. The policy needs tool NAMES, which are only known once a session has
 *     connected to the server. So the first session after adding a server gets
 *     no SDK-level policy; names observed then are persisted and govern every
 *     later session. Closing that fully needs a `tools/list` call at connect
 *     time, which is worth doing and is not done here.
 *
 * The pure part is the classification; persistence is separated so it is testable
 * without a filesystem.
 */
import { classifyToolCall, type ToolClass } from '../runs/approval';

export interface McpServerToolPolicy {
  name: string;
  permission_policy: 'always_allow' | 'always_ask' | 'always_deny';
}

/** Server keys → the tool names that server was observed to expose. */
export type ObservedTools = Record<string, string[]>;

export interface BuildPolicyOptions {
  /**
   * Names the user has explicitly approved for this server. They become
   * always_allow even when the classifier would gate them, so approving a tool
   * once does not mean approving it forever after.
   */
  approved?: Iterable<string>;
  /** Names the user has explicitly blocked — always_deny, outranking everything. */
  denied?: Iterable<string>;
}

/**
 * `mcp__<server>__<tool>` → `<tool>`. The SDK's per-server policy names tools
 * without the prefix, since the policy is already scoped to one server.
 */
export function bareToolName(fullName: string): string {
  const match = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(fullName);
  return match ? match[1] : fullName;
}

/** Map a classification onto an SDK policy. */
export function policyForClass(cls: ToolClass): McpServerToolPolicy['permission_policy'] {
  // 'unknown' asks rather than allows: a gate that guesses "probably fine" is
  // not a gate. Same rule C3 applies to unattended runs.
  return cls === 'read' || cls === 'app' ? 'always_allow' : 'always_ask';
}

/**
 * Build the policy list for one server's tools.
 *
 * Names may be passed prefixed or bare; the output is always bare, deduplicated
 * and stably ordered so the resulting config does not churn between requests.
 */
export function buildToolPolicies(
  toolNames: Iterable<string>,
  opts: BuildPolicyOptions = {},
): McpServerToolPolicy[] {
  const approved = new Set([...(opts.approved ?? [])].map(bareToolName));
  const denied = new Set([...(opts.denied ?? [])].map(bareToolName));

  const byName = new Map<string, McpServerToolPolicy['permission_policy']>();
  for (const raw of toolNames) {
    if (typeof raw !== 'string' || raw === '') continue;
    const name = bareToolName(raw);
    if (byName.has(name)) continue;
    if (denied.has(name)) {
      byName.set(name, 'always_deny');
      continue;
    }
    if (approved.has(name)) {
      byName.set(name, 'always_allow');
      continue;
    }
    // Classify on the FULL name — the classifier's verb heuristics work on the
    // bare name, and baseToolName strips any prefix itself.
    byName.set(name, policyForClass(classifyToolCall(raw)));
  }

  return [...byName.entries()]
    .map(([name, permission_policy]) => ({ name, permission_policy }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Server configs that can carry a policy. Stdio cannot — see the file header. */
function acceptsToolPolicy(entry: Record<string, unknown>): boolean {
  const type = entry.type ?? entry.transport;
  return type === 'http' || type === 'sse' || type === 'streamable-http';
}

export interface ApplyResult {
  servers: Record<string, unknown>;
  /** Servers that got a policy, and how many tools it gated. */
  applied: Array<{ server: string; asked: number; allowed: number; denied: number }>;
  /** Servers we have names for but whose transport cannot carry a policy. */
  unsupported: string[];
}

/**
 * Attach per-tool policies to every server we have observed tool names for.
 *
 * Servers with no observed names are left untouched rather than given an empty
 * policy: an empty `tools` array could be read as "no tools permitted" and would
 * break a server on its first use.
 */
export function applyToolPolicies(
  servers: Record<string, unknown>,
  observed: ObservedTools,
  optsFor: (serverKey: string) => BuildPolicyOptions = () => ({}),
): ApplyResult {
  const out: Record<string, unknown> = {};
  const applied: ApplyResult['applied'] = [];
  const unsupported: string[] = [];

  for (const [key, value] of Object.entries(servers)) {
    const entry = value as Record<string, unknown>;
    const names = observed[key];

    if (!names || names.length === 0) {
      out[key] = value;
      continue;
    }
    if (!acceptsToolPolicy(entry)) {
      unsupported.push(key);
      out[key] = value;
      continue;
    }

    const policies = buildToolPolicies(names, optsFor(key));
    out[key] = { ...entry, tools: policies };
    applied.push({
      server: key,
      asked: policies.filter((p) => p.permission_policy === 'always_ask').length,
      allowed: policies.filter((p) => p.permission_policy === 'always_allow').length,
      denied: policies.filter((p) => p.permission_policy === 'always_deny').length,
    });
  }

  return { servers: out, applied, unsupported: unsupported.sort() };
}

/**
 * Group observed full tool names by their MCP server prefix, so a session's flat
 * tool list can be recorded per server.
 */
export function groupToolsByServer(toolNames: string[]): ObservedTools {
  const grouped: ObservedTools = {};
  for (const name of toolNames) {
    const match = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(name);
    if (!match) continue;
    (grouped[match[1]] ??= []).push(name);
  }
  return grouped;
}
