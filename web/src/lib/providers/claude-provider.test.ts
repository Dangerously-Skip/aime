import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { ClaudeProvider } from './claude-provider';
import { resolveAnswer } from '../pending-questions';
import type { StreamChunk, QueryParams } from './base-provider';
import type { SessionControls } from '../slash-commands';

const { queryMock, homeRef } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  // Lets a test point homedir() at a temp dir. Unset ⇒ the real home, so every
  // pre-existing test is unaffected.
  homeRef: { value: null as string | null },
}));

vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  return { ...actual, default: actual, homedir: () => homeRef.value ?? actual.homedir() };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
  tool: (name: string, description: string, schema: unknown, handler: unknown) =>
    ({ name, description, schema, handler }),
  createSdkMcpServer: (config: unknown) => config,
}));

/** Script the SDK to yield the given chunks. */
function scriptChunks(chunks: unknown[]) {
  queryMock.mockImplementation(async function* () {
    for (const c of chunks) yield c;
  });
}

/** Consume the provider's stream into an array. */
async function run(provider: ClaudeProvider, params: Partial<QueryParams>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const chunk of provider.query({ prompt: 'hello', chatId: 'chat1', ...params } as QueryParams)) {
    out.push(chunk);
  }
  return out;
}

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: { toolUseID: string },
) => Promise<{ behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }>;

/** Run an empty query just to capture the assembled SDK options. */
async function captureOptions(provider: ClaudeProvider, params: Partial<QueryParams> = {}) {
  await run(provider, params);
  const call = queryMock.mock.calls.at(-1)![0] as { prompt: unknown; options: Record<string, unknown> };
  return { prompt: call.prompt, options: call.options, canUseTool: call.options.canUseTool as CanUseTool };
}

/**
 * Answer an outstanding card the way the real client does: with the handle the
 * provider issued on the relay callback.
 *
 * These tests used to settle the rendezvous by the SDK's `toolUseID`, which they
 * knew because they passed it in. They cannot any more, and that is the point —
 * the id a resolution must present is minted per request with a nonce in it (see
 * lib/rendezvous → issueHandle), so knowing which tool call is pending is not
 * enough to answer for the user. `issued` is filled by the test's onInputRequest /
 * onConnectorRequest, exactly as the SSE event fills the card.
 *
 * Polls because the provider parks its wait immediately AFTER that callback
 * returns, so the handle exists a tick before the wait it belongs to does.
 */
async function deliver<R>(
  issued: string[],
  settle: (handle: string, result: R) => boolean,
  result: R,
  /** Which card, when a test has more than one open. Default: the newest. */
  nth = -1,
): Promise<void> {
  await vi.waitFor(() => {
    const handle = issued.at(nth);
    expect(handle !== undefined && settle(handle, result)).toBe(true);
  });
}

/** Drop-in onInputRequest / onConnectorRequest that records what it was handed. */
const recordHandle = (issued: string[]) => async (handle: string) => {
  issued.push(handle);
};

const controls = (overrides: Partial<SessionControls>): SessionControls => ({
  thinkLevel: 'off',
  effortLevel: null,
  verboseMode: true,
  reasoningVisible: true,
  modelOverride: null,
  agentName: null,
  ...overrides,
});

beforeEach(() => {
  queryMock.mockReset();
  scriptChunks([]);
  // Keep Bedrock/Gateway detection deterministic regardless of shell env
  vi.stubEnv('AWS_REGION', '');
  vi.stubEnv('AWS_DEFAULT_REGION', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('option assembly', () => {
  it('applies defaults, the aime MCP server, and permission mode', async () => {
    const { options } = await captureOptions(new ClaudeProvider());

    expect(options.allowedTools).toContain('Read');
    expect(options.allowedTools).toContain('Bash');
    expect(options.disallowedTools).toEqual(['WebSearch']);
    expect(options.maxTurns).toBe(20);
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBe(true);

    const mcp = options.mcpServers as Record<string, unknown>;
    expect(mcp.aime).toBeDefined();
  });

  it('includes the web-search MCP server only when SEARXNG_INSTANCES is set', async () => {
    vi.stubEnv('SEARXNG_INSTANCES', '');
    const { options } = await captureOptions(new ClaudeProvider());
    expect((options.mcpServers as Record<string, unknown>)['web-search']).toBeUndefined();

    vi.stubEnv('SEARXNG_INSTANCES', 'https://searx.example.com');
    const { options: withSearx } = await captureOptions(new ClaudeProvider());
    const server = (withSearx.mcpServers as Record<string, Record<string, unknown>>)['web-search'];
    expect(server).toBeDefined();
    expect((server.env as Record<string, string>).SEARXNG_INSTANCES).toBe('https://searx.example.com');
  });

  it('falls back to a per-chat scratch cwd when no folder is selected', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), { chatId: 'scratch-test' });
    expect(options.cwd).toBe(path.join(os.homedir(), '.aime', 'scratch', 'scratch-test'));
  });

  it('uses the provided cwd when given', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), { cwd: '/tmp/myproject' });
    expect(options.cwd).toBe('/tmp/myproject');
  });

  it('strips CLAUDECODE from the subprocess env and pins CLAUDE_CONFIG_DIR', async () => {
    vi.stubEnv('CLAUDECODE', '1');
    const { options } = await captureOptions(new ClaudeProvider());
    const env = options.env as Record<string, string>;
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe(path.join(os.homedir(), '.aime'));
  });

  it('maps think levels to SDK thinking config', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), {
      sessionControls: controls({ thinkLevel: 'high' }),
    });
    expect(options.thinking).toEqual({ type: 'enabled', budgetTokens: 16000 });

    const { options: adaptive } = await captureOptions(new ClaudeProvider(), {
      sessionControls: controls({ thinkLevel: 'adaptive' }),
    });
    expect(adaptive.thinking).toEqual({ type: 'adaptive' });

    const { options: off } = await captureOptions(new ClaudeProvider(), {
      sessionControls: controls({ thinkLevel: 'off' }),
    });
    expect(off.thinking).toBeUndefined();
  });

  it('passes effort level through', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), {
      sessionControls: controls({ effortLevel: 'max' }),
    });
    expect(options.effort).toBe('max');
  });

  it('sets a fallback model for known tiers only', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), { model: 'opus' });
    expect(options.fallbackModel).toBe('sonnet');

    const { options: haiku } = await captureOptions(new ClaudeProvider(), { model: 'haiku' });
    expect(haiku.fallbackModel).toBeUndefined();
  });

  it('enables prompt suggestions only for the chat surface', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), { surfaceId: 'chat' });
    expect(options.promptSuggestions).toBe(true);

    const { options: cowork } = await captureOptions(new ClaudeProvider(), { surfaceId: 'cowork' });
    expect(cowork.promptSuggestions).toBeUndefined();
  });

  it('routes a user API key directly to the Anthropic API', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), { apiKey: 'sk-test-key', model: 'opus' });
    const env = options.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test-key');
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined(); // no gateway rewrite
    expect(options.model).toBe('opus'); // SDK model name untouched
  });

  it('points the SDK at a user-added provider base URL alongside its key', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), {
      apiKey: 'sk-or-user-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'moonshotai/kimi-k2',
    });
    const env = options.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBe('sk-or-user-key');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api/v1');
    expect(options.model).toBe('moonshotai/kimi-k2'); // driver model passed through
  });

  it('sets a base URL even without a per-request key (env/keychain path)', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), {
      baseUrl: 'http://127.0.0.1:3100/api/llm-proxy/local',
      model: 'llama3',
    });
    const env = options.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:3100/api/llm-proxy/local');
  });

  it('prepends conversation history as XML only when there is no session to resume', async () => {
    const history = [
      { role: 'user' as const, content: 'earlier question' },
      { role: 'assistant' as const, content: 'earlier answer' },
    ];
    const { prompt } = await captureOptions(new ClaudeProvider(), { prompt: 'follow-up', history });
    expect(prompt).toContain('<conversation_history>');
    expect(prompt).toContain('<msg role="user">earlier question</msg>');
    expect((prompt as string).endsWith('follow-up')).toBe(true);
  });

  it('inlines attachments into the prompt', async () => {
    const { prompt } = await captureOptions(new ClaudeProvider(), {
      attachments: [
        { name: 'notes.txt', content: 'inline body', type: 'text/plain', category: 'text' },
        { name: 'report.pdf', content: '', type: 'application/pdf', category: 'document', extractedPath: '/scratch/report.txt' },
        { name: 'shot.png', content: '', type: 'image/png', category: 'image' },
      ],
    });
    const p = prompt as string;
    expect(p).toContain('<document name="notes.txt">\ninline body\n</document>');
    expect(p).toContain('/scratch/report.txt');
    expect(p).toContain('Use the Read tool');
    expect(p).toContain('[Attached image: shot.png]');
  });
});

describe('session resumption', () => {
  const initChunk = { type: 'system', subtype: 'init', session_id: 'sess-abc' };

  it('captures the session id and resumes it on the next query', async () => {
    const provider = new ClaudeProvider();
    scriptChunks([initChunk]);
    await run(provider, { chatId: 'c1' });
    expect(provider.getSession('c1')).toBe('sess-abc');

    scriptChunks([]);
    const { options } = await captureOptions(provider, { chatId: 'c1' });
    expect(options.resume).toBe('sess-abc');
  });

  it('starts a fresh session when the working directory changes', async () => {
    const provider = new ClaudeProvider();
    scriptChunks([initChunk]);
    await run(provider, { chatId: 'c1', cwd: '/tmp/a' });

    scriptChunks([]);
    const { options } = await captureOptions(provider, { chatId: 'c1', cwd: '/tmp/b' });
    expect(options.resume).toBeUndefined();
  });

  it('resumes when the cwd is unchanged', async () => {
    const provider = new ClaudeProvider();
    scriptChunks([initChunk]);
    await run(provider, { chatId: 'c1', cwd: '/tmp/a' });

    scriptChunks([]);
    const { options } = await captureOptions(provider, { chatId: 'c1', cwd: '/tmp/a' });
    expect(options.resume).toBe('sess-abc');
  });
});

describe('stream translation', () => {
  it('translates system init into session_init + system_init events', async () => {
    scriptChunks([
      { type: 'system', subtype: 'init', session_id: 's1', data: { skills: ['a'], mcp_servers: ['m'] } },
    ]);
    const chunks = await run(new ClaudeProvider(), {});

    const types = chunks.map((c) => c.type);
    expect(types).toEqual(['session_init', 'system_init', 'done']);
    expect(chunks[0].session_id).toBe('s1');
    expect(chunks[1].skills).toEqual(['a']);
  });

  it('translates assistant text and tool_use blocks, emitting turn_start', async () => {
    scriptChunks([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Working on it' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/a.md' }, id: 'tu1' },
          ],
        },
      },
      { type: 'tool_result', tool_use_id: 'tu1', result: 'file contents' },
    ]);
    const chunks = await run(new ClaudeProvider(), {});

    expect(chunks.map((c) => c.type)).toEqual(['turn_start', 'text', 'tool_use', 'tool_result', 'done']);
    expect(chunks[1].content).toBe('Working on it');
    expect(chunks[2]).toMatchObject({ name: 'Read', input: { file_path: '/a.md' }, id: 'tu1' });
    expect(chunks[3]).toMatchObject({ tool_use_id: 'tu1', result: 'file contents' });
  });

  it('intercepts the canvas tool as a canvas event instead of tool_use', async () => {
    const doc = { version: '1', title: 'Diagram', components: [] };
    scriptChunks([
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'canvas', input: doc, id: 'cv1' }] } },
    ]);
    const chunks = await run(new ClaudeProvider(), {});

    const canvas = chunks.find((c) => c.type === 'canvas');
    expect(canvas).toBeDefined();
    expect(canvas!.doc).toEqual(doc);
    expect(chunks.some((c) => c.type === 'tool_use')).toBe(false);
  });

  it('intercepts CronCreate tool_use as a cron_create event', async () => {
    scriptChunks([
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'mcp__aime__CronCreate', input: { expression: '0 9 * * *', prompt: 'stand-up' }, id: 'cr1' }],
        },
      },
    ]);
    const chunks = await run(new ClaudeProvider(), {});

    const cron = chunks.find((c) => c.type === 'cron_create');
    expect(cron).toBeDefined();
    expect(cron!.input).toMatchObject({ expression: '0 9 * * *' });
    expect(chunks.some((c) => c.type === 'tool_use')).toBe(false);
  });

  it('always terminates the stream with a done event', async () => {
    scriptChunks([]);
    const chunks = await run(new ClaudeProvider(), {});
    expect(chunks.at(-1)?.type).toBe('done');
  });

  it('yields aborted (without done) when the SDK throws AbortError', async () => {
    queryMock.mockImplementation(async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } };
      const err = new Error('user aborted');
      err.name = 'AbortError';
      throw err;
    });
    const chunks = await run(new ClaudeProvider(), {});

    expect(chunks.map((c) => c.type)).toEqual(['turn_start', 'text', 'aborted']);
  });

  it('rethrows non-abort SDK errors', async () => {
    queryMock.mockImplementation(async function* () {
      throw new Error('model exploded');
    });
    await expect(run(new ClaudeProvider(), {})).rejects.toThrow('model exploded');
  });
});

/**
 * `deniedTools` — the difference between a control that looks enforced and one
 * that is.
 *
 * `allowedTools` is the SDK's AUTO-APPROVE list, not the set of mounted tools:
 * "To restrict which tools are available, use the `tools` option instead." We
 * never set `tools`, `permissionMode` is `bypassPermissions`, and `canUseTool`
 * ends in a catch-all allow. So "Disable Bash tool" — which filtered `Bash` out
 * of `allowedTools` — removed a name from an approve-list on a run where
 * approval was already skipped, and Bash kept working. Probed directly before
 * fixing: `canUseTool('Bash', {command: 'rm -rf ~/x'})` returned
 * `{behavior: 'allow'}`.
 *
 * Enforced in both places, because they fail differently: `disallowedTools`
 * keeps the tool out of the model's context (it never asks), while the
 * `canUseTool` check is the one that runs whatever `permissionMode` says.
 */
describe('deniedTools', () => {
  it('refuses a denied tool in canUseTool — the check permissionMode cannot skip', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      deniedTools: ['Bash'],
    });
    const r = await canUseTool('Bash', { command: 'rm -rf ~/x' }, { toolUseID: 'd1' });
    expect(r.behavior).toBe('deny');
    expect(r.message).toMatch(/not available in this session/i);
    // Told not to go looking for another way round it.
    expect(r.message).toMatch(/Do not try it again/i);
  });

  it('also keeps it out of the model context, so it never asks', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), {
      deniedTools: ['Bash', 'BashOutput', 'KillShell'],
    });
    expect(options.disallowedTools).toEqual(
      expect.arrayContaining(['Bash', 'BashOutput', 'KillShell']),
    );
  });

  it('keeps denying WebSearch when the caller denies nothing', async () => {
    const { options } = await captureOptions(new ClaudeProvider(), {});
    expect(options.disallowedTools).toEqual(['WebSearch']);
    expect((await captureOptions(new ClaudeProvider(), {})).canUseTool).toBeDefined();
  });

  it('leaves every other tool alone', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      deniedTools: ['Bash'],
    });
    for (const t of ['Read', 'Write', 'Glob', 'WebFetch', 'mcp__aime__DocumentCreate']) {
      expect((await canUseTool(t, {}, { toolUseID: `ok-${t}` })).behavior, t).toBe('allow');
    }
  });

  it('does NOT infer a denial from absence in allowedTools', async () => {
    // The trap this fix had to avoid: surface lists have never been exhaustive.
    // WidgetCreate is on no surface's allowedTools and is expected to work.
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      allowedTools: ['Read'],
      deniedTools: [],
    });
    expect((await canUseTool('mcp__aime__WidgetCreate', { title: 't', recipe: 'r' }, { toolUseID: 'w1' })).behavior)
      .toBe('allow');
    expect((await canUseTool('Write', { file_path: '/x' }, { toolUseID: 'w2' })).behavior).toBe('allow');
  });

  it('outranks an MCP tool policy that would otherwise allow it', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: {
        'aime-mcp-acme': {
          type: 'http',
          url: 'https://mcp.acme.com/mcp',
          tools: [{ name: 'getIssue', permission_policy: 'always_allow' }],
        },
      },
      deniedTools: ['mcp__aime-mcp-acme__getIssue'],
    });
    const r = await canUseTool('mcp__aime-mcp-acme__getIssue', {}, { toolUseID: 'p1' });
    expect(r.behavior).toBe('deny');
  });
});

/**
 * The two security toggles that are ENFORCED rather than asked for in the
 * prompt. Both used to be a sentence appended to the system prompt and nothing
 * more, so the labels ("Block dangerous commands", "Restrict writes…") promised
 * a boundary that did not exist.
 *
 * They are enforced differently on purpose, and the difference is the point:
 * a write target is decidable, so it is refused outright; a shell command is
 * not, so it goes to a human instead of a blocklist that would only pretend.
 */
describe('security settings that are actually enforced', () => {
  const asker = (asked: Array<{ handle: string; questions: unknown }>) =>
    async (handle: string, questions: unknown) => { asked.push({ handle, questions }); };

  describe('restrictToProjectFolder', () => {
    const params = {
      cwd: '/Users/x/projects/app',
      securitySettings: { restrictToProjectFolder: true },
    };

    it('refuses a write outside the working directory', async () => {
      const { canUseTool } = await captureOptions(new ClaudeProvider(), params);
      const r = await canUseTool('Write', { file_path: '/Users/x/.ssh/authorized_keys' }, { toolUseID: 'w1' });
      expect(r.behavior).toBe('deny');
      expect(r.message).toMatch(/outside the working directory/i);
      // Told not to go looking for another route to the same place.
      expect(r.message).toMatch(/Do not retry it/i);
    });

    it('allows a write inside it, nested or relative', async () => {
      const { canUseTool } = await captureOptions(new ClaudeProvider(), params);
      for (const file_path of ['/Users/x/projects/app/src/a.ts', 'src/b.ts', './c.md']) {
        expect((await canUseTool('Write', { file_path }, { toolUseID: file_path })).behavior, file_path).toBe('allow');
      }
    });

    it('covers Edit and NotebookEdit, and leaves Read alone', async () => {
      const { canUseTool } = await captureOptions(new ClaudeProvider(), params);
      expect((await canUseTool('Edit', { file_path: '/etc/hosts' }, { toolUseID: 'e1' })).behavior).toBe('deny');
      expect((await canUseTool('NotebookEdit', { notebook_path: '/etc/x.ipynb' }, { toolUseID: 'e2' })).behavior).toBe('deny');
      // The setting says reading outside is still allowed, so it must be.
      expect((await canUseTool('Read', { file_path: '/etc/hosts' }, { toolUseID: 'e3' })).behavior).toBe('allow');
    });

    it('does nothing when the setting is off', async () => {
      const { canUseTool } = await captureOptions(new ClaudeProvider(), { cwd: params.cwd });
      expect((await canUseTool('Write', { file_path: '/etc/hosts' }, { toolUseID: 'off' })).behavior).toBe('allow');
    });
  });

  describe('blockDangerousCommands — asks, not blocks', () => {
    const params = { chatId: 'regular-chat', securitySettings: { blockDangerousCommands: true } };

    it('pauses a destructive command until the user answers, then runs it', async () => {
      const asked: Array<{ handle: string; questions: unknown }> = [];
      const { canUseTool } = await captureOptions(new ClaudeProvider(), {
        ...params,
        onInputRequest: asker(asked),
      });

      let settled = false;
      const pending = canUseTool('Bash', { command: 'rm -rf build' }, { toolUseID: 'c1' })
        .then((r) => { settled = true; return r; });

      await vi.waitFor(() => expect(asked).toHaveLength(1));
      expect(settled).toBe(false); // genuinely parked, not merely logged

      const q = (asked[0].questions as Array<{ question: string }>)[0];
      expect(q.question).toContain('rm -rf build');
      await deliver(asked.map((a) => a.handle), resolveAnswer, { [q.question]: 'Allow once' });
      expect((await pending).behavior).toBe('allow');
    });

    it('refuses it when the user says no', async () => {
      const asked: Array<{ handle: string; questions: unknown }> = [];
      const { canUseTool } = await captureOptions(new ClaudeProvider(), {
        ...params,
        onInputRequest: asker(asked),
      });
      const pending = canUseTool('Bash', { command: 'sudo rm -rf /' }, { toolUseID: 'c2' });
      await vi.waitFor(() => expect(asked).toHaveLength(1));
      const q = (asked[0].questions as Array<{ question: string }>)[0];
      await deliver(asked.map((a) => a.handle), resolveAnswer, { [q.question]: 'Deny' });

      const r = await pending;
      expect(r.behavior).toBe('deny');
      expect(r.message).toMatch(/did not approve/i);
      // The bypass this has to close: don't just try it a different way.
      expect(r.message).toMatch(/another way/i);
    });

    it('never prompts for an ordinary command', async () => {
      const onInputRequest = vi.fn().mockResolvedValue(undefined);
      const { canUseTool } = await captureOptions(new ClaudeProvider(), { ...params, onInputRequest });
      for (const command of ['npm test', 'ls -la', 'git status']) {
        expect((await canUseTool('Bash', { command }, { toolUseID: command })).behavior).toBe('allow');
      }
      expect(onInputRequest).not.toHaveBeenCalled();
    });

    it('remembers a refusal PER COMMAND, not per tool', async () => {
      const asked: Array<{ handle: string; questions: unknown }> = [];
      const { canUseTool } = await captureOptions(new ClaudeProvider(), {
        ...params,
        onInputRequest: asker(asked),
      });
      const pending = canUseTool('Bash', { command: 'rm -rf build' }, { toolUseID: 'r1' });
      await vi.waitFor(() => expect(asked).toHaveLength(1));
      const q = (asked[0].questions as Array<{ question: string }>)[0];
      await deliver(asked.map((a) => a.handle), resolveAnswer, { [q.question]: 'Deny' });
      await pending;

      // Same command again: refused without re-asking, so a model that keeps
      // retrying cannot pester the user into clicking Allow.
      const again = await canUseTool('Bash', { command: 'rm -rf build' }, { toolUseID: 'r2' });
      expect(again.behavior).toBe('deny');
      expect(again.message).toMatch(/already declined/i);
      expect(asked).toHaveLength(1);

      // A DIFFERENT, harmless command must still work — the MCP gate keys by
      // tool name, which here would have refused every later shell call.
      expect((await canUseTool('Bash', { command: 'npm test' }, { toolUseID: 'r3' })).behavior).toBe('allow');
    });

    it('fails closed on an unattended run, where nobody can be asked', async () => {
      const { canUseTool } = await captureOptions(new ClaudeProvider(), params); // no onInputRequest
      const r = await canUseTool('Bash', { command: 'rm -rf /tmp/x' }, { toolUseID: 'u1' });
      expect(r.behavior).toBe('deny');
      expect(r.message).toMatch(/cannot ask|no interactive client/i);
    });

    it('does nothing when the setting is off', async () => {
      const onInputRequest = vi.fn().mockResolvedValue(undefined);
      const { canUseTool } = await captureOptions(new ClaudeProvider(), {
        chatId: 'regular-chat',
        onInputRequest,
      });
      expect((await canUseTool('Bash', { command: 'rm -rf /' }, { toolUseID: 'off2' })).behavior).toBe('allow');
      expect(onInputRequest).not.toHaveBeenCalled();
    });

    it('is outranked by deniedTools — a disabled shell is not a prompt', async () => {
      const onInputRequest = vi.fn().mockResolvedValue(undefined);
      const { canUseTool } = await captureOptions(new ClaudeProvider(), {
        ...params,
        deniedTools: ['Bash'],
        onInputRequest,
      });
      const r = await canUseTool('Bash', { command: 'rm -rf build' }, { toolUseID: 'd2' });
      expect(r.behavior).toBe('deny');
      expect(r.message).toMatch(/not available in this session/i);
      expect(onInputRequest).not.toHaveBeenCalled();
    });
  });
});

/**
 * WidgetCreate / CronCreate / StandingOrderCreate are in-process MCP tools that
 * only QUEUE — the client-side effect rides out on a chunk emitted after the
 * stream loop. Each returns success to the model the instant it queues, so
 * "Widget X pinned to the Cockpit" is already in the transcript.
 *
 * That flush used to sit inside `try` AFTER the loop, which the abort path never
 * reaches. Press Stop, or let the 90s tool watchdog fire, and the user was left
 * with the model's confirmation and no widget — and nothing anywhere saying why.
 */
describe('queued creations survive an aborted turn', () => {
  /** Drive the SDK so it calls one of the aime server's tools, then aborts. */
  function scriptToolThenAbort(toolName: string, input: Record<string, unknown>) {
    queryMock.mockImplementation((args: { options: Record<string, unknown> }) => {
      const aime = (args.options.mcpServers as Record<string, { tools: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> }>).aime;
      const t = aime.tools.find((x) => x.name === toolName)!;
      return (async function* () {
        await t.handler(input);
        const err = new Error('user pressed Stop');
        err.name = 'AbortError';
        throw err;
      })();
    });
  }

  it('emits widget_create before aborted, not instead of it', async () => {
    scriptToolThenAbort('WidgetCreate', { title: 'Burn-up', recipe: 'count open issues' });
    const chunks = await run(new ClaudeProvider(), {});

    const widget = chunks.find((c) => c.type === 'widget_create');
    expect(widget).toBeDefined();
    expect(widget!.input).toMatchObject({ title: 'Burn-up', recipe: 'count open issues' });
    // Order matters: the client must bank the widget before it tears the turn down.
    expect(chunks.findIndex((c) => c.type === 'widget_create'))
      .toBeLessThan(chunks.findIndex((c) => c.type === 'aborted'));
  });

  it('does the same for a cron job queued before the abort', async () => {
    scriptToolThenAbort('CronCreate', { expression: '0 9 * * *', prompt: 'stand-up' });
    const chunks = await run(new ClaudeProvider(), {});
    expect(chunks.find((c) => c.type === 'cron_create')?.input).toMatchObject({ expression: '0 9 * * *' });
  });

  it('does not double-emit on the normal path', async () => {
    queryMock.mockImplementation((args: { options: Record<string, unknown> }) => {
      const aime = (args.options.mcpServers as Record<string, { tools: Array<{ name: string; handler: (i: unknown) => Promise<unknown> }> }>).aime;
      const t = aime.tools.find((x) => x.name === 'WidgetCreate')!;
      return (async function* () {
        await t.handler({ title: 'Once', recipe: 'r' });
      })();
    });
    const chunks = await run(new ClaudeProvider(), {});
    expect(chunks.filter((c) => c.type === 'widget_create')).toHaveLength(1);
    expect(chunks.at(-1)?.type).toBe('done');
  });
});

describe('canUseTool interception', () => {
  it('denies governed write tools in background runs (incl. MCP-prefixed)', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), { chatId: 'standing-order-42' });

    expect((await canUseTool('Write', { file_path: '/x' }, { toolUseID: 't1' })).behavior).toBe('deny');
    expect((await canUseTool('mcp__slack__slack_post', { text: 'hi' }, { toolUseID: 't2' })).behavior).toBe('deny');
    expect((await canUseTool('Read', { file_path: '/x' }, { toolUseID: 't3' })).behavior).toBe('allow');
  });

  it('allows write tools in interactive runs', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), { chatId: 'regular-chat' });
    expect((await canUseTool('Write', { file_path: '/x' }, { toolUseID: 't1' })).behavior).toBe('allow');
  });

  it('background runs allow read-only bash but pause acting bash (C3)', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), { chatId: 'standing-order-42' });
    expect((await canUseTool('Bash', { command: 'git status' }, { toolUseID: 't1' })).behavior).toBe('allow');
    expect((await canUseTool('Bash', { command: 'rm -rf /tmp/x' }, { toolUseID: 't2' })).behavior).toBe('deny');
  });

  // The old list let any NEW connector tool sail through ungoverned.
  it('background runs fail closed on unknown MCP tools', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), { chatId: 'hb-7' });
    expect((await canUseTool('mcp__custom__doTheThing', {}, { toolUseID: 't1' })).behavior).toBe('deny');
  });

  it('background runs still allow in-app orchestration (CronCreate, TodoWrite)', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), { chatId: 'standing-order-42' });
    expect((await canUseTool('TodoWrite', { todos: [] }, { toolUseID: 't1' })).behavior).toBe('allow');
    // CronCreate is intercepted (allow + queued) further down the chain
    expect((await canUseTool('CronCreate', { expression: '0 9 * * *', prompt: 'x' }, { toolUseID: 't2' })).behavior).toBe('allow');
  });

  it('an explicit approvalPolicy overrides the background inference', async () => {
    // 'never' on a background chatId: the goal owner opted in to unattended writes.
    const relaxed = await captureOptions(new ClaudeProvider(), { chatId: 'standing-order-42', approvalPolicy: 'never' });
    expect((await relaxed.canUseTool('Write', { file_path: '/x' }, { toolUseID: 't1' })).behavior).toBe('allow');

    // 'always' on an interactive chatId: even in-app actions pause.
    const strict = await captureOptions(new ClaudeProvider(), { chatId: 'regular-chat', approvalPolicy: 'always' });
    expect((await strict.canUseTool('TodoWrite', { todos: [] }, { toolUseID: 't2' })).behavior).toBe('deny');
    expect((await strict.canUseTool('Read', { file_path: '/x' }, { toolUseID: 't3' })).behavior).toBe('allow');
  });

  // The old message claimed "an approval card has been created" — false.
  it('the deny message promises nothing that does not exist', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), { chatId: 'standing-order-42' });
    const denied = await canUseTool('Write', { file_path: '/x' }, { toolUseID: 't1' });
    expect(denied.message).not.toMatch(/card has been created/i);
    expect(denied.message).toMatch(/unattended/i);
  });

  it('denies the 5th consecutive identical tool call (loop detection)', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {});
    const input = { file_path: '/same.md' };

    for (let i = 0; i < 4; i++) {
      expect((await canUseTool('Read', input, { toolUseID: `t${i}` })).behavior).toBe('allow');
    }
    const fifth = await canUseTool('Read', input, { toolUseID: 't5' });
    expect(fifth.behavior).toBe('deny');
    expect(fifth.message).toContain('loop');
  });

  it('resets the loop counter when the input changes', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {});

    for (let i = 0; i < 4; i++) {
      await canUseTool('Read', { file_path: '/same.md' }, { toolUseID: `t${i}` });
    }
    await canUseTool('Read', { file_path: '/other.md' }, { toolUseID: 'break' });
    const next = await canUseTool('Read', { file_path: '/same.md' }, { toolUseID: 'fresh' });
    expect(next.behavior).toBe('allow');
  });

  // ── RequestConnector (P3.3) ──────────────────────────────────────────
  // The agent needs a service mid-task. The turn must PAUSE until the user
  // answers, then resume carrying the outcome — that pause is the whole point,
  // so it is asserted by observing that canUseTool has not settled.
  it('pauses the turn on RequestConnector and resumes with the outcome', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const requested: Array<{ toolUseId: string; connectorId: string; reason: string }> = [];
    const onConnectorRequest = async (toolUseId: string, connectorId: string, reason: string) => {
      requested.push({ toolUseId, connectorId, reason });
    };

    const { canUseTool } = await captureOptions(new ClaudeProvider(), { onConnectorRequest });

    let settled = false;
    const pending = canUseTool(
      'mcp__aime__RequestConnector',
      { connectorId: 'atlassian', reason: 'to file the ticket' },
      { toolUseID: 'rc-1' },
    ).then((r) => {
      settled = true;
      return r;
    });

    // the card has been pushed to the client...
    await vi.waitFor(() => expect(requested).toHaveLength(1));
    expect(requested[0]).toMatchObject({
      connectorId: 'atlassian',
      reason: 'to file the ticket',
    });
    // The relayed id is a nonce derived from the tool call, not the tool call's
    // own id — see the note on `deliver`.
    expect(requested[0].toolUseId).toMatch(/^rc-1\.[0-9a-f-]{36}$/);
    // ...and the agent is still waiting
    expect(settled).toBe(false);

    await deliver(
      requested.map((r) => r.toolUseId),
      resolveConnectorRequest,
      { connected: true },
    );
    const result = await pending;
    expect(result.behavior).toBe('allow');
    // Deliberately NOT asserting updatedInput: the outcome cannot travel that way
    // through an MCP tool's schema. Delivery is asserted against the real handler
    // in "RequestConnector — the OUTCOME reaches the model".
  });

  it('resumes with the decline reason so the agent can adapt', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const issued: string[] = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      onConnectorRequest: recordHandle(issued),
    });

    const pending = canUseTool('RequestConnector', { connectorId: 'github', reason: 'r' }, { toolUseID: 'rc-2' });
    await deliver(issued, resolveConnectorRequest, { connected: false, reason: 'declined' });

    // The call completes rather than hanging; the reason reaching the model is
    // asserted at the handler.
    expect((await pending).behavior).toBe('allow');
  });

  it('does not pause on a request with no connector id', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      onConnectorRequest: async () => {},
    });
    // Nothing would ever resolve this, so it must return immediately rather than
    // blocking for the five-minute timeout.
    const result = await canUseTool('RequestConnector', { reason: 'r' }, { toolUseID: 'rc-3' });
    expect(result.behavior).toBe('allow');
  });

  it('passes RequestConnector straight through when the surface cannot show a card', async () => {
    // No onConnectorRequest callback ⇒ no UI ⇒ must not block forever.
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {});
    const result = await canUseTool('RequestConnector', { connectorId: 'github', reason: 'r' }, { toolUseID: 'rc-4' });
    expect(result.behavior).toBe('allow');
  });

  it('queues CronCreate calls and emits deduplicated cron_create events after the stream', async () => {
    queryMock.mockImplementation(async function* (args: { options: { canUseTool: CanUseTool } }) {
      await args.options.canUseTool('CronCreate', { expression: '*/5 * * * *', prompt: 'poll' }, { toolUseID: 'c1' });
      await args.options.canUseTool('CronCreate', { expression: '*/5 * * * *', prompt: 'poll' }, { toolUseID: 'c2' });
    });
    const chunks = await run(new ClaudeProvider(), {});

    const cronEvents = chunks.filter((c) => c.type === 'cron_create');
    expect(cronEvents).toHaveLength(1);
    expect(cronEvents[0].input).toMatchObject({ expression: '*/5 * * * *', prompt: 'poll', surfaceId: 'cowork' });
  });

  it('resolves AskUserQuestion via the pending-questions bridge', async () => {
    const issued: string[] = [];
    const onInputRequest = vi.fn(async (handle: string) => { issued.push(handle); });
    const { canUseTool } = await captureOptions(new ClaudeProvider(), { onInputRequest });

    const pending = canUseTool('AskUserQuestion', { questions: ['pick one'] }, { toolUseID: 'q1' });
    await vi.waitFor(() =>
      expect(onInputRequest).toHaveBeenCalledWith(expect.stringMatching(/^q1\./), ['pick one']),
    );
    await deliver(issued, resolveAnswer, { choice: 'A' });

    const result = await pending;
    expect(result.behavior).toBe('allow');
    expect(result.updatedInput?.answers).toEqual({ choice: 'A' });
  });

  it('injects sub-agent output for spawn_agent via the subagent API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, output: 'sub-agent said hi' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { canUseTool } = await captureOptions(new ClaudeProvider(), { chatId: 'parent1' });
    const result = await canUseTool('spawn_agent', { task: 'research things' }, { toolUseID: 's1' });

    expect(result.behavior).toBe('allow');
    expect(result.updatedInput?.__spawn_agent_output).toBe('sub-agent said hi');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ parentChatId: 'parent1', task: 'research things' });
  });

  it('reports spawn_agent transport failures in the tool input instead of crashing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { canUseTool } = await captureOptions(new ClaudeProvider(), {});
    const result = await canUseTool('spawn_agent', { task: 'x' }, { toolUseID: 's1' });

    expect(result.behavior).toBe('allow');
    expect(result.updatedInput?.__spawn_agent_output).toContain('Failed to spawn');
  });
});

describe('abort bookkeeping', () => {
  it('abort() returns false when no query is active', () => {
    expect(new ClaudeProvider().abort('nope')).toBe(false);
  });

  it('uses composite surface:chat abort keys', () => {
    const provider = new ClaudeProvider();
    expect(provider.getAbortKey('c1', 'chat')).toBe('chat:c1');
    expect(provider.getAbortKey('c1')).toBe('c1');
  });
});

describe('SkillCreate tool (P3.7)', () => {
  /**
   * The handler writes a real SKILL.md, so these tests give it a real temp HOME
   * and read the file back. Mocking fs would only prove the handler calls write.
   */
  let homeDir: string;
  let skillsDir: string;

  /** Reach the tool the provider registered on its in-process MCP server. */
  async function skillCreateHandler() {
    await run(new ClaudeProvider(), {});
    const options = queryMock.mock.calls.at(-1)![0] as {
      options: { mcpServers: Record<string, { tools?: Array<{ name: string; handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }> }> };
    };
    const tool = options.options.mcpServers.aime.tools!.find((t) => t.name === 'SkillCreate');
    if (!tool) throw new Error('SkillCreate not registered');
    return tool.handler;
  }

  beforeEach(async () => {
    const fsp = await import('fs/promises');
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aime-skill-'));
    skillsDir = path.join(homeDir, '.claude', 'skills');
    homeRef.value = homeDir;
    scriptChunks([]);
  });

  afterEach(async () => {
    homeRef.value = null;
    const fsp = await import('fs/promises');
    await fsp.rm(homeDir, { recursive: true, force: true });
  });

  const readSkill = async (slug: string) => {
    const fsp = await import('fs/promises');
    return fsp.readFile(path.join(skillsDir, slug, 'SKILL.md'), 'utf-8');
  };

  it('writes a parseable SKILL.md and reports the slug back to the model', async () => {
    const handler = await skillCreateHandler();
    const result = await handler({
      name: 'Weekly Board Pack',
      description: 'Compiles the weekly board pack',
      body: '# Steps\n\n1. Pull the metrics\n2. Draft the summary\n',
    });

    expect(result.content[0].text).toContain('weekly-board-pack');

    const { parseSkillMd } = await import('../skill-parser');
    const parsed = parseSkillMd(await readSkill('weekly-board-pack'));
    expect(parsed.frontmatter.name).toBe('Weekly Board Pack');
    expect(parsed.frontmatter.description).toBe('Compiles the weekly board pack');
    expect(parsed.body).toContain('Pull the metrics');
  });

  it('carries argumentHint and allowedTools through', async () => {
    const handler = await skillCreateHandler();
    await handler({
      name: 'Report',
      description: 'd',
      body: 'b',
      argumentHint: '<month>',
      allowedTools: ['Read', 'Grep'],
    });

    const { parseSkillMd } = await import('../skill-parser');
    const parsed = parseSkillMd(await readSkill('report'));
    expect(parsed.frontmatter['argument-hint']).toBe('<month>');
    expect(parsed.frontmatter['allowed-tools']).toEqual(['Read', 'Grep']);
  });

  it('refuses to clobber an existing skill', async () => {
    const handler = await skillCreateHandler();
    await handler({ name: 'Report', description: 'first', body: 'original body' });
    const second = await handler({ name: 'Report', description: 'second', body: 'replacement' });

    expect(second.content[0].text).toMatch(/already exists/i);
    // the original survives — losing the user's work silently would be the worst
    // possible outcome here
    expect(await readSkill('report')).toContain('original body');
  });

  it('does not write outside the skills directory', async () => {
    const handler = await skillCreateHandler();
    const result = await handler({ name: '../../../evil', description: 'd', body: 'b' });

    // slugify flattens it to a harmless single segment
    expect(result.content[0].text).toContain('evil');
    const fsp = await import('fs/promises');
    const entries = await fsp.readdir(skillsDir);
    expect(entries).toEqual(['evil']);
  });

  it('reports a name with nothing usable rather than creating a junk folder', async () => {
    const handler = await skillCreateHandler();
    const result = await handler({ name: '...', description: 'd', body: 'b' });

    expect(result.content[0].text).toMatch(/Could not save the skill/);
    const fsp = await import('fs/promises');
    await expect(fsp.readdir(skillsDir)).rejects.toThrow();
  });

  it('is allowlisted on the surfaces that can show the result', async () => {
    const { getSurfaceConfig } = await import('../surfaces');
    for (const surface of ['chat', 'cowork']) {
      expect(getSurfaceConfig(surface).allowedTools).toContain('mcp__aime__SkillCreate');
    }
  });
});

describe('VoiceProfileSave tool (P4)', () => {
  let homeDir: string;

  async function handlerFor(name: string) {
    await run(new ClaudeProvider(), {});
    const captured = queryMock.mock.calls.at(-1)![0] as {
      options: { mcpServers: Record<string, { tools?: Array<{ name: string; handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }> }> };
    };
    const tool = captured.options.mcpServers.aime.tools!.find((t) => t.name === name);
    if (!tool) throw new Error(`${name} not registered`);
    return tool.handler;
  }

  beforeEach(async () => {
    const fsp = await import('fs/promises');
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aime-voice-tool-'));
    homeRef.value = homeDir;
    scriptChunks([]);
  });

  afterEach(async () => {
    homeRef.value = null;
    const fsp = await import('fs/promises');
    await fsp.rm(homeDir, { recursive: true, force: true });
  });

  const readVoice = async () => {
    const fsp = await import('fs/promises');
    return fsp.readFile(path.join(homeDir, '.claude', 'VOICE.md'), 'utf-8');
  };

  it('writes a VOICE.md that the parser reads back', async () => {
    const handler = await handlerFor('VoiceProfileSave');
    const result = await handler({
      tone: 'Dry and direct.',
      sentenceRhythm: 'Short, 10-14 words.',
      avoid: 'Semicolons.',
    });

    expect(result.content[0].text).toMatch(/Saved the writing voice/);

    const { parseVoiceProfile } = await import('../identity/voice');
    expect(parseVoiceProfile(await readVoice())).toEqual({
      tone: 'Dry and direct.',
      'sentence-rhythm': 'Short, 10-14 words.',
      avoid: 'Semicolons.',
    });
  });

  it('saves nothing when every field is blank, and says so', async () => {
    const handler = await handlerFor('VoiceProfileSave');
    const result = await handler({ tone: '   ', avoid: '' });

    expect(result.content[0].text).toMatch(/Nothing was saved/);
    const fsp = await import('fs/promises');
    await expect(fsp.readFile(path.join(homeDir, '.claude', 'VOICE.md'), 'utf-8')).rejects.toThrow();
  });

  it('ignores non-string field values rather than writing them', async () => {
    const handler = await handlerFor('VoiceProfileSave');
    const result = await handler({ tone: 'Dry.', vocabulary: 42, structure: null });

    const { parseVoiceProfile } = await import('../identity/voice');
    expect(parseVoiceProfile(await readVoice())).toEqual({ tone: 'Dry.' });
    expect(result.content[0].text).toContain('tone');
  });

  it('replaces a previous voice rather than appending to it', async () => {
    const handler = await handlerFor('VoiceProfileSave');
    await handler({ tone: 'Formal.' });
    await handler({ tone: 'Casual.' });

    const md = await readVoice();
    expect(md).toContain('Casual.');
    expect(md).not.toContain('Formal.');
  });

  it('is allowlisted, and the surface prompt tells the agent it exists', async () => {
    const { getSurfaceConfig } = await import('../surfaces');
    for (const surface of ['chat', 'cowork']) {
      const config = getSurfaceConfig(surface);
      expect(config.allowedTools).toContain('mcp__aime__VoiceProfileSave');
      expect(config.systemPrompt as string).toContain('VoiceProfileSave');
    }
  });
});

describe('DocumentCreate tool (P4.2)', () => {
  /**
   * The tool writes a real file, so it gets a real temp cwd.
   *
   * PDF printing is NOT exercised: the Next server is a child process of Electron
   * and cannot call ipcMain, so no print bridge is installed yet (the main-side
   * printToPDF handler exists and is reached in a later increment). These tests
   * therefore pin the path that runs TODAY — themed HTML plus a message that says
   * so rather than implying a PDF exists.
   */
  let workDir: string;

  async function documentHandler(params: Partial<QueryParams> = {}) {
    await run(new ClaudeProvider(), { cwd: workDir, ...params });
    const captured = queryMock.mock.calls.at(-1)![0] as {
      options: { mcpServers: Record<string, { tools?: Array<{ name: string; description: string; handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }> }> };
    };
    const tool = captured.options.mcpServers.aime.tools!.find((t) => t.name === 'DocumentCreate');
    if (!tool) throw new Error('DocumentCreate not registered');
    return tool;
  }

  beforeEach(async () => {
    const fsp = await import('fs/promises');
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aime-doc-'));
    scriptChunks([]);
  });

  afterEach(async () => {
    const fsp = await import('fs/promises');
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  it('writes themed HTML and reports the path', async () => {
    const tool = await documentHandler();
    const result = await tool.handler({
      title: 'Q3 Board Pack',
      markdown: '## Summary\n\nRevenue grew.\n',
      theme: 'proposal',
    });

    expect(result.content[0].text).toContain('q3-board-pack.html');

    const fsp = await import('fs/promises');
    const html = await fsp.readFile(path.join(workDir, 'q3-board-pack.html'), 'utf-8');
    expect(html).toContain('<title>Q3 Board Pack</title>');
    expect(html).toContain('Revenue grew.');
    // the proposal theme's margin, proving the theme was applied
    expect(html).toContain('margin: 24mm');
  });

  it('does not claim a PDF exists when no client can print (e.g. a scheduled run)', async () => {
    const tool = await documentHandler();
    const result = await tool.handler({ title: 'R', markdown: 'x' });

    expect(result.content[0].text).not.toContain('.pdf');
    expect(result.content[0].text).toMatch(/needs the desktop app/);
  });

  it('neutralises markup in the document body', async () => {
    const tool = await documentHandler();
    await tool.handler({ title: 'R', markdown: '<script>alert(1)</script>' });

    const fsp = await import('fs/promises');
    const html = await fsp.readFile(path.join(workDir, 'r.html'), 'utf-8');
    expect(html.slice(html.indexOf('<body>'))).not.toContain('<script');
  });

  it('refuses a title with no usable filename rather than writing junk', async () => {
    const tool = await documentHandler();
    const result = await tool.handler({ title: '...', markdown: 'x' });
    expect(result.content[0].text).toMatch(/Could not create the document/);
  });

  it('lists the available themes in its description, so the model can choose', async () => {
    const tool = await documentHandler();
    for (const id of ['report', 'memo', 'proposal', 'plain']) {
      expect(tool.description, id).toContain(`"${id}"`);
    }
  });

  it('is allowlisted on the surfaces that produce deliverables', async () => {
    const { getSurfaceConfig } = await import('../surfaces');
    for (const surface of ['chat', 'cowork']) {
      expect(getSurfaceConfig(surface).allowedTools).toContain('mcp__aime__DocumentCreate');
    }
  });
});

describe('DocumentCreate — the print hop (P4.2b)', () => {
  /**
   * The server cannot call ipcMain, so printing is relayed through the client.
   * These assert the hop: the request goes out, the turn WAITS, and the reported
   * outcome reaches the model.
   */
  let workDir: string;

  async function toolWith(onDocumentPrint?: QueryParams['onDocumentPrint']) {
    await run(new ClaudeProvider(), { cwd: workDir, onDocumentPrint });
    const captured = queryMock.mock.calls.at(-1)![0] as {
      options: { mcpServers: Record<string, { tools?: Array<{ name: string; handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }> }> };
    };
    return captured.options.mcpServers.aime.tools!.find((t) => t.name === 'DocumentCreate')!.handler;
  }

  beforeEach(async () => {
    const fsp = await import('fs/promises');
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aime-dochop-'));
    scriptChunks([]);
  });

  afterEach(async () => {
    const fsp = await import('fs/promises');
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  it('asks the client to print, waits, and reports the PDF', async () => {
    const { resolveDocumentPrint } = await import('../pending-documents');
    const fsp = await import('fs/promises');
    const requests: Array<{ toolUseId: string; outputPath: string }> = [];

    const handler = await toolWith(async (toolUseId, payload) => {
      requests.push({ toolUseId, outputPath: payload.outputPath });
      // Stand in for the client round trip. It has to actually WRITE the file:
      // the tool no longer takes a reported success on trust (see the
      // "only reported if it exists" regression suite below).
      await fsp.writeFile(payload.outputPath, '%PDF-1.4 stand-in bytes', 'utf-8');
      setTimeout(() => resolveDocumentPrint(toolUseId, { ok: true, bytes: 1234 }), 0);
    });

    const result = await handler({ title: 'Report', markdown: '# Hi' });

    expect(requests).toHaveLength(1);
    expect(requests[0].outputPath).toBe(path.join(workDir, 'report.pdf'));
    expect(result.content[0].text).toContain('report.pdf');
    expect(result.content[0].text).toContain('PDF');
  });

  it('sends the theme-derived print options, not defaults', async () => {
    const { resolveDocumentPrint } = await import('../pending-documents');
    let sent: Record<string, unknown> | null = null;

    const handler = await toolWith(async (toolUseId, payload) => {
      sent = payload.printOptions;
      setTimeout(() => resolveDocumentPrint(toolUseId, { ok: true }), 0);
    });
    await handler({ title: 'R', markdown: 'x', theme: 'proposal' });

    // 24mm margins in inches — proving the theme reached Chromium's options.
    expect(sent).toMatchObject({ pageSize: 'A4', printBackground: true });
    expect((sent as unknown as { margins: { top: number } }).margins.top).toBeCloseTo(24 / 25.4, 5);
  });

  it('reports the HTML outcome when printing fails, without claiming a PDF', async () => {
    const { resolveDocumentPrint } = await import('../pending-documents');
    const handler = await toolWith(async (toolUseId) => {
      setTimeout(() => resolveDocumentPrint(toolUseId, { ok: false, error: 'no chromium' }), 0);
    });

    const result = await handler({ title: 'R', markdown: 'x' });
    expect(result.content[0].text).toContain('no chromium');
    expect(result.content[0].text).not.toContain('r.pdf');
    // the HTML is still there and still said to be usable
    expect(result.content[0].text).toContain('r.html');
  });

  it('still writes the HTML before printing is attempted', async () => {
    const { resolveDocumentPrint } = await import('../pending-documents');
    const fsp = await import('fs/promises');
    const handler = await toolWith(async (toolUseId) => {
      // The HTML must already exist by the time the print request goes out, so a
      // crashed client cannot lose the document.
      await expect(fsp.access(path.join(workDir, 'r.html'))).resolves.toBeUndefined();
      setTimeout(() => resolveDocumentPrint(toolUseId, { ok: false }), 0);
    });
    await handler({ title: 'R', markdown: 'x' });
  });
});

describe('RequestConnector — the OUTCOME reaches the model (regression)', () => {
  /**
   * The bug this exists for: the outcome was passed via `updatedInput`, but
   * RequestConnector is an in-process MCP tool, so the SDK zod-parses its args and
   * strips unknown keys before the handler runs. Every connect — including a
   * successful one — reported "Not connected", and the success branch was
   * unreachable.
   *
   * The old tests asserted `canUseTool`'s returned `updatedInput` and never
   * invoked the handler, so they passed against completely broken behaviour. These
   * drive canUseTool AND then the real handler, which is the only arrangement that
   * can catch it.
   */
  /** Handles the provider relayed to "the client" — see the note on `deliver`. */
  let issued: string[] = [];

  async function capture() {
    await run(new ClaudeProvider(), { onConnectorRequest: recordHandle(issued) });
    const call = queryMock.mock.calls.at(-1)![0] as {
      options: {
        canUseTool: CanUseTool;
        mcpServers: Record<string, { tools?: Array<{ name: string; handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }> }>;
      };
    };
    const tool = call.options.mcpServers.aime.tools!.find((t) => t.name === 'RequestConnector')!;
    return { canUseTool: call.options.canUseTool, handler: tool.handler };
  }

  beforeEach(() => {
    issued = [];
    scriptChunks([]);
  });

  it('reports success after the user connects', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const { canUseTool, handler } = await capture();

    const pending = canUseTool(
      'mcp__aime__RequestConnector',
      { connectorId: 'atlassian', reason: 'to file the ticket' },
      { toolUseID: 'rc-ok' },
    );
    await deliver(issued, resolveConnectorRequest, { connected: true });
    await pending;

    // The handler receives only what the schema allows — connectorId and reason.
    const result = await handler({ connectorId: 'atlassian', reason: 'to file the ticket' });
    expect(result.content[0].text).toContain('now connected');
  });

  it('tells the agent the tools are NOT usable this turn', async () => {
    // mcpServers is fixed when the request starts, so the newly connected server
    // does not exist in this session. "Retry the step" would aim at a missing tool.
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const { canUseTool, handler } = await capture();

    const pending = canUseTool('RequestConnector', { connectorId: 'miro', reason: 'r' }, { toolUseID: 'rc-turn' });
    await deliver(issued, resolveConnectorRequest, { connected: true });
    await pending;

    const text = (await handler({ connectorId: 'miro', reason: 'r' })).content[0].text;
    expect(text).toMatch(/NOT available in this/i);
    expect(text).toMatch(/send another message/i);
    expect(text).not.toMatch(/retry the step/i);
  });

  it('reports the decline reason', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const { canUseTool, handler } = await capture();

    const pending = canUseTool('RequestConnector', { connectorId: 'github', reason: 'r' }, { toolUseID: 'rc-no' });
    await deliver(issued, resolveConnectorRequest, { connected: false, reason: 'user declined' });
    await pending;

    const text = (await handler({ connectorId: 'github', reason: 'r' })).content[0].text;
    expect(text).toContain('Not connected');
    expect(text).toContain('user declined');
  });

  it('reports not-connected when no request was ever made for that id', async () => {
    const { handler } = await capture();
    const text = (await handler({ connectorId: 'never-asked', reason: 'r' })).content[0].text;
    expect(text).toContain('Not connected');
  });

  it('keeps outcomes per connector, so two requests do not cross', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const { canUseTool, handler } = await capture();

    const a = canUseTool('RequestConnector', { connectorId: 'figma', reason: 'r' }, { toolUseID: 'rc-a' });
    await deliver(issued, resolveConnectorRequest, { connected: true });
    await a;
    const b = canUseTool('RequestConnector', { connectorId: 'slack', reason: 'r' }, { toolUseID: 'rc-b' });
    await deliver(issued, resolveConnectorRequest, { connected: false, reason: 'nope' });
    await b;

    expect((await handler({ connectorId: 'figma', reason: 'r' })).content[0].text).toContain('now connected');
    expect((await handler({ connectorId: 'slack', reason: 'r' })).content[0].text).toContain('nope');
  });
});

describe('DocumentCreate — refuses to overwrite (regression)', () => {
  /**
   * It wrote blindly. Chat sends no cwd, so the target is ~/Documents: a document
   * titled "Report" destroyed an existing Report.pdf with no warning, and in cowork
   * a title of "Index" overwrote index.html in the project folder. SkillCreate in
   * the same file already refused for exactly this reason.
   */
  let workDir: string;

  async function handler() {
    await run(new ClaudeProvider(), { cwd: workDir });
    const captured = queryMock.mock.calls.at(-1)![0] as {
      options: { mcpServers: Record<string, { tools?: Array<{ name: string; handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }> }> };
    };
    return captured.options.mcpServers.aime.tools!.find((t) => t.name === 'DocumentCreate')!.handler;
  }

  beforeEach(async () => {
    const fsp = await import('fs/promises');
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aime-doc-overwrite-'));
    scriptChunks([]);
  });

  afterEach(async () => {
    const fsp = await import('fs/promises');
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  it('refuses when the html already exists, and leaves it untouched', async () => {
    const fsp = await import('fs/promises');
    await fsp.writeFile(path.join(workDir, 'report.html'), 'PRECIOUS', 'utf-8');

    const result = await (await handler())({ title: 'Report', markdown: 'new content' });

    expect(result.content[0].text).toMatch(/already exists/);
    expect(await fsp.readFile(path.join(workDir, 'report.html'), 'utf-8')).toBe('PRECIOUS');
  });

  it('refuses when only the PDF exists — that is the file a user would mourn', async () => {
    const fsp = await import('fs/promises');
    await fsp.writeFile(path.join(workDir, 'report.pdf'), 'PDFBYTES', 'utf-8');

    const result = await (await handler())({ title: 'Report', markdown: 'x' });
    expect(result.content[0].text).toMatch(/already exists/);
    // and it did not write the html either, so the pair stays consistent
    await expect(fsp.access(path.join(workDir, 'report.html'))).rejects.toThrow();
  });

  it('tells the agent what to do rather than just failing', async () => {
    const fsp = await import('fs/promises');
    await fsp.writeFile(path.join(workDir, 'report.html'), 'x', 'utf-8');
    const result = await (await handler())({ title: 'Report', markdown: 'x' });
    expect(result.content[0].text).toMatch(/different title|whether to replace/);
  });

  it('still writes when nothing is in the way', async () => {
    const result = await (await handler())({ title: 'Fresh Report', markdown: '## Hi' });
    expect(result.content[0].text).toContain('fresh-report.html');
  });
});

/**
 * Per-tool MCP approval gate (P3.6b, made enforceable).
 *
 * P3.5/P3.6b built `permission_policy: 'always_ask'` and pushed it into the SDK
 * config — where `permissionMode: 'bypassPermissions'` plus
 * `allowDangerouslySkipPermissions` turns the whole permission machinery off.
 * So on chat and cowork, the exact surfaces the feature was written for, an
 * `always_ask` tool executed with no prompt: identical to pre-P3.6b behaviour,
 * while the load-time log certified that N tools "require approval".
 *
 * These tests assert on the REAL canUseTool the provider hands the SDK, because
 * that is the only hook that runs regardless of permissionMode.
 */
describe('MCP per-tool approval gate — interactive surfaces', () => {
  /** A remote server as loadProvisionedMcpServers would hand it over. */
  const acme = { 'aime-mcp-acme': { type: 'http', url: 'https://mcp.acme.com/mcp' } };
  /** Stripe from the one-click catalogue — handlesMoney: true. */
  const stripe = { 'aime-mcp-stripe': { type: 'http', url: 'https://mcp.stripe.com' } };

  it('does NOT execute an always_ask MCP tool until the user decides', async () => {
    const asked: Array<{ toolUseId: string; questions: unknown }> = [];
    const onInputRequest = async (toolUseId: string, questions: unknown) => {
      asked.push({ toolUseId, questions });
    };
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      surfaceId: 'chat',
      mcpServers: acme,
      onInputRequest,
    });

    let settled = false;
    const pending = canUseTool(
      'mcp__aime-mcp-acme__deleteIssue',
      { id: 'ACME-1' },
      { toolUseID: 'gate-1' },
    ).then((r) => {
      settled = true;
      return r;
    });

    // the approval card reached the client...
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    // ...and the tool has NOT been allowed to run
    expect(settled).toBe(false);

    const question = (asked[0].questions as Array<{ question: string }>)[0].question;
    await deliver(asked.map((a) => a.toolUseId), resolveAnswer, { [question]: 'Allow once' });
    expect((await pending).behavior).toBe('allow');
  });

  it('denies when the user declines', async () => {
    const asked: Array<{ handle: string; questions: unknown }> = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: acme,
      onInputRequest: async (handle: string, questions: unknown) => { asked.push({ handle, questions }); },
    });

    const pending = canUseTool('mcp__aime-mcp-acme__sendEmail', {}, { toolUseID: 'gate-2' });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    const question = (asked[0].questions as Array<{ question: string }>)[0].question;
    await deliver(asked.map((a) => a.handle), resolveAnswer, { [question]: 'Deny' });

    const result = await pending;
    expect(result.behavior).toBe('deny');
    expect(result.message).toMatch(/did not approve|declined/i);
  });

  it('a create_refund-shaped money tool does not execute unprompted', async () => {
    const asked: Array<{ handle: string; questions: unknown }> = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      surfaceId: 'chat',
      mcpServers: stripe,
      onInputRequest: async (handle: string, questions: unknown) => { asked.push({ handle, questions }); },
    });

    let settled = false;
    const pending = canUseTool(
      'mcp__aime-mcp-stripe__create_refund',
      { charge: 'ch_1', amount: 50_000 },
      { toolUseID: 'money-1' },
    ).then((r) => { settled = true; return r; });

    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(settled).toBe(false);

    const q = (asked[0].questions as Array<{ question: string; options: Array<{ label: string }> }>)[0];
    // A money-moving tool must never be blanket-approved for all future turns.
    expect(q.options.map((o) => o.label)).not.toContain('Always allow');
    expect(q.question).toMatch(/create_refund/);

    await deliver(asked.map((a) => a.handle), resolveAnswer, { [q.question]: 'Deny' });
    expect((await pending).behavior).toBe('deny');
  });

  it('a tool name that impersonates an in-app builtin is still gated', async () => {
    // Any MCP server can name a tool `canvas`, `Task` or `TodoWrite`; the
    // classifier's exact-name table would otherwise hand it always_allow.
    const issued: string[] = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: stripe,
      onInputRequest: recordHandle(issued),
    });

    let settled = false;
    const pending = canUseTool('mcp__aime-mcp-stripe__canvas', {}, { toolUseID: 'imp-1' })
      .then((r) => { settled = true; return r; });
    await vi.waitFor(() => expect(settled).toBe(false));
    await deliver(issued, resolveAnswer, { x: 'Deny' });
    expect((await pending).behavior).toBe('deny');
  });

  it('read-classified MCP tools still run with no prompt (ergonomics)', async () => {
    const onInputRequest = vi.fn().mockResolvedValue(undefined);
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: acme,
      onInputRequest,
    });

    for (const name of ['getIssue', 'listProjects', 'searchIssues']) {
      const r = await canUseTool(`mcp__aime-mcp-acme__${name}`, { q: name }, { toolUseID: `r-${name}` });
      expect(r.behavior, name).toBe('allow');
    }
    expect(onInputRequest).not.toHaveBeenCalled();
  });

  it('built-in tools and the in-process aime server are untouched', async () => {
    const onInputRequest = vi.fn().mockResolvedValue(undefined);
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: acme,
      onInputRequest,
    });

    expect((await canUseTool('Write', { file_path: '/x' }, { toolUseID: 'b1' })).behavior).toBe('allow');
    expect((await canUseTool('Bash', { command: 'rm -rf /tmp/x' }, { toolUseID: 'b2' })).behavior).toBe('allow');
    expect((await canUseTool('mcp__aime__DocumentCreate', { title: 't' }, { toolUseID: 'b3' })).behavior).toBe('allow');
    expect(onInputRequest).not.toHaveBeenCalled();
  });

  it('fails closed when the surface has no way to ask', async () => {
    // No onInputRequest bridge ⇒ nothing can prompt, so an always_ask tool must
    // not run. Allowing it is what the old code did.
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: acme,
    });
    const result = await canUseTool('mcp__aime-mcp-acme__deleteIssue', {}, { toolUseID: 'nb-1' });
    expect(result.behavior).toBe('deny');
    expect(result.message).toMatch(/cannot ask|no way to ask/i);
  });

  it('honours an explicit always_allow policy already on the server entry', async () => {
    const onInputRequest = vi.fn().mockResolvedValue(undefined);
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: {
        'aime-mcp-acme': {
          type: 'http',
          url: 'https://mcp.acme.com/mcp',
          tools: [{ name: 'deleteIssue', permission_policy: 'always_allow' }],
        },
      },
      onInputRequest,
    });
    expect((await canUseTool('mcp__aime-mcp-acme__deleteIssue', {}, { toolUseID: 'e-1' })).behavior).toBe('allow');
    expect(onInputRequest).not.toHaveBeenCalled();
  });

  it('blocks an always_deny tool with no prompt at all', async () => {
    const onInputRequest = vi.fn().mockResolvedValue(undefined);
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: {
        'aime-mcp-acme': {
          type: 'http',
          url: 'https://mcp.acme.com/mcp',
          tools: [{ name: 'deleteIssue', permission_policy: 'always_deny' }],
        },
      },
      onInputRequest,
    });
    const result = await canUseTool('mcp__aime-mcp-acme__deleteIssue', {}, { toolUseID: 'd-1' });
    expect(result.behavior).toBe('deny');
    expect(result.message).toMatch(/blocked/i);
    expect(onInputRequest).not.toHaveBeenCalled();
  });

  it('enforces always_deny in unattended runs too', async () => {
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'standing-order-9',
      mcpServers: {
        'aime-mcp-acme': {
          type: 'http',
          url: 'https://mcp.acme.com/mcp',
          tools: [{ name: 'getIssue', permission_policy: 'always_deny' }],
        },
      },
    });
    // getIssue classifies 'read', so only the user's explicit denial can stop it.
    expect((await canUseTool('mcp__aime-mcp-acme__getIssue', {}, { toolUseID: 'ud-1' })).behavior).toBe('deny');
  });

  it('leaves the unattended path to evaluateApproval, unchanged', async () => {
    const onInputRequest = vi.fn().mockResolvedValue(undefined);
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'standing-order-42',
      mcpServers: acme,
      onInputRequest,
    });

    const denied = await canUseTool('mcp__aime-mcp-acme__deleteIssue', {}, { toolUseID: 'u-1' });
    expect(denied.behavior).toBe('deny');
    expect(denied.message).toMatch(/unattended/i);
    // An unattended run must never sit waiting for a human.
    expect(onInputRequest).not.toHaveBeenCalled();
    expect((await canUseTool('mcp__aime-mcp-acme__getIssue', {}, { toolUseID: 'u-2' })).behavior).toBe('allow');
  });

  it('denies rather than running when the user never answers', async () => {
    vi.useFakeTimers();
    try {
      const { canUseTool } = await captureOptions(new ClaudeProvider(), {
        chatId: 'regular-chat',
        mcpServers: acme,
        onInputRequest: async () => {},
      });
      const pending = canUseTool('mcp__aime-mcp-acme__deleteIssue', {}, { toolUseID: 'to-1' });
      await vi.advanceTimersByTimeAsync(400_000);
      const result = await pending;
      expect(result.behavior).toBe('deny');
      expect(result.message).toMatch(/did not respond|timed out/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-ask after a denial in the same turn', async () => {
    // Loop detection cannot help: a denial returns before the window is touched.
    // Without this an agent could put the same card up until the user gave in.
    const asked: Array<{ handle: string; questions: unknown }> = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: acme,
      onInputRequest: async (handle: string, questions: unknown) => { asked.push({ handle, questions }); },
    });

    const first = canUseTool('mcp__aime-mcp-acme__deleteIssue', {}, { toolUseID: 'n-1' });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await deliver(asked.map((a) => a.handle), resolveAnswer, { x: 'Deny' });
    expect((await first).behavior).toBe('deny');

    // Different input, so loop detection would not catch it either.
    const second = await canUseTool('mcp__aime-mcp-acme__deleteIssue', { id: 2 }, { toolUseID: 'n-2' });
    expect(second.behavior).toBe('deny');
    expect(second.message).toMatch(/already declined/i);
    expect(asked).toHaveLength(1);
  });

  it('does not let the per-tool watchdog abort a turn that is waiting on a human', async () => {
    // activeTools is populated from the tool_use block, so a tool paused for
    // approval looked "hung" and the 90s watchdog aborted the whole query —
    // which would make any gate unanswerable by a user who steps away.
    vi.useFakeTimers();
    try {
      let aborted: boolean | undefined;
      const issued: string[] = [];
      queryMock.mockImplementation(async function* (args: {
        options: { canUseTool: CanUseTool };
        abortSignal: AbortSignal;
      }) {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'w-1', name: 'mcp__aime-mcp-acme__deleteIssue', input: {} },
            ],
          },
        };
        const pending = args.options.canUseTool(
          'mcp__aime-mcp-acme__deleteIssue',
          {},
          { toolUseID: 'w-1' },
        );
        await vi.advanceTimersByTimeAsync(150_000);
        aborted = args.abortSignal.aborted;
        // No vi.waitFor here (fake timers, inside the SDK generator): the 150s
        // advance above has already flushed the relay and parked the wait, and
        // asserting the answer LANDED proves that rather than assuming it.
        expect(resolveAnswer(issued[0], { x: 'Deny' })).toBe(true);
        await pending;
      });

      await run(new ClaudeProvider(), {
        chatId: 'regular-chat',
        mcpServers: acme,
        onInputRequest: recordHandle(issued),
      });
      expect(aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * "Always allow" / "Always deny" must SURVIVE the turn, or the gate is a nag
 * that trains users to click through it. These use a real temp HOME and read
 * the decision file back — the whole point is that it persists.
 *
 * This is also the production writer for BuildPolicyOptions.approved/denied,
 * which previously had none, making always_deny unreachable.
 */
describe('MCP approval gate — remembered decisions', () => {
  let homeDir: string;

  const acme = { 'aime-mcp-acme': { type: 'http', url: 'https://mcp.acme.com/mcp' } };
  const decisionsPath = () => path.join(homeDir, '.claude', '.aime-mcp-decisions.json');

  beforeEach(async () => {
    const fsp = await import('fs/promises');
    homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aime-decisions-'));
    await fsp.mkdir(path.join(homeDir, '.claude'), { recursive: true });
    homeRef.value = homeDir;
    scriptChunks([]);
  });

  afterEach(async () => {
    homeRef.value = null;
    const fsp = await import('fs/promises');
    await fsp.rm(homeDir, { recursive: true, force: true });
  });

  const readDecisions = async () => {
    const fsp = await import('fs/promises');
    return JSON.parse(await fsp.readFile(decisionsPath(), 'utf-8')) as Record<
      string,
      { approved?: string[]; denied?: string[] }
    >;
  };

  it('persists "Always allow" and stops asking for that tool', async () => {
    const asked: Array<{ handle: string; questions: unknown }> = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: acme,
      onInputRequest: async (handle: string, questions: unknown) => { asked.push({ handle, questions }); },
    });

    const pending = canUseTool('mcp__aime-mcp-acme__deleteIssue', {}, { toolUseID: 'aa-1' });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    const q = (asked[0].questions as Array<{ question: string }>)[0].question;
    await deliver(asked.map((a) => a.handle), resolveAnswer, { [q]: 'Always allow' });
    expect((await pending).behavior).toBe('allow');

    await vi.waitFor(async () =>
      expect((await readDecisions())['aime-mcp-acme'].approved).toContain('deleteIssue'),
    );

    // Same session: no second prompt.
    const again = await canUseTool('mcp__aime-mcp-acme__deleteIssue', { n: 2 }, { toolUseID: 'aa-2' });
    expect(again.behavior).toBe('allow');
    expect(asked).toHaveLength(1);
  });

  it('persists "Always deny" and blocks silently from then on', async () => {
    const asked: Array<{ handle: string; questions: unknown }> = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: acme,
      onInputRequest: async (handle: string, questions: unknown) => { asked.push({ handle, questions }); },
    });

    const pending = canUseTool('mcp__aime-mcp-acme__sendEmail', {}, { toolUseID: 'ad-1' });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    const q = (asked[0].questions as Array<{ question: string }>)[0].question;
    await deliver(asked.map((a) => a.handle), resolveAnswer, { [q]: 'Always deny' });
    expect((await pending).behavior).toBe('deny');

    await vi.waitFor(async () =>
      expect((await readDecisions())['aime-mcp-acme'].denied).toContain('sendEmail'),
    );

    const again = await canUseTool('mcp__aime-mcp-acme__sendEmail', { n: 2 }, { toolUseID: 'ad-2' });
    expect(again.behavior).toBe('deny');
    expect(asked).toHaveLength(1);
  });

  it('writes the decision file 0600 — it decides whether a tool runs unasked', async () => {
    const asked: Array<{ handle: string; questions: unknown }> = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: acme,
      onInputRequest: async (handle: string, questions: unknown) => { asked.push({ handle, questions }); },
    });
    const pending = canUseTool('mcp__aime-mcp-acme__deleteIssue', {}, { toolUseID: 'perm-1' });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    await deliver(asked.map((a) => a.handle), resolveAnswer, { x: 'Always allow' });
    await pending;

    const fsp = await import('fs/promises');
    await vi.waitFor(async () => {
      const stat = await fsp.stat(decisionsPath());
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  it('reads a previously stored decision at the start of a new session', async () => {
    const fsp = await import('fs/promises');
    await fsp.writeFile(
      decisionsPath(),
      JSON.stringify({ 'aime-mcp-acme': { denied: ['deleteIssue'], approved: ['sendEmail'] } }),
    );

    const onInputRequest = vi.fn().mockResolvedValue(undefined);
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: acme,
      onInputRequest,
    });

    expect((await canUseTool('mcp__aime-mcp-acme__deleteIssue', {}, { toolUseID: 'p-1' })).behavior).toBe('deny');
    expect((await canUseTool('mcp__aime-mcp-acme__sendEmail', {}, { toolUseID: 'p-2' })).behavior).toBe('allow');
    expect(onInputRequest).not.toHaveBeenCalled();
  });

  it('never remembers a blanket approval for a money-moving tool', async () => {
    const asked: Array<{ handle: string; questions: unknown }> = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: { 'aime-mcp-stripe': { type: 'http', url: 'https://mcp.stripe.com' } },
      onInputRequest: async (handle: string, questions: unknown) => { asked.push({ handle, questions }); },
    });

    const pending = canUseTool('mcp__aime-mcp-stripe__create_refund', {}, { toolUseID: 'm-1' });
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    const q = (asked[0].questions as Array<{ question: string }>)[0].question;
    // Even if the answer claims a blanket approval, it degrades to allow-once.
    await deliver(asked.map((a) => a.handle), resolveAnswer, { [q]: 'Always allow' });
    expect((await pending).behavior).toBe('allow');

    const fsp = await import('fs/promises');
    await expect(fsp.readFile(decisionsPath(), 'utf-8')).rejects.toThrow();

    // ...and the next refund asks again.
    const second = canUseTool('mcp__aime-mcp-stripe__create_refund', { n: 2 }, { toolUseID: 'm-2' });
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    await deliver(asked.map((a) => a.handle), resolveAnswer, { x: 'Deny' });
    expect((await second).behavior).toBe('deny');
  });
});

/**
 * DEFECT 1 (regression): `connectorOutcomes` was keyed by connector id and never
 * deleted — a per-connector last-write-wins slot, one layer above a rendezvous
 * that is correctly keyed by tool-use id. Two RequestConnector blocks for the SAME
 * connector in one turn crossed in BOTH directions against the real canUseTool: a
 * user who CONNECTED was told "Not connected: user declined", and a user who
 * DECLINED was told "slack is now connected".
 *
 * The "at most one per turn" rule was prose in the tool description, enforced
 * nowhere — unlike CronCreate, which has an `alreadyQueued` guard three hundred
 * lines away. The existing cross-talk test used two DIFFERENT connectors, so it
 * passed against the broken behaviour.
 */
describe('RequestConnector — outcomes bound to their own call (regression)', () => {
  /** Handles the provider relayed to "the client" — see the note on `deliver`. */
  let issued: string[] = [];

  async function capture() {
    await run(new ClaudeProvider(), { onConnectorRequest: recordHandle(issued) });
    const call = queryMock.mock.calls.at(-1)![0] as {
      options: {
        canUseTool: CanUseTool;
        mcpServers: Record<string, { tools?: Array<{ name: string; handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }> }>;
      };
    };
    const tool = call.options.mcpServers.aime.tools!.find((t) => t.name === 'RequestConnector')!;
    return { canUseTool: call.options.canUseTool, handler: tool.handler };
  }

  const say = async (
    handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>,
    connectorId: string,
  ) => (await handler({ connectorId, reason: 'r' })).content[0].text;

  beforeEach(() => {
    issued = [];
    scriptChunks([]);
  });

  it('does not tell a user who CONNECTED that they declined', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const { canUseTool, handler } = await capture();

    // Two blocks for the same connector, both dispatched before either is
    // answered — the SDK client demonstrably permits concurrent can_use_tool.
    const first = canUseTool('RequestConnector', { connectorId: 'slack', reason: 'r1' }, { toolUseID: 'x1-a' });
    const second = canUseTool('RequestConnector', { connectorId: 'slack', reason: 'r2' }, { toolUseID: 'x1-b' });

    await deliver(issued, resolveConnectorRequest, { connected: true });
    await first;
    await second;

    const text = await say(handler, 'slack');
    expect(text).toContain('now connected');
    expect(text).not.toContain('Not connected');
  });

  it('does not tell a user who DECLINED that the service is connected', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const { canUseTool, handler } = await capture();

    const first = canUseTool('RequestConnector', { connectorId: 'slack', reason: 'r1' }, { toolUseID: 'x2-a' });
    const second = canUseTool('RequestConnector', { connectorId: 'slack', reason: 'r2' }, { toolUseID: 'x2-b' });

    await deliver(issued, resolveConnectorRequest, { connected: false, reason: 'user declined' });
    await first;
    await second;

    const text = await say(handler, 'slack');
    expect(text).toContain('Not connected');
    expect(text).toContain('user declined');
    expect(text).not.toContain('now connected');
  });

  it('enforces the one-per-connector rule the tool description claims', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const { canUseTool } = await capture();

    const first = canUseTool('RequestConnector', { connectorId: 'github', reason: 'r' }, { toolUseID: 'x3-a' });
    await deliver(issued, resolveConnectorRequest, { connected: true });
    await first;

    const second = await canUseTool('RequestConnector', { connectorId: 'github', reason: 'again' }, { toolUseID: 'x3-b' });
    expect(second.behavior).toBe('deny');
    expect(second.message).toMatch(/already/i);
    // ...and no second card was ever pushed to the user.
  });

  it('consumes the outcome, so a replayed handler call cannot re-report it', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const { canUseTool, handler } = await capture();

    const pending = canUseTool('RequestConnector', { connectorId: 'figma', reason: 'r' }, { toolUseID: 'x4-a' });
    await deliver(issued, resolveConnectorRequest, { connected: true });
    await pending;

    expect(await say(handler, 'figma')).toContain('now connected');
    // A second handler invocation for the same id is not a second connect.
    expect(await say(handler, 'figma')).toContain('Not connected');
  });

  it('still lets the agent ask for a genuinely different service', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const { canUseTool } = await capture();

    const a = canUseTool('RequestConnector', { connectorId: 'figma', reason: 'r' }, { toolUseID: 'x5-a' });
    await deliver(issued, resolveConnectorRequest, { connected: true });
    await a;

    const b = canUseTool('RequestConnector', { connectorId: 'slack', reason: 'r' }, { toolUseID: 'x5-b' });
    await deliver(issued, resolveConnectorRequest, { connected: false, reason: 'nope' });
    expect((await b).behavior).toBe('allow');
  });
});

/**
 * DEFECT (regression): /api/chat/answer and /api/chat/connector-result accept a
 * resolution from anyone who can reach localhost, and nothing tied one to the
 * request that created it. The rendezvous was keyed by the SDK's `toolUseID` —
 * which is relayed to the client, yes, but also written to stdout, to the audit
 * log, and out on the `tool_use` stream event. "Knows the tool use id" was
 * therefore a weak proof of "is the card we sent", and the two things a forged
 * resolution can do are serious: make the model tell the user a service is
 * connected when it is not, and answer the MCP approval gate with "Allow".
 *
 * The key is now minted per request with a nonce in it and travels only on the SSE
 * stream (lib/rendezvous → issueHandle). These tests assert the negative — that
 * the ids an attacker CAN see are refused — which is the whole of the fix.
 */
describe('a resolution must come from the card that was sent (regression)', () => {
  beforeEach(() => scriptChunks([]));

  it('refuses a connector outcome addressed to the SDK tool use id', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const issued: string[] = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      onConnectorRequest: recordHandle(issued),
    });

    const pending = canUseTool(
      'RequestConnector',
      { connectorId: 'slack', reason: 'r' },
      { toolUseID: 'forge-1' },
    );
    await vi.waitFor(() => expect(issued).toHaveLength(1));

    // The tool use id: what a forged POST would carry, and what used to work.
    expect(resolveConnectorRequest('forge-1', { connected: true })).toBe(false);
    // The right shape but the wrong nonce is no better than a guess.
    expect(resolveConnectorRequest(`${issued[0]}0`, { connected: true })).toBe(false);
    expect(resolveConnectorRequest(`forge-1.${'0'.repeat(36)}`, { connected: true })).toBe(false);

    // ...and the real card still gets through, so the gate is not just shut.
    await deliver(issued, resolveConnectorRequest, { connected: false, reason: 'declined' });
    expect((await pending).behavior).toBe('allow');
  });

  it('refuses an answer addressed to the SDK tool use id', async () => {
    const issued: string[] = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      onInputRequest: recordHandle(issued),
    });

    const pending = canUseTool(
      'AskUserQuestion',
      { questions: ['ship it?'] },
      { toolUseID: 'forge-2' },
    );
    await vi.waitFor(() => expect(issued).toHaveLength(1));

    expect(resolveAnswer('forge-2', { 'ship it?': 'yes' })).toBe(false);
    await deliver(issued, resolveAnswer, { 'ship it?': 'no' });
    expect((await pending).updatedInput?.answers).toEqual({ 'ship it?': 'no' });
  });

  it('refuses an approval addressed to the SDK tool use id', async () => {
    const issued: string[] = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      chatId: 'regular-chat',
      mcpServers: { 'aime-mcp-acme': { type: 'http', url: 'https://mcp.acme.com/mcp' } },
      onInputRequest: recordHandle(issued),
    });

    const pending = canUseTool('mcp__aime-mcp-acme__deleteIssue', {}, { toolUseID: 'forge-3' });
    await vi.waitFor(() => expect(issued).toHaveLength(1));

    // An "Allow once" that cannot be shown to have come from the card the user
    // was looking at is not an approval, which is what this gate exists to be.
    expect(resolveAnswer('forge-3', { q: 'Allow once' })).toBe(false);
    await deliver(issued, resolveAnswer, { q: 'Deny' });
    expect((await pending).behavior).toBe('deny');
  });

  it('never issues the same handle twice, even for the same tool use id', async () => {
    const { resolveConnectorRequest } = await import('../pending-connectors');
    const issued: string[] = [];
    const { canUseTool } = await captureOptions(new ClaudeProvider(), {
      onConnectorRequest: recordHandle(issued),
    });

    // Different connectors: the one-per-connector rule refuses a repeat.
    for (const connectorId of ['slack', 'github', 'figma']) {
      const pending = canUseTool('RequestConnector', { connectorId, reason: 'r' }, { toolUseID: 'same' });
      await deliver(issued, resolveConnectorRequest, { connected: false, reason: 'no' });
      await pending;
    }

    expect(issued).toHaveLength(3);
    expect(new Set(issued).size).toBe(3);
    for (const handle of issued) expect(handle).toMatch(/^same\.[0-9a-f-]{36}$/);
  });
});

/**
 * DEFECT 2 (regression): the documented "no connected client" fallback was
 * unreachable on the HTTP path. Printability was decided by `if (!onDocumentPrint)`,
 * but the chat route defines that callback for EVERY request. The webhook route
 * server-side fetches /api/chat/<surface> and never reads response.body, so
 * `document_print` cannot possibly be acted on — and the tool stalled for the full
 * 60s budget and then told the model "PDF rendering timed out.", an invented
 * failure, instead of "PDF rendering needs the desktop app, so only the HTML was
 * written."
 *
 * The precondition is whether anyone is ACTING on the stream, which the callback's
 * existence does not indicate. So silence is now reported as silence.
 */
describe('DocumentCreate — a consumer that ignores the event (regression)', () => {
  let workDir: string;

  async function toolWith(onDocumentPrint?: QueryParams['onDocumentPrint']) {
    await run(new ClaudeProvider(), { cwd: workDir, onDocumentPrint });
    const captured = queryMock.mock.calls.at(-1)![0] as {
      options: { mcpServers: Record<string, { tools?: Array<{ name: string; handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }> }> };
    };
    return captured.options.mcpServers.aime.tools!.find((t) => t.name === 'DocumentCreate')!.handler;
  }

  beforeEach(async () => {
    const fsp = await import('fs/promises');
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aime-docsilence-'));
    scriptChunks([]);
  });

  afterEach(async () => {
    const fsp = await import('fs/promises');
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  it('tells the model the honest truth, not that rendering timed out', async () => {
    const { DOCUMENT_PRINT_TIMEOUT_MS, pendingDocumentCount } = await import('../pending-documents');
    // A consumer that receives document_print and does nothing with it — exactly
    // what the webhook path is.
    const handler = await toolWith(async () => {});

    // Captured BEFORE faking: vi.useFakeTimers() replaces globalThis.setImmediate
    // too, so a tick taken afterwards would never fire and the real fs work below
    // could never complete.
    const realSetImmediate = setImmediate;
    const realTick = () => new Promise((resolve) => realSetImmediate(resolve));
    vi.useFakeTimers();
    try {
      const promise = handler({ title: 'Silent', markdown: '# Hi' });
      while (pendingDocumentCount() === 0) await realTick();
      await vi.advanceTimersByTimeAsync(DOCUMENT_PRINT_TIMEOUT_MS + 10);

      const text = (await promise).content[0].text;
      expect(text).toMatch(/needs the desktop app/);
      expect(text).not.toMatch(/timed out/i);
      expect(text).not.toContain('silent.pdf');
      expect(text).toContain('silent.html');
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * DEFECT 3 (regression): /api/chat/document-result is an unauthenticated localhost
 * route that bound nothing to the requester, so any local process could resolve a
 * pending print with `ok: true` and a fabricated `path` — and the model would go on
 * to tell the user about a PDF that does not exist. Whatever one thinks of the
 * attacker model for a desktop app, a fabricated success reaching the model is a
 * correctness problem, so the claim is now checked against the filesystem.
 */
describe('DocumentCreate — a PDF is only reported if it exists (regression)', () => {
  let workDir: string;

  async function toolWith(onDocumentPrint?: QueryParams['onDocumentPrint']) {
    await run(new ClaudeProvider(), { cwd: workDir, onDocumentPrint });
    const captured = queryMock.mock.calls.at(-1)![0] as {
      options: { mcpServers: Record<string, { tools?: Array<{ name: string; handler: (i: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }> }> }> };
    };
    return captured.options.mcpServers.aime.tools!.find((t) => t.name === 'DocumentCreate')!.handler;
  }

  beforeEach(async () => {
    const fsp = await import('fs/promises');
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aime-docfake-'));
    scriptChunks([]);
  });

  afterEach(async () => {
    const fsp = await import('fs/promises');
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  it('does not claim a PDF when the reported success wrote nothing', async () => {
    const { resolveDocumentPrint } = await import('../pending-documents');
    const handler = await toolWith(async (toolUseId) => {
      // A fabricated success: ok, plausible byte count, no file anywhere.
      setTimeout(() => resolveDocumentPrint(toolUseId, { ok: true, bytes: 24_000 }), 0);
    });

    const text = (await handler({ title: 'Ghost', markdown: 'x' })).content[0].text;
    expect(text).not.toContain('ghost.pdf');
    expect(text).toContain('ghost.html');
  });

  it('reports the PDF when one is genuinely on disk', async () => {
    const { resolveDocumentPrint } = await import('../pending-documents');
    const fsp = await import('fs/promises');
    const handler = await toolWith(async (toolUseId, payload) => {
      await fsp.writeFile(payload.outputPath, '%PDF-1.4 real bytes', 'utf-8');
      setTimeout(() => resolveDocumentPrint(toolUseId, { ok: true, bytes: 19 }), 0);
    });

    const text = (await handler({ title: 'Real', markdown: 'x' })).content[0].text;
    expect(text).toContain('real.pdf');
  });

  it('does not believe an empty file either', async () => {
    const { resolveDocumentPrint } = await import('../pending-documents');
    const fsp = await import('fs/promises');
    const handler = await toolWith(async (toolUseId, payload) => {
      await fsp.writeFile(payload.outputPath, '', 'utf-8');
      setTimeout(() => resolveDocumentPrint(toolUseId, { ok: true }), 0);
    });

    const text = (await handler({ title: 'Empty', markdown: 'x' })).content[0].text;
    expect(text).not.toContain('empty.pdf');
    expect(text).toContain('empty.html');
  });
});

/**
 * DEFECT 6 (regression): none of the four rendezvous modules cancelled its entry
 * when the stream aborted, so pressing Stop with a connector card open left a live
 * timer and a captured resolve closure for the full five minutes. The provider is
 * the only place that holds both the query's AbortSignal and the waits, so it has
 * to thread one into the other.
 */
describe('aborting a query cancels its outstanding rendezvous', () => {
  it('frees a pending connector card the moment the user presses Stop', async () => {
    const { pendingConnectorCount } = await import('../pending-connectors');
    const provider = new ClaudeProvider();
    let outcome: { behavior: string } | undefined;

    queryMock.mockImplementation(async function* (args: { options: { canUseTool: CanUseTool } }) {
      const baseline = pendingConnectorCount();
      const pending = args.options.canUseTool(
        'RequestConnector',
        { connectorId: 'slack', reason: 'r' },
        { toolUseID: 'stop-1' },
      );
      await vi.waitFor(() => expect(pendingConnectorCount()).toBe(baseline + 1));

      // What POST /api/abort does.
      expect(provider.abort('stop-chat')).toBe(true);

      outcome = await pending;
      expect(pendingConnectorCount()).toBe(baseline);
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    await run(provider, { chatId: 'stop-chat', onConnectorRequest: async () => {} });
    // The turn unblocks at once rather than five minutes later.
    expect(outcome).toMatchObject({ behavior: 'allow' });
  });

  it('frees a pending document print too', async () => {
    const { pendingDocumentCount, waitForDocumentPrint } = await import('../pending-documents');
    const provider = new ClaudeProvider();
    let result: { ok: boolean } | undefined;

    queryMock.mockImplementation(async function* (args: { abortSignal: AbortSignal }) {
      const baseline = pendingDocumentCount();
      const pending = waitForDocumentPrint('stop-doc-1', { signal: args.abortSignal });
      expect(pendingDocumentCount()).toBe(baseline + 1);
      provider.abort('stop-chat-2');
      result = await pending;
      expect(pendingDocumentCount()).toBe(baseline);
    });

    await run(provider, { chatId: 'stop-chat-2' });
    expect(result).toMatchObject({ ok: false });
  });
});
