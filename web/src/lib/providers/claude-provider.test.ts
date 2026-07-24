import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { ClaudeProvider } from './claude-provider';
import { resolveAnswer } from '../pending-questions';
import type { StreamChunk, QueryParams } from './base-provider';
import type { SessionControls } from '../slash-commands';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

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
    const onInputRequest = vi.fn().mockResolvedValue(undefined);
    const { canUseTool } = await captureOptions(new ClaudeProvider(), { onInputRequest });

    const pending = canUseTool('AskUserQuestion', { questions: ['pick one'] }, { toolUseID: 'q1' });
    // Give canUseTool a tick to register the pending question
    await vi.waitFor(() => expect(onInputRequest).toHaveBeenCalledWith('q1', ['pick one']));
    resolveAnswer('q1', { choice: 'A' });

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
