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
 * WHERE THE GATE ACTUALLY LIVES — read this before touching the file.
 *
 * The SDK takes `tools: [{name, permission_policy}]` per server, and P3.6b
 * pushed the classifier down into it. That alone gates NOTHING on chat or
 * cowork: those surfaces set `permissionMode: 'bypassPermissions'` and the
 * provider sets `allowDangerouslySkipPermissions`, which is precisely the
 * machinery `permission_policy` is serialised into. Grep the SDK's shipped JS
 * for `permission_policy` and it does not read it back; it is CLI argv.
 *
 * So the enforceable gate is `buildToolGate` below, consumed by `canUseTool` in
 * claude-provider.ts — the one hook the SDK calls regardless of permissionMode.
 * `always_ask` there means a real prompt on the real client (reusing the
 * AskUserQuestion rendezvous), and `always_deny` means the call never happens.
 * The SDK-level list is kept because it costs nothing and is the right thing to
 * send if a future SDK honours it under bypassPermissions — but it is advisory,
 * and nothing in this codebase may describe it as protection.
 *
 * The runtime gate also removes both of P3.6b's stated limits, because
 * `canUseTool` is handed the real tool name at call time:
 *
 *  1. stdio servers (google-workspace, buildkite, aws, sumologic, zoom, …) have
 *     no `tools` field in their SDK config, so they got no SDK-level policy.
 *     The runtime gate governs them identically.
 *
 *  2. The SDK-level policy needs names observed in a PREVIOUS session, so the
 *     first session after adding a server was ungoverned. The runtime gate
 *     classifies the name in front of it, so session one is covered.
 *
 * Reads are allowed outright. Everything else — outside-world side effects, and
 * anything we cannot classify — asks. The user's answer can be remembered (see
 * the decision store at the bottom), which is what makes `always_allow` and
 * `always_deny` reachable in production at all.
 *
 * Classification and gate construction are pure; the decision store is the only
 * part that touches a filesystem and is kept at the end of the file.
 */
import { dirname, join } from 'path';
import { classifyToolCall, type ToolClass } from '../runs/approval';
import { MCP_CATALOG } from './catalog';

export interface McpServerToolPolicy {
  name: string;
  permission_policy: 'always_allow' | 'always_ask' | 'always_deny';
}

export type ToolPermissionPolicy = McpServerToolPolicy['permission_policy'];

/** Server keys → the tool names that server was observed to expose. */
export type ObservedTools = Record<string, string[]>;

/**
 * A user's standing decisions, per server. Written when they pick "Always allow"
 * or "Always deny" on an approval prompt — see the decision store below. This is
 * the production source for `BuildPolicyOptions`; before it existed, `optsFor`
 * defaulted to `() => ({})` at the only call site, so `always_deny` could never
 * be emitted and the contract below described a feature nothing could reach.
 */
export interface ToolDecisions {
  [serverKey: string]: { approved?: string[]; denied?: string[] };
}

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

/**
 * `mcp__<server>__<tool>` → both halves, or null when the name is not an MCP
 * tool call at all (a builtin like `Write`). The server half is what scopes a
 * policy, so the gate needs it separated rather than merely stripped.
 */
export function splitMcpToolName(fullName: string): { server: string; tool: string } | null {
  const match = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(fullName);
  return match ? { server: match[1], tool: match[2] } : null;
}

/**
 * Map a classification onto an SDK policy.
 *
 * Only a READ is allowed outright. C3's 'app' class means "acts inside AIME,
 * visible and reversible in its UI" — true of TodoWrite and the canvas tool, and
 * never true of a remote server. But the classifier matches on the bare name, so
 * a server that exposes a tool called `canvas`, `Task`, `TodoWrite` or
 * `browser_click` was handed always_allow and skipped the gate entirely. Any
 * connector can choose its own tool names, which makes that a free bypass for
 * exactly the servers this file exists to constrain.
 */
export function policyForClass(cls: ToolClass): ToolPermissionPolicy {
  // 'unknown' asks rather than allows: a gate that guesses "probably fine" is
  // not a gate. Same rule C3 applies to unattended runs.
  return cls === 'read' ? 'always_allow' : 'always_ask';
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
  /** Servers that got a policy, and how many tools it names in each class. */
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
 *
 * ADVISORY. What this writes is what the SDK is TOLD; it is not what stops a
 * call. `buildToolGate` + canUseTool is. Callers must not describe the counts
 * this returns as tools that "require approval" — see the file header.
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

// ── Money ─────────────────────────────────────────────────────────────────

const MONEY_SERVERS = MCP_CATALOG.filter((s) => s.handlesMoney);
const MONEY_IDS = new Set(MONEY_SERVERS.map((s) => s.id));
const MONEY_HOSTS = new Set(
  MONEY_SERVERS.map((s) => {
    try {
      return new URL(s.url).host.toLowerCase();
    } catch {
      return '';
    }
  }).filter(Boolean),
);

/**
 * Does this server move money or change billing?
 *
 * Checked two ways, because neither alone is sound. The key is not proof of
 * identity — `aime-mcp-<name>` is derived from a name the user's URL suggested
 * (see connectors/prompt.ts, where trusting the key sent private repos to
 * `mcp.github.evil.com`) — so the URL host is the stronger signal and is checked
 * too. Here a false positive only means MORE caution, so both are ORed.
 *
 * A money server added under an unrecognised key AND an unrecognised host is
 * still gated by the classifier (`create_refund` is consequential); it just
 * becomes eligible for "Always allow", which this flag withholds.
 */
export function serverHandlesMoney(serverKey: string, entry?: unknown): boolean {
  const id = /^(?:aime|nib)-(?:connector|mcp)-(.+)$/.exec(serverKey)?.[1] ?? serverKey;
  if (MONEY_IDS.has(id)) return true;

  const url = (entry as { url?: unknown } | undefined)?.url;
  if (typeof url === 'string') {
    try {
      return MONEY_HOSTS.has(new URL(url).host.toLowerCase());
    } catch {
      return false;
    }
  }
  return false;
}

// ── The runtime gate ──────────────────────────────────────────────────────

export interface ToolGate {
  /**
   * Which governed server and tool a call names, and the policy for it — or null
   * when the call is not governed here: a builtin (`Write`), or an MCP server
   * outside the mounted remote set (the in-process `aime` server, `web-search`).
   * Returning null rather than a policy keeps the gate's scope exactly the remote
   * servers a user connected.
   */
  resolve(
    fullToolName: string,
  ): { server: string; tool: string; policy: ToolPermissionPolicy } | null;
  /** Just the policy — see resolve. */
  policyFor(fullToolName: string): ToolPermissionPolicy | null;
  /** True when this server is catalogue-flagged as handling money. */
  handlesMoney(serverKey: string): boolean;
  /** Apply a decision for the remainder of this session (see recordToolDecision). */
  remember(serverKey: string, tool: string, decision: 'always_allow' | 'always_deny'): void;
  /** Server keys the gate covers — for logging what is actually protected. */
  governedServers: string[];
}

/**
 * Build the gate `canUseTool` consults.
 *
 * Precedence, strongest first:
 *   1. the user's stored denial — always_deny, in every mode, no prompt;
 *   2. the user's stored approval — unless the server handles money, where a
 *      blanket approval of `create_refund` is the mistake we exist to prevent;
 *   3. an explicit `permission_policy` already on the server entry (what the SDK
 *      was told, whether hand-written or produced by applyToolPolicies);
 *   4. live classification of the name in hand.
 *
 * Step 4 is why this needs no observed-tools file: the name is right there. That
 * closes P3.6b's "first session is ungoverned" limit and covers stdio too.
 */
export function buildToolGate(
  servers: Record<string, unknown>,
  decisions: ToolDecisions = {},
): ToolGate {
  const explicit = new Map<string, Map<string, ToolPermissionPolicy>>();
  const approved = new Map<string, Set<string>>();
  const denied = new Map<string, Set<string>>();
  const money = new Set<string>();

  for (const [key, value] of Object.entries(servers)) {
    const entry = (value ?? {}) as Record<string, unknown>;
    if (serverHandlesMoney(key, entry)) money.add(key);

    const tools = entry.tools;
    if (Array.isArray(tools)) {
      const byName = new Map<string, ToolPermissionPolicy>();
      for (const t of tools) {
        const name = (t as { name?: unknown })?.name;
        const policy = (t as { permission_policy?: unknown })?.permission_policy;
        if (typeof name !== 'string' || !name) continue;
        if (policy === 'always_allow' || policy === 'always_ask' || policy === 'always_deny') {
          byName.set(name, policy);
        }
      }
      if (byName.size > 0) explicit.set(key, byName);
    }

    const stored = decisions[key];
    if (stored?.approved?.length) approved.set(key, new Set(stored.approved.map(bareToolName)));
    if (stored?.denied?.length) denied.set(key, new Set(stored.denied.map(bareToolName)));
  }

  const governed = new Set(Object.keys(servers));

  const resolve: ToolGate['resolve'] = (fullToolName) => {
    if (typeof fullToolName !== 'string' || !fullToolName) return null;

    // `mcp__<server>__<tool>` is what the SDK emits. The other two forms are
    // covered because a name shape we fail to recognise is a name we fail to
    // GATE — and the provider already guards a `<server>:<tool>` form elsewhere,
    // so it is not purely hypothetical. Both alternatives are accepted only when
    // the left half is a server this request actually mounted, so no builtin and
    // no ungoverned server can collide with them.
    let split = splitMcpToolName(fullToolName);
    if (!split || !governed.has(split.server)) {
      split = null;
      for (const sep of ['__', ':'] as const) {
        const at = fullToolName.lastIndexOf(sep);
        if (at <= 0) continue;
        const server = fullToolName.slice(0, at);
        const tool = fullToolName.slice(at + sep.length);
        if (tool && governed.has(server)) {
          split = { server, tool };
          break;
        }
      }
    }
    if (!split) return null;

    const { server, tool } = split;
    const decided = (policy: ToolPermissionPolicy) => ({ server, tool, policy });

    if (denied.get(server)?.has(tool)) return decided('always_deny');
    if (approved.get(server)?.has(tool) && !money.has(server)) return decided('always_allow');

    const declared = explicit.get(server)?.get(tool);
    if (declared) {
      return decided(money.has(server) && declared === 'always_allow' ? 'always_ask' : declared);
    }

    // Classify the BARE name. classifyToolCall strips an `mcp__` prefix itself
    // but not a `<server>:` one, which would otherwise be judged on a name with
    // the server still glued to the front of it.
    return decided(policyForClass(classifyToolCall(tool)));
  };

  return {
    governedServers: [...governed].sort(),
    handlesMoney: (serverKey) => money.has(serverKey),
    remember(serverKey, tool, decision) {
      const bare = bareToolName(tool);
      const [into, outOf] =
        decision === 'always_deny' ? [denied, approved] : [approved, denied];
      let set = into.get(serverKey);
      if (!set) into.set(serverKey, (set = new Set()));
      set.add(bare);
      outOf.get(serverKey)?.delete(bare);
    },
    resolve,
    policyFor: (fullToolName) => resolve(fullToolName)?.policy ?? null,
  };
}

// ── The approval prompt ───────────────────────────────────────────────────

export type ApprovalDecision = 'allow-once' | 'always-allow' | 'deny' | 'always-deny';

export interface ApprovalQuestion {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: false;
}

const LABELS: Record<string, ApprovalDecision> = {
  'Allow once': 'allow-once',
  'Always allow': 'always-allow',
  Deny: 'deny',
  'Always deny': 'always-deny',
};

/** Tool and server names come from the server; keep them short and inert. */
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

/**
 * The question put to the user when a gated tool is called. Deliberately shaped
 * as an AskUserQuestion payload: that rendezvous (provider → SSE `input_request`
 * → QuestionCard → POST /api/chat/answer → resolveAnswer) already exists and is
 * already rendered on chat, cowork and code, so the gate needs no fourth copy
 * of it and no new UI to be real.
 */
export function buildApprovalQuestion(opts: {
  server: string;
  tool: string;
  handlesMoney?: boolean;
}): ApprovalQuestion {
  const tool = clip(opts.tool, 80);
  const server = clip(opts.server.replace(/^(?:aime|nib)-(?:connector|mcp)-/, ''), 60);
  const options: ApprovalQuestion['options'] = [
    { label: 'Allow once', description: 'Run it now. You will be asked again next time.' },
  ];
  if (!opts.handlesMoney) {
    options.push({
      label: 'Always allow',
      description: `Run ${tool} from now on without asking.`,
    });
  }
  options.push(
    { label: 'Deny', description: 'Do not run it. The agent is told and carries on.' },
    { label: 'Always deny', description: `Block ${tool} from now on.` },
  );

  return {
    header: opts.handlesMoney ? 'Approval — moves money' : 'Approval',
    question: opts.handlesMoney
      ? `${server} can move money. Run ${tool}?`
      : `Allow ${server} to run ${tool}?`,
    options,
    multiSelect: false,
  };
}

/**
 * Read the user's decision back off an answers map.
 *
 * Fails closed on everything it does not recognise — an empty answer, two
 * answers, a label it never offered. This is the last step before a tool with
 * outside-world effects runs, so "could not tell" has to mean deny.
 */
export function readApprovalAnswer(
  answers: unknown,
  question: string,
  opts: { handlesMoney?: boolean } = {},
): ApprovalDecision {
  if (!answers || typeof answers !== 'object') return 'deny';
  const map = answers as Record<string, unknown>;
  const entries = Object.entries(map);
  const raw = map[question] ?? (entries.length === 1 ? entries[0][1] : undefined);
  if (typeof raw !== 'string') return 'deny';

  const decision = LABELS[raw.trim()];
  if (!decision) return 'deny';
  // "Always allow" is never remembered for a tool that can move money.
  if (decision === 'always-allow' && opts.handlesMoney) return 'allow-once';
  return decision;
}

// ── The decision store (the only part that touches disk) ──────────────────

/** Names we are willing to write into the store. MCP tool names are far tamer. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** A hostile server must not be able to grow this file without bound. */
const MAX_DECISIONS_PER_SERVER = 200;

/**
 * Sits beside the MCP config and the observed-tools file, for the same reason:
 * it holds no secrets, so it can be read, diffed and hand-edited without going
 * anywhere near the 0600 credential file.
 */
export function toolDecisionsPath(mcpConfigPath: string): string {
  return join(dirname(mcpConfigPath), '.aime-mcp-decisions.json');
}

export async function readToolDecisions(mcpConfigPath: string): Promise<ToolDecisions> {
  try {
    const { readFile } = await import('fs/promises');
    const parsed = JSON.parse(await readFile(toolDecisionsPath(mcpConfigPath), 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ToolDecisions = {};
    for (const [server, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const list = (key: 'approved' | 'denied') => {
        const raw = (value as Record<string, unknown>)[key];
        return Array.isArray(raw)
          ? raw.filter((n): n is string => typeof n === 'string' && SAFE_NAME.test(n)).slice(0, MAX_DECISIONS_PER_SERVER)
          : [];
      };
      const approved = list('approved');
      const denied = list('denied');
      if (approved.length || denied.length) out[server] = { approved, denied };
    }
    return out;
  } catch {
    // Missing or corrupt ⇒ no stored decisions, so the classifier governs and
    // the user is asked. Never weaken the policy over an unreadable file.
    return {};
  }
}

/**
 * Persist one decision. Merged into whatever is on disk so two surfaces
 * answering at once cannot drop each other's choice, and a denial removes any
 * earlier approval of the same tool (deny outranks approve everywhere else too).
 */
export async function recordToolDecision(
  mcpConfigPath: string,
  serverKey: string,
  tool: string,
  decision: 'always_allow' | 'always_deny',
): Promise<void> {
  const bare = bareToolName(tool);
  if (!SAFE_NAME.test(serverKey) || !SAFE_NAME.test(bare)) {
    console.warn('[MCP] Refusing to remember a decision for an implausible name:', serverKey, bare);
    return;
  }
  try {
    const existing = await readToolDecisions(mcpConfigPath);
    const entry = existing[serverKey] ?? {};
    const approved = new Set(entry.approved ?? []);
    const denied = new Set(entry.denied ?? []);
    if (decision === 'always_deny') {
      approved.delete(bare);
      denied.add(bare);
    } else {
      denied.delete(bare);
      approved.add(bare);
    }
    if (approved.size + denied.size > MAX_DECISIONS_PER_SERVER) {
      console.warn(`[MCP] ${serverKey} has too many remembered tool decisions; not adding more`);
      return;
    }
    existing[serverKey] = { approved: [...approved].sort(), denied: [...denied].sort() };

    // 0600: this holds no secrets, but it is an allow-list that decides whether a
    // tool runs without asking, so it should not be writable by anything the user
    // would not trust with their MCP config.
    const { writeFile } = await import('fs/promises');
    await writeFile(toolDecisionsPath(mcpConfigPath), JSON.stringify(existing, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  } catch (err) {
    // A decision that cannot be saved still governed the call that produced it;
    // the user is simply asked again next time. Never fail the turn over it.
    console.warn('[MCP] Could not remember the tool decision:', err instanceof Error ? err.message : err);
  }
}

/** Adapt stored decisions to the `optsFor` callback `applyToolPolicies` takes. */
export function decisionOptions(decisions: ToolDecisions): (serverKey: string) => BuildPolicyOptions {
  return (serverKey) => {
    const entry = decisions[serverKey];
    if (!entry) return {};
    return { approved: entry.approved ?? [], denied: entry.denied ?? [] };
  };
}
