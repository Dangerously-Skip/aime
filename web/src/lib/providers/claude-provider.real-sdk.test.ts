import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { resolveAnswer } from '../pending-questions';
import type { QueryParams } from './base-provider';

/**
 * The permission gates against the REAL Agent SDK CLI.
 *
 * Every other provider test stubs `@anthropic-ai/claude-agent-sdk` and calls
 * `canUseTool` itself — which assumes the one thing that turned out to be
 * false. Run for real, the CLI (0.3.285) never consulted `canUseTool` under
 * `bypassPermissions` or `acceptEdits`, nor for any tool on `allowedTools`:
 * Chat and Cowork run `bypassPermissions`, so "Block dangerous commands" and
 * "Restrict to project folder" — both on by default, both badged ENFORCED —
 * did nothing there. And Code's "Ask permissions" asked nothing.
 *
 * So nothing on the permission path is mocked here: the real ClaudeProvider,
 * the real CLI binary, the real rendezvous. The only stand-in is the MODEL — a
 * local HTTP server speaking the Messages API that asks for one tool call and
 * then says "done". Whether the tool actually ran is read off the disk.
 *
 * Each case spawns the CLI (a few seconds), so the set is kept to the claims
 * that no stubbed test can make.
 */

const { homeRef } = vi.hoisted(() => ({ homeRef: { value: '' as string } }));

// A throwaway home, so CLAUDE_CONFIG_DIR (the app data dir), plugins and the
// stored security settings all live somewhere disposable.
vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  return { ...actual, default: actual, homedir: () => homeRef.value || actual.homedir() };
});

/** The platform CLI ships as an optional dependency; without it there is nothing to run. */
function cliInstalled(): boolean {
  const req = createRequire(import.meta.url);
  for (const suffix of ['', '-musl']) {
    try {
      req.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${suffix}/package.json`);
      return true;
    } catch {
      /* try the next */
    }
  }
  return false;
}

// ── A stand-in for the Messages API ──────────────────────────────────────────

let script: { name: string; input: Record<string, unknown> } | null = null;
let server: http.Server;
let baseUrl = '';

function sse(res: http.ServerResponse, events: Array<Record<string, unknown>>) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const e of events) res.write(`event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`);
  res.end();
}

function reply(block: Record<string, unknown>, stop: string) {
  const start = {
    type: 'message_start',
    message: {
      id: `msg_${Math.random().toString(36).slice(2)}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5',
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 },
    },
  };
  const opened = block.type === 'text'
    ? [
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: block.text } },
      ]
    : [
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2)}`, name: block.name, input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } },
      ];
  return [
    start,
    ...opened,
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ];
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

let cwd = '';
let elsewhere = '';

beforeAll(async () => {
  homeRef.value = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-realsdk-home-'));
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-realsdk-project-'));
  elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-realsdk-elsewhere-'));
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: 10 }));
        return;
      }
      const b = JSON.parse(body || '{}') as { messages?: Array<{ content?: unknown }>; tools?: Array<{ name: string }>; stream?: boolean };
      const last = b.messages?.at(-1)?.content;
      const answered = Array.isArray(last) && last.some((c: { type?: string }) => c?.type === 'tool_result');
      const wanted = script && !answered && (b.tools ?? []).some((t) => t.name === script!.name);
      const block = wanted ? { type: 'tool_use', ...script! } : { type: 'text', text: 'done' };
      const stop = wanted ? 'tool_use' : 'end_turn';
      if (b.stream) {
        sse(res, reply(block, stop));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5',
        content: [wanted ? { ...block, id: 'toolu_x' } : block], stop_reason: stop, stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  for (const d of [homeRef.value, cwd, elsewhere]) if (d) fs.rmSync(d, { recursive: true, force: true });
  homeRef.value = '';
});

const OFF = { blockDangerousCommands: false, blockNetworkCommands: false, restrictToProjectFolder: false, disableBashTool: false };

/**
 * One real turn in which the "model" makes exactly one tool call.
 * `answer` is how the user responds to any card the turn raises.
 */
async function realTurn(
  tool: { name: string; input: Record<string, unknown> },
  params: Partial<QueryParams>,
  answer: 'Allow once' | 'Deny' | null = null,
) {
  script = tool;
  const asked: string[] = [];
  const onInputRequest = answer
    ? async (handle: string, questions: unknown) => {
        const q = (questions as Array<{ question: string }>)[0];
        asked.push(q.question);
        setTimeout(() => resolveAnswer(handle, { [q.question]: answer }), 0);
      }
    : undefined;
  const { ClaudeProvider } = await import('./claude-provider');
  const provider = new ClaudeProvider();
  for await (const _ of provider.query({
    prompt: 'go',
    chatId: `real-sdk-${Math.random().toString(36).slice(2)}`,
    cwd,
    baseUrl,
    apiKey: 'sk-ant-test-not-a-key',
    model: 'claude-sonnet-4-5',
    mcpServers: {},
    securitySettings: OFF,
    onInputRequest,
    ...params,
  } as QueryParams)) {
    /* drain */
  }
  return { asked };
}

const installed = cliInstalled();
if (!installed) {
  console.warn('[real-sdk] The Agent SDK CLI binary for this platform is not installed — skipping.');
}

describe.skipIf(!installed)('the real CLI consults the gate in every mode', () => {
  beforeAll(() => {
    // No telemetry or update checks from a test run.
    vi.stubEnv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', '1');
    vi.stubEnv('SEARXNG_INSTANCES', '');
  });

  const rm = (file: string) => ({ name: 'Bash', input: { command: `rm -rf ${file}`, description: 'remove' } });

  it('control: with the toggle off, the harness really runs the command', async () => {
    const victim = path.join(cwd, 'victim-control.txt');
    fs.writeFileSync(victim, 'x');
    await realTurn(rm(victim), { surfaceId: 'code', permissionMode: 'bypass' });
    expect(fs.existsSync(victim)).toBe(false);
  }, 120_000);

  it.each([
    ['Code in Bypass permissions', { surfaceId: 'code', permissionMode: 'bypass' as const }],
    ['Chat (bypassPermissions by default)', { surfaceId: 'chat' }],
  ])('%s: "Block dangerous commands" still stops rm -rf', async (_label, params) => {
    const victim = path.join(cwd, `victim-${params.surfaceId}.txt`);
    fs.writeFileSync(victim, 'x');
    // No client to ask ⇒ the gate refuses outright.
    await realTurn(rm(victim), { ...params, securitySettings: { ...OFF, blockDangerousCommands: true } });
    expect(fs.existsSync(victim)).toBe(true);
  }, 120_000);

  it('Ask permissions: a Write is put to the user, and a Deny means no file', async () => {
    const target = path.join(cwd, 'asked-denied.txt');
    const { asked } = await realTurn(
      { name: 'Write', input: { file_path: target, content: 'x' } },
      { surfaceId: 'code', permissionMode: 'default' },
      'Deny',
    );
    expect(asked).toHaveLength(1);
    expect(fs.existsSync(target)).toBe(false);
  }, 120_000);

  it('Ask permissions: an allowed Write is written', async () => {
    const target = path.join(cwd, 'asked-allowed.txt');
    const { asked } = await realTurn(
      { name: 'Write', input: { file_path: target, content: 'x' } },
      { surfaceId: 'code', permissionMode: 'default' },
      'Allow once',
    );
    expect(asked).toHaveLength(1);
    expect(fs.readFileSync(target, 'utf8')).toBe('x');
  }, 120_000);

  it('Plan mode: a Write the model insists on is not written', async () => {
    const target = path.join(cwd, 'planned.txt');
    const { asked } = await realTurn(
      { name: 'Write', input: { file_path: target, content: 'x' } },
      { surfaceId: 'code', permissionMode: 'plan' },
      'Allow once',
    );
    expect(asked).toHaveLength(0);
    expect(fs.existsSync(target)).toBe(false);
  }, 120_000);

  it('Auto accept edits: a Write outside the project folder is asked about', async () => {
    const target = path.join(elsewhere, 'outside.txt');
    const { asked } = await realTurn(
      { name: 'Write', input: { file_path: target, content: 'x' } },
      { surfaceId: 'code', permissionMode: 'acceptEdits' },
      'Deny',
    );
    expect(asked).toHaveLength(1);
    expect(fs.existsSync(target)).toBe(false);
  }, 120_000);
});

/**
 * The same gate in runs nobody is watching.
 *
 * The hook used to be interactive-only, so in a subagent on Cowork or Code —
 * `bypassPermissions` / `acceptEdits` — the CLI ran a Write or an `rm -rf`
 * without asking `canUseTool` at all: the 'consequential' policy and the
 * Security toggles were inert there. Each case runs with the params its real
 * caller sends (the policy each states), and `onToolRefused` proves the
 * refusal came from OUR gate rather than from the CLI declining on its own.
 */
describe.skipIf(!installed)('the real CLI consults the gate in background runs too', () => {
  beforeAll(() => {
    vi.stubEnv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', '1');
    vi.stubEnv('SEARXNG_INSTANCES', '');
  });

  /** Params as each caller sends them: execute-service, /api/subagent, refresh-service. */
  const STANDING_ORDER = () => ({ chatId: `standing-order-o1-${Date.now()}`, surfaceId: 'assistant', approvalPolicy: 'consequential' as const });
  const UNATTENDED_SUBAGENT = () => ({ chatId: `subagent_canvas-refresh_${Date.now()}`, surfaceId: 'cowork', approvalPolicy: 'consequential' as const });
  const ATTENDED_SUBAGENT = () => ({ chatId: `subagent_code-pr-1_${Date.now()}`, surfaceId: 'cowork', approvalPolicy: 'never' as const });
  const WIDGET = () => ({ chatId: `widget-w1`, surfaceId: 'assistant', approvalPolicy: 'never' as const });

  async function backgroundTurn(tool: { name: string; input: Record<string, unknown> }, params: Partial<QueryParams>) {
    const refused: string[] = [];
    await realTurn(tool, { ...params, onToolRefused: (r) => refused.push(r.tool) });
    return refused;
  }

  it('a standing order: the model calls Write, and it is refused — not written', async () => {
    const target = path.join(cwd, 'standing-order-report.md');
    const refused = await backgroundTurn({ name: 'Write', input: { file_path: target, content: 'x' } }, STANDING_ORDER());
    expect(fs.existsSync(target)).toBe(false);
    expect(refused).toEqual(['Write']);
  }, 120_000);

  it('an unattended subagent on Cowork (bypassPermissions): a Write is refused', async () => {
    const target = path.join(cwd, 'unattended-subagent.md');
    const refused = await backgroundTurn({ name: 'Write', input: { file_path: target, content: 'x' } }, UNATTENDED_SUBAGENT());
    expect(fs.existsSync(target)).toBe(false);
    expect(refused).toEqual(['Write']);
  }, 120_000);

  it('an attended subagent: a Write is allowed and written', async () => {
    const target = path.join(cwd, 'attended-subagent.md');
    const refused = await backgroundTurn({ name: 'Write', input: { file_path: target, content: 'x' } }, ATTENDED_SUBAGENT());
    expect(fs.readFileSync(target, 'utf8')).toBe('x');
    expect(refused).toEqual([]);
  }, 120_000);

  it.each([
    ['an attended subagent on Cowork', ATTENDED_SUBAGENT],
    ['a widget refresh', WIDGET],
    ['a standing order', STANDING_ORDER],
  ])('%s with "Block dangerous commands": rm -rf is refused', async (_label, params) => {
    const victim = path.join(cwd, `bg-victim-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(victim, 'x');
    const refused = await backgroundTurn(
      { name: 'Bash', input: { command: `rm -rf ${victim}`, description: 'remove' } },
      { ...params(), securitySettings: { ...OFF, blockDangerousCommands: true } },
    );
    expect(fs.existsSync(victim)).toBe(true);
    expect(refused).toEqual(['Bash']);
  }, 120_000);
});
