import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import type { QueryParams, StreamChunk } from '@/lib/providers/base-provider';

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  abortMock: vi.fn(),
  loadAgentsMock: vi.fn(),
  matchAgentMock: vi.fn(),
  readAgentPromptMock: vi.fn(),
  extractMemoriesMock: vi.fn(),
  loadProvisionedMock: vi.fn(),
}));

vi.mock('@/lib/providers', () => ({
  getProvider: () => ({ name: 'claude', query: mocks.queryMock, abort: mocks.abortMock }),
  getAvailableProviders: () => ['claude'],
}));
vi.mock('@/lib/agents-parser', () => ({
  loadAgents: mocks.loadAgentsMock,
  matchAgentForMessage: mocks.matchAgentMock,
  readAgentSystemPrompt: mocks.readAgentPromptMock,
}));
vi.mock('@/lib/memory/extractor', () => ({ extractMemories: mocks.extractMemoriesMock }));
vi.mock('@/lib/mcp/provisioned', () => ({ loadProvisionedMcpServers: mocks.loadProvisionedMock }));

/** Script the provider to yield the given chunks. */
function scriptProvider(chunks: StreamChunk[]) {
  mocks.queryMock.mockImplementation(async function* () {
    for (const c of chunks) yield c;
  });
}

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/chat/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** POST to the route and fully drain the SSE stream into parsed events. */
async function post(surfaceId: string, body: unknown) {
  const res = await POST(makeRequest(body), { params: Promise.resolve({ surfaceId }) });
  if (res.headers.get('Content-Type') !== 'text/event-stream') {
    return { status: res.status, error: (await res.json()).error as string, events: [] as Record<string, unknown>[] };
  }
  const text = await res.text();
  const events = text
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice(6)) as Record<string, unknown>);
  return { status: res.status, error: null, events };
}

/** The QueryParams the route passed to the provider. */
const providerParams = () => mocks.queryMock.mock.calls.at(-1)![0] as QueryParams;
const promptText = () => JSON.stringify(providerParams().systemPrompt);

beforeEach(() => {
  vi.clearAllMocks();
  scriptProvider([]);
  mocks.loadAgentsMock.mockReturnValue([]);
  mocks.matchAgentMock.mockReturnValue(null);
  mocks.readAgentPromptMock.mockReturnValue('');
  mocks.extractMemoriesMock.mockResolvedValue([]);
  mocks.loadProvisionedMock.mockResolvedValue({});
});

describe('request validation', () => {
  it('rejects unknown surfaces', async () => {
    const { status, error } = await post('nonsense', { message: 'hi', chatId: 'c1' });
    expect(status).toBe(400);
    expect(error).toContain('Invalid surface');
  });

  it('rejects malformed JSON', async () => {
    const { status } = await post('chat', 'not json at all');
    expect(status).toBe(400);
  });

  it('requires a string message', async () => {
    expect((await post('chat', { chatId: 'c1' })).status).toBe(400);
    expect((await post('chat', { message: 42, chatId: 'c1' })).status).toBe(400);
  });

  it('enforces size limits', async () => {
    const big = await post('chat', { message: 'x'.repeat(100_001), chatId: 'c1' });
    expect(big.status).toBe(400);
    expect(big.error).toContain('max length');

    const manyAttachments = await post('chat', {
      message: 'hi',
      chatId: 'c1',
      attachments: Array.from({ length: 21 }, (_, i) => ({ name: `f${i}`, content: '', type: 'text/plain', category: 'text' })),
    });
    expect(manyAttachments.status).toBe(400);

    const longHistory = await post('chat', {
      message: 'hi',
      chatId: 'c1',
      history: Array.from({ length: 201 }, () => ({ role: 'user', content: 'x' })),
    });
    expect(longHistory.status).toBe(400);
  });

  it('rejects unknown providers', async () => {
    const { status, error } = await post('chat', { message: 'hi', chatId: 'c1', provider: 'gpt' });
    expect(status).toBe(400);
    expect(error).toContain('Invalid provider');
  });
});

describe('streaming', () => {
  it('emits connected, provider chunks, and a final done with usage', async () => {
    scriptProvider([
      { type: 'text', content: 'Hello there', provider: 'claude' },
      { type: 'tool_use', name: 'Read', input: {}, id: 't1', provider: 'claude' },
    ]);
    const { events } = await post('chat', { message: 'ping', chatId: 'c1' });

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('connected');
    expect(types).toContain('text');
    expect(types).toContain('tool_use');
    expect(types.at(-1)).toBe('done');

    const done = events.at(-1)!;
    const usage = done.usage as Record<string, number>;
    expect(usage.toolCallCount).toBe(1);
    expect(usage.inputTokens).toBe(1); // 'ping' = 4 chars / 4
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sends an error event but still completes with done when the provider throws', async () => {
    mocks.queryMock.mockImplementation(async function* () {
      yield { type: 'text', content: 'partial', provider: 'claude' };
      throw new Error('SDK fell over');
    });
    const { events } = await post('chat', { message: 'hi', chatId: 'c1' });

    const error = events.find((e) => e.type === 'error');
    expect(error?.message).toContain('SDK fell over');
    expect(events.at(-1)?.type).toBe('done'); // stream still terminates cleanly
  });
});

describe('provider parameter assembly', () => {
  it('passes core params through', async () => {
    await post('cowork', { message: 'do work', chatId: 'c9', cwd: '/tmp/proj', model: 'opus' });

    const params = providerParams();
    expect(params.prompt).toBe('do work');
    expect(params.chatId).toBe('c9');
    expect(params.surfaceId).toBe('cowork');
    expect(params.cwd).toBe('/tmp/proj');
    expect(params.model).toBe('opus');
  });

  it('restricts tools to the minimal profile while keeping interaction tools', async () => {
    await post('chat', { message: 'hi', chatId: 'c1', toolProfile: 'minimal' });

    const allowed = providerParams().allowedTools!;
    const permitted = new Set(['WebSearch', 'WebFetch', 'AskUserQuestion', 'Agent', 'TodoWrite']);
    expect(allowed.length).toBeGreaterThan(0);
    for (const tool of allowed) {
      expect(permitted.has(tool), `unexpected tool: ${tool}`).toBe(true);
    }
  });

  it('removes Bash when disableBashTool is set', async () => {
    await post('cowork', { message: 'hi', chatId: 'c1' });
    expect(providerParams().allowedTools).toContain('Bash');

    await post('cowork', { message: 'hi', chatId: 'c1', securitySettings: { disableBashTool: true } });
    expect(providerParams().allowedTools).not.toContain('Bash');
  });

  it('injects security rules into the system prompt', async () => {
    await post('cowork', {
      message: 'hi',
      chatId: 'c1',
      cwd: '/tmp/proj',
      securitySettings: { blockDangerousCommands: true, restrictToProjectFolder: true },
    });

    const prompt = promptText();
    expect(prompt).toContain('security-rules');
    expect(prompt).toContain('rm -rf');
    expect(prompt).toContain('/tmp/proj');
  });

  it('injects project instructions, memories, and context bus alerts', async () => {
    await post('chat', {
      message: 'hi',
      chatId: 'c1',
      projectInstructions: 'Follow the style guide.',
      memories: '<user-memory>likes tabs</user-memory>',
      contextBusEvents: [{ summary: 'Build failed on main', source: 'standing-order:so1', priority: 'p0' }],
    });

    const prompt = promptText();
    expect(prompt).toContain('project-instructions');
    expect(prompt).toContain('Follow the style guide.');
    expect(prompt).toContain('likes tabs');
    expect(prompt).toContain('background-alerts');
    expect(prompt).toContain('[P0 — standing-order:so1] Build failed on main');
  });

  it('requests compaction when history approaches the context limit', async () => {
    const history = Array.from({ length: 150 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: 'x'.repeat(4000),
    }));
    await post('chat', { message: 'hi', chatId: 'c1', history });

    expect(promptText()).toContain('context-compaction-notice');
    expect(providerParams().history).toHaveLength(150);
  });
});

describe('agent routing', () => {
  const researcher = {
    name: 'researcher',
    description: 'Research agent',
    model: 'claude-opus-4-6',
    triggers: ['research'],
  };

  it('routes trigger-matched agents: model override + role prompt', async () => {
    mocks.loadAgentsMock.mockReturnValue([researcher]);
    mocks.matchAgentMock.mockReturnValue(researcher);
    mocks.readAgentPromptMock.mockReturnValue('You are a careful researcher.');

    await post('chat', { message: 'research the market', chatId: 'c1' });

    expect(providerParams().model).toBe('claude-opus-4-6');
    const prompt = promptText();
    expect(prompt).toContain('agent-role name=\\"researcher\\"');
    expect(prompt).toContain('You are a careful researcher.');
  });

  it('binds explicitly via sessionControls.agentName without trigger matching', async () => {
    const coder = { name: 'coder', description: '', model: 'sonnet' };
    mocks.loadAgentsMock.mockReturnValue([coder]);

    await post('chat', {
      message: 'unrelated message',
      chatId: 'c1',
      sessionControls: { agentName: 'coder', thinkLevel: 'off', effortLevel: null, verboseMode: true, reasoningVisible: true, modelOverride: null },
    });

    expect(mocks.matchAgentMock).not.toHaveBeenCalled();
    expect(providerParams().model).toBe('sonnet');
  });

  it('lets a session model override beat the agent model', async () => {
    mocks.loadAgentsMock.mockReturnValue([researcher]);
    mocks.matchAgentMock.mockReturnValue(researcher);

    await post('chat', {
      message: 'research this',
      chatId: 'c1',
      model: 'sonnet',
      sessionControls: { agentName: null, modelOverride: 'haiku', thinkLevel: 'off', effortLevel: null, verboseMode: true, reasoningVisible: true },
    });

    expect(providerParams().model).toBe('haiku');
  });
});

describe('memory extraction', () => {
  it('emits memory_extract when the response is substantial', async () => {
    scriptProvider([
      { type: 'text', content: 'a'.repeat(60), provider: 'claude' },
    ]);
    mocks.extractMemoriesMock.mockResolvedValue([
      { content: 'User works on Quarry', category: 'fact', tags: [], confidence: 0.8 },
    ]);

    const { events } = await post('chat', { message: 'hi', chatId: 'c1' });

    expect(mocks.extractMemoriesMock).toHaveBeenCalledWith('hi', 'a'.repeat(60), undefined);
    const memEvent = events.find((e) => e.type === 'memory_extract');
    expect(memEvent).toBeDefined();
    expect((memEvent!.memories as unknown[])).toHaveLength(1);
  });

  it('skips extraction for short responses and when disabled', async () => {
    scriptProvider([{ type: 'text', content: 'short', provider: 'claude' }]);
    await post('chat', { message: 'hi', chatId: 'c1' });
    expect(mocks.extractMemoriesMock).not.toHaveBeenCalled();

    scriptProvider([{ type: 'text', content: 'a'.repeat(60), provider: 'claude' }]);
    await post('chat', { message: 'hi', chatId: 'c1', autoExtractMemories: false });
    expect(mocks.extractMemoriesMock).not.toHaveBeenCalled();
  });

  it('keeps the stream healthy when extraction fails', async () => {
    scriptProvider([{ type: 'text', content: 'a'.repeat(60), provider: 'claude' }]);
    mocks.extractMemoriesMock.mockRejectedValue(new Error('haiku down'));

    const { events } = await post('chat', { message: 'hi', chatId: 'c1' });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.at(-1)?.type).toBe('done');
  });
});
