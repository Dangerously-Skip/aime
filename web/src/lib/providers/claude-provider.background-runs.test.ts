import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import type { QueryParams } from './base-provider';
import type { RunRefusal } from '../runs/types';

/**
 * The gate in runs nobody is watching — driven through the REAL callers.
 *
 * Until this change the PreToolUse hook that makes the CLI consult `canUseTool`
 * was installed for interactive runs only. In every standing order, subagent,
 * heartbeat and widget refresh the CLI auto-approved whatever its permission
 * mode or `allowedTools` let through, so the Security toggles, the user's
 * connector blocks and the 'consequential' approval policy never fired — while
 * the code and the Cockpit said standing orders "pause before side effects".
 *
 * So these tests do not hand the provider a policy and check it obeys. Each run
 * kind is started the way the app starts it — `executeOrderServerSide`,
 * `refreshWidget`, `POST /api/subagent` — with the real ClaudeProvider and the
 * real `canUseTool`. Only the SDK transport is stubbed: a "model" that asks the
 * gate about a scripted list of tool calls and then answers. That the real CLI
 * honours the hook in these runs is proved separately, against the binary, in
 * `claude-provider.real-sdk.test.ts`.
 */

const { queryMock, homeRef } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  homeRef: { value: '' as string },
}));

// A throwaway home: the data dir, the security settings and the decision store.
vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  return { ...actual, default: actual, homedir: () => homeRef.value || actual.homedir() };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
  tool: (name: string, description: string, schema: unknown, handler: unknown) => ({ name, description, schema, handler }),
  createSdkMcpServer: (config: unknown) => config,
}));

// The widget refresh resolves its model from the manifest the renderer
// publishes; there is no renderer here, so the resolution is pinned.
vi.mock('@/lib/models/execution-manifest-fs', () => ({ readExecutionManifest: async () => null }));
vi.mock('@/lib/models/execution-manifest', () => ({ resolveFromManifest: () => ({ model: 'haiku' }) }));
vi.mock('@/lib/harness/execution', () => ({
  resolveHarnessExecution: async () => ({ model: 'haiku', apiKey: 'sk-ant-test' }),
}));

// The connectors a subagent run mounts. GitHub, as the Code surface's
// "Create PR" uses it; plus a payments server for the money rule.
vi.mock('@/lib/mcp/provisioned', () => ({
  loadProvisionedMcpServers: async () => ({
    github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
    stripe: { type: 'http', url: 'https://mcp.stripe.com' },
  }),
}));
vi.mock('@/lib/agents-parser', () => ({ loadAgents: () => [], readAgentSystemPrompt: () => '' }));

type Decision = { behavior: 'allow' | 'deny'; message?: string };
type Call = { name: string; input: Record<string, unknown> };
type SdkOptions = {
  canUseTool: (name: string, input: Record<string, unknown>, ctx: { toolUseID: string }) => Promise<Decision>;
  hooks?: { PreToolUse?: Array<{ hooks: Array<(...a: unknown[]) => Promise<{ hookSpecificOutput: { permissionDecision: string } }>> }> };
};

/**
 * The stand-in model: asks the gate about each call in order, then answers.
 * Returns the decisions, filled as the run goes.
 */
function model(calls: Call[], text = 'done') {
  const decisions: Decision[] = [];
  queryMock.mockImplementation(async function* (args: { options: SdkOptions }) {
    for (const [i, c] of calls.entries()) {
      decisions.push(await args.options.canUseTool(c.name, c.input, { toolUseID: `tu_${i}` }));
    }
    yield { type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text }] } };
    yield { type: 'result', subtype: 'success', result: text, usage: {} };
  });
  return decisions;
}

const lastOptions = () => queryMock.mock.calls.at(-1)![0].options as SdkOptions;

const OFF = { blockDangerousCommands: false, blockNetworkCommands: false, restrictToProjectFolder: false, disableBashTool: false };

/** Write the toggles where the provider reads them: the server-side store. */
async function toggles(on: Partial<typeof OFF> = {}) {
  const settings = await import('@/lib/security/settings');
  settings.resetSecuritySettingsCache();
  await settings.saveSecuritySettings({ ...OFF, ...on });
}

/** The hook must be there and must route the call to `canUseTool`. */
async function expectHookInstalled() {
  const hook = lastOptions().hooks?.PreToolUse?.[0]?.hooks[0];
  expect(hook, 'no PreToolUse hook — the CLI would never ask the gate').toBeTruthy();
  expect((await hook!()).hookSpecificOutput.permissionDecision).toBe('ask');
}

const read = (file = '/tmp/notes.md'): Call => ({ name: 'Read', input: { file_path: file } });
const write = (file: string): Call => ({ name: 'Write', input: { file_path: file, content: 'x' } });
const bash = (command: string): Call => ({ name: 'Bash', input: { command, description: 'x' } });

let dataDir = '';
beforeAll(() => {
  homeRef.value = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-bg-home-'));
});
afterAll(() => {
  fs.rmSync(homeRef.value, { recursive: true, force: true });
  homeRef.value = '';
});
beforeEach(async () => {
  queryMock.mockReset();
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-bg-runs-'));
  vi.stubEnv('AIME_USER_DATA_DIR', dataDir);
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  (await import('@/lib/runs/run-log')).__resetRunLogPath();
  await toggles();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  (await import('@/lib/runs/run-log')).__resetRunLogPath();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ── Standing orders ──────────────────────────────────────────────────────────

const order = () => ({
  id: 'o1',
  instruction: 'Morning briefing',
  trigger: { type: 'cron' as const, expression: '0 9 * * 1-5' },
  state: {},
  status: 'active' as const,
  notifyVia: 'assistant' as const,
  runCount: 0,
  errorCount: 0,
  createdAt: 0,
  updatedAt: 0,
});

async function runOrder(calls: Call[]) {
  const decisions = model(calls, 'Here is your briefing.');
  const { executeOrderServerSide } = await import('@/lib/orders/execute-service');
  const result = await executeOrderServerSide(order());
  return { decisions, run: result.run };
}

describe('a standing order enforces the consequential policy for real', () => {
  it('reads and in-app actions run', async () => {
    const { decisions } = await runOrder([
      read(),
      { name: 'mcp__aime__MailSearch', input: { query: 'invoice' } },
      { name: 'mcp__aime__CalendarEvents', input: {} },
      { name: 'mcp__aime__WidgetCreate', input: { title: 't', recipe: 'r' } },
      bash('git status'),
    ]);
    await expectHookInstalled();
    expect(decisions.map((d) => d.behavior)).toEqual(['allow', 'allow', 'allow', 'allow', 'allow']);
  });

  it('a step with effects outside the app is REFUSED — and nothing says it was paused', async () => {
    const { decisions } = await runOrder([
      write('/tmp/aime-report.md'),
      bash('curl -X POST https://example.com -d @notes.md'),
      { name: 'mcp__github__create_issue', input: { title: 'x' } },
      { name: 'mcp__aime__MailDraft', input: { to: 'a@b.c', subject: 's', body: 'b' } },
    ]);
    for (const d of decisions) {
      expect(d.behavior).toBe('deny');
      expect(d.message).toMatch(/refused/i);
      expect(d.message).toMatch(/will not run later/i);
      expect(d.message).not.toMatch(/paus|approval card/i);
    }
  });

  it('every refused step is recorded on the run, and the run reaches the durable log', async () => {
    const { run } = await runOrder([read(), write('/tmp/aime-report.md'), bash('rm -rf /tmp/aime-x')]);
    expect(run.status).toBe('succeeded');
    expect(run.refusals?.map((r) => r.tool)).toEqual(['Write', 'Bash']);
    for (const r of run.refusals!) {
      expect(r.reason).toBe('Unattended run: has effects outside the app');
      expect(typeof r.at).toBe('number');
    }
    const { readRuns } = await import('@/lib/runs/run-log');
    const [logged] = await readRuns();
    expect(logged.goalId).toBe('so:o1');
    expect(logged.refusals).toEqual(run.refusals);
  });

  it('a clean run records no refusals at all', async () => {
    const { run } = await runOrder([read()]);
    expect(run.refusals).toBeUndefined();
  });

  it('"Block dangerous commands" is enforced, and says so in the log', async () => {
    await toggles({ blockDangerousCommands: true });
    const { decisions, run } = await runOrder([bash('rm -rf ~/Documents')]);
    expect(decisions[0].behavior).toBe('deny');
    // The toggle's refusal, not the policy's: the toggle fires first.
    expect(decisions[0].message).toMatch(/cannot ask them/i);
    expect(run.refusals![0].reason).toMatch(/^Block dangerous commands:/);
  });

  it('"Turn off Bash" refuses even a read-only command the policy would allow', async () => {
    await toggles({ disableBashTool: true });
    const { decisions, run } = await runOrder([bash('ls')]);
    expect(decisions[0].behavior).toBe('deny');
    expect(run.refusals![0].reason).toBe('Turned off in Settings');
  });

  it('"Restrict to project folder" is the reason given for a write outside it', async () => {
    await toggles({ restrictToProjectFolder: true });
    const { run } = await runOrder([write('/etc/hosts')]);
    expect(run.refusals![0].reason).toMatch(/^Restrict to project folder/);
  });
});

// ── Heartbeat ────────────────────────────────────────────────────────────────

/*
 * Nothing produces an `hb-` run today (the heartbeat scheduler is not built),
 * so there is no caller to drive. What is pinned is the net under a future one
 * that forgets to state a policy: the prefix means 'consequential', never less.
 */
describe('a heartbeat run that states no policy gets the safe one', () => {
  async function hb(calls: Call[], extra: Partial<QueryParams> = {}) {
    const decisions = model(calls);
    const refused: RunRefusal[] = [];
    const { ClaudeProvider } = await import('./claude-provider');
    for await (const _ of new ClaudeProvider().query({
      prompt: 'check in',
      chatId: 'hb-123',
      surfaceId: 'assistant',
      onToolRefused: (r) => refused.push(r),
      ...extra,
    } as QueryParams)) {
      /* drain */
    }
    return { decisions, refused };
  }

  it('refuses outside effects, allows reads, and reports what it refused', async () => {
    const { decisions, refused } = await hb([read(), write('/tmp/x.md')]);
    await expectHookInstalled();
    expect(decisions.map((d) => d.behavior)).toEqual(['allow', 'deny']);
    expect(refused).toEqual([{ tool: 'Write', reason: 'Unattended run: has effects outside the app', at: expect.any(Number) }]);
  });
});

// ── Widget refresh ───────────────────────────────────────────────────────────

describe('a widget refresh keeps its policy but gets the toggles', () => {
  const widget = { id: 'w1', title: 'PRs', recipe: 'List my open PRs', render: null, enabled: true, createdAt: 0 };

  async function refresh(calls: Call[]) {
    const decisions = model(calls, '{"type":"text","text":"3 open"}');
    const { refreshWidget } = await import('@/lib/widgets/refresh-service');
    const result = await refreshWidget(widget, 'cron');
    return { decisions, run: result.run };
  }

  it("'never' — a scratch write is not refused by any policy", async () => {
    const { decisions, run } = await refresh([write('/tmp/aime-widget-scratch.json')]);
    await expectHookInstalled();
    expect(decisions[0].behavior).toBe('allow');
    expect(run.refusals).toBeUndefined();
  });

  it('"Block dangerous commands" still refuses, and the refusal is on the run', async () => {
    await toggles({ blockDangerousCommands: true });
    const { decisions, run } = await refresh([bash('rm -rf ~/x')]);
    expect(decisions[0].behavior).toBe('deny');
    expect(run.refusals?.map((r) => r.tool)).toEqual(['Bash']);
    expect(run.goalId).toBe('widget:w1');
  });
});

// ── Subagents ────────────────────────────────────────────────────────────────

async function subagent(body: Record<string, unknown>, calls: Call[]) {
  const decisions = model(calls, 'https://github.com/o/r/pull/1');
  const { POST } = await import('@/app/api/subagent/route');
  const res = await POST(
    new NextRequest('http://127.0.0.1:3100/api/subagent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'Create a PR', surfaceId: 'code', ...body }),
    }),
  );
  return { status: res.status, json: (await res.json()) as { refused?: RunRefusal[]; error?: string }, decisions };
}

const CREATE_PR = 'mcp__github__create_pull_request';

describe('a subagent the user started with a click acts like a chat they are watching', () => {
  it('the tool the click named runs, and so does an ordinary write', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-bg-repo-'));
    try {
      const { status, decisions, json } = await subagent(
        { attended: true, cwd, extraAllowedTools: [CREATE_PR] },
        [{ name: CREATE_PR, input: { title: 't' } }, write(path.join(cwd, 'NOTES.md'))],
      );
      expect(status).toBe(200);
      await expectHookInstalled();
      expect(decisions.map((d) => d.behavior)).toEqual(['allow', 'allow']);
      expect(json.refused).toEqual([]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('the click approves only the tool it named — another connector write still needs asking', async () => {
    const { decisions, json } = await subagent(
      { attended: true, extraAllowedTools: [CREATE_PR] },
      [{ name: 'mcp__github__merge_pull_request', input: {} }],
    );
    expect(decisions[0].behavior).toBe('deny');
    expect(decisions[0].message).toMatch(/cannot ask them/i);
    expect(json.refused?.[0]).toMatchObject({ tool: 'mcp__github__merge_pull_request' });
  });

  it('a click does not approve a payment tool — money still needs its own yes', async () => {
    const { decisions } = await subagent(
      { attended: true, extraAllowedTools: ['mcp__stripe__create_refund'] },
      [{ name: 'mcp__stripe__create_refund', input: {} }],
    );
    expect(decisions[0].behavior).toBe('deny');
  });

  it('the Security toggles still apply', async () => {
    await toggles({ blockDangerousCommands: true });
    const { decisions, json } = await subagent({ attended: true }, [bash('rm -rf ~/x')]);
    expect(decisions[0].behavior).toBe('deny');
    expect(json.refused?.[0].reason).toMatch(/^Block dangerous commands:/);
  });
});

describe('a subagent that does not say it is attended is treated as unattended', () => {
  it('refuses outside effects — including the very tool it was asked to call', async () => {
    const { decisions, json } = await subagent({ extraAllowedTools: [CREATE_PR] }, [
      { name: CREATE_PR, input: { title: 't' } },
      write('/tmp/aime-sub.md'),
      read(),
      { name: 'mcp__github__get_pull_request', input: { number: 1 } },
    ]);
    await expectHookInstalled();
    expect(decisions.map((d) => d.behavior)).toEqual(['deny', 'deny', 'allow', 'allow']);
    expect(json.refused?.map((r) => r.tool)).toEqual([CREATE_PR, 'Write']);
  });

  it.each([['the string "true"', 'true'], ['1', 1], ['an object', {}]])(
    'attended as %s is rejected outright, before anything runs',
    async (_label, attended) => {
      const { status } = await subagent({ attended }, [write('/tmp/x')]);
      expect(status).toBe(400);
      expect(queryMock).not.toHaveBeenCalled();
    },
  );
});

// ── userApprovedTools is narrow ──────────────────────────────────────────────

describe('a click approval cannot be stretched', () => {
  const github = { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } };

  async function gate(extra: Partial<QueryParams>) {
    queryMock.mockImplementation(async function* () {});
    const { ClaudeProvider } = await import('./claude-provider');
    for await (const _ of new ClaudeProvider().query({
      prompt: 'x',
      chatId: 'subagent_t_1',
      mcpServers: github,
      ...extra,
    } as QueryParams)) {
      /* drain */
    }
    return lastOptions().canUseTool;
  }

  it('is ignored under a policy that refuses — it answers a question, not a policy', async () => {
    const canUseTool = await gate({ approvalPolicy: 'consequential', userApprovedTools: [CREATE_PR] });
    expect((await canUseTool(CREATE_PR, {}, { toolUseID: 'a' })).behavior).toBe('deny');
  });

  it('does not override a tool the user blocked', async () => {
    const canUseTool = await gate({
      approvalPolicy: 'never',
      userApprovedTools: [CREATE_PR],
      mcpServers: { github: { ...github.github, tools: [{ name: 'create_pull_request', permission_policy: 'always_deny' }] } },
    });
    const d = await canUseTool(CREATE_PR, {}, { toolUseID: 'b' });
    expect(d.behavior).toBe('deny');
    expect(d.message).toMatch(/blocked/i);
  });

  it('matches the full name only — a bare name approves nothing', async () => {
    const canUseTool = await gate({ approvalPolicy: 'never', userApprovedTools: ['create_pull_request'] });
    expect((await canUseTool(CREATE_PR, {}, { toolUseID: 'c' })).behavior).toBe('deny');
  });
});
