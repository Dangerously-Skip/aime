import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  // Lets a test point homedir() at a temp dir so identity files (SOUL/USER/VOICE)
  // can be exercised. Unset ⇒ the real home, leaving existing tests untouched.
  homeRef: { value: null as string | null },
}));

vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>();
  return { ...actual, default: actual, homedir: () => mocks.homeRef.value ?? actual.homedir() };
});

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
    // The profile's own set, plus the in-app plumbing PLUMBING_TOOLS exempts:
    // asking, delegating, todos, canvas and the connector card render or ask —
    // none of them acts on the world, and TOOL_PROFILES never enumerated them.
    const permitted = new Set([
      'WebSearch', 'WebFetch',
      'AskUserQuestion', 'Agent', 'TodoWrite',
      'mcp__aime__canvas', 'mcp__aime__RequestConnector',
    ]);
    expect(allowed.length).toBeGreaterThan(0);
    for (const tool of allowed) {
      expect(permitted.has(tool), `unexpected tool: ${tool}`).toBe(true);
    }
  });
});

/**
 * Narrowing `allowedTools` restricts NOTHING on its own — it is the SDK's
 * auto-approve list, on a run with `permissionMode: 'bypassPermissions'` and a
 * `canUseTool` that ends in a catch-all allow. Every control here used to do
 * only that, so "Disable Bash tool" left Bash fully working. What the provider
 * acts on is `deniedTools`; these assert the route computes it.
 *
 * It has to be the DIFFERENCE at each narrowing step, never the complement of
 * `allowedTools`: the surface lists have never been exhaustive, so "absent"
 * does not mean "denied" (WidgetCreate is on no list and works everywhere).
 */
describe('withheld tools are actually withheld', () => {
  /**
   * `disableBashTool` is applied by the PROVIDER from the stored setting, not
   * here — see lib/security/settings. The route used to translate it, which
   * meant the seven callers that assemble their own params never got it. What
   * this route still owns is the per-request narrowing below.
   */
  it('leaves the shell family to the provider, and denies nothing by default', async () => {
    await post('cowork', { message: 'hi', chatId: 'c1' });
    expect(providerParams().allowedTools).toContain('Bash');
    expect(providerParams().deniedTools).toEqual([]);
  });

  it('denies what a tool profile takes away', async () => {
    await post('cowork', { message: 'hi', chatId: 'c1', toolProfile: 'minimal' });
    const denied = providerParams().deniedTools!;
    expect(denied).toEqual(expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash']));
  });

  it('never denies the in-app plumbing a profile was not written to cover', async () => {
    await post('chat', { message: 'hi', chatId: 'c1', toolProfile: 'minimal' });
    const denied = providerParams().deniedTools!;
    for (const t of ['AskUserQuestion', 'Agent', 'mcp__aime__canvas', 'mcp__aime__RequestConnector']) {
      expect(denied, t).not.toContain(t);
    }
    // ...but a profile-restricted run really does lose the world-side tools.
    expect(denied).toContain('mcp__aime__DocumentCreate');
  });

  it('denies nothing on the full profile with no security settings', async () => {
    await post('cowork', { message: 'hi', chatId: 'c1', toolProfile: 'full' });
    expect(providerParams().deniedTools).toEqual([]);
  });

  it('denies what an agent scopes away, plumbing aside', async () => {
    mocks.loadAgentsMock.mockReturnValue([
      { name: 'reader', triggers: [], allowedTools: ['Read', 'Grep'] },
    ]);
    mocks.matchAgentMock.mockReturnValue({ name: 'reader', triggers: [], allowedTools: ['Read', 'Grep'] });

    await post('cowork', { message: 'hi', chatId: 'c1' });
    const denied = providerParams().deniedTools!;
    expect(denied).toEqual(expect.arrayContaining(['Write', 'Edit', 'Bash']));
    expect(denied).not.toContain('Read');
    expect(denied).not.toContain('AskUserQuestion');
  });

  /**
   * Deliberately NOT forwarded. They arrived on the request body and only two of
   * nine `provider.query()` callers sent them, so a control the Settings screen
   * badged ENFORCED did nothing on Chat, subagents, cron, webhooks, standing
   * orders or widget refresh — and omitting the field was a way to switch it
   * off. The provider loads them itself now, so every path is covered by
   * construction, including ones written later.
   */
  it('never forwards client-supplied security settings — the provider owns them', async () => {
    await post('cowork', {
      message: 'hi',
      chatId: 'c1',
      cwd: '/tmp/proj',
      securitySettings: { blockDangerousCommands: true, restrictToProjectFolder: true },
    });
    expect(providerParams().securitySettings).toBeUndefined();

    // Including the case that used to disable the gate: send them as false.
    await post('cowork', {
      message: 'hi',
      chatId: 'c1',
      securitySettings: { blockDangerousCommands: false, restrictToProjectFolder: false, disableBashTool: false },
    });
    expect(providerParams().securitySettings).toBeUndefined();
  });

  it('tells the model it will be ASKED about destructive commands, not to refuse them', async () => {
    await post('cowork', {
      message: 'hi',
      chatId: 'c1',
      securitySettings: { blockDangerousCommands: true },
    });
    // The old rule said "NEVER run … Refuse the request", which would have the
    // model decline work the user is about to be asked about and would approve.
    expect(promptText()).toMatch(/shown to the user for approval/);
    expect(promptText()).not.toMatch(/NEVER run destructive shell commands/);
  });

  it('accumulates across the narrowing steps rather than letting the last one win', async () => {
    mocks.loadAgentsMock.mockReturnValue([
      { name: 'reader', triggers: [], allowedTools: ['Read', 'Grep', 'Bash'] },
    ]);
    mocks.matchAgentMock.mockReturnValue({ name: 'reader', triggers: [], allowedTools: ['Read', 'Grep', 'Bash'] });

    await post('cowork', { message: 'hi', chatId: 'c1', toolProfile: 'coding' });
    const denied = providerParams().deniedTools!;
    expect(denied).toContain('mcp__aime__SkillCreate'); // from the profile
    expect(denied).toContain('Write');                  // from the agent's list
    expect(denied).not.toContain('Read');
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

  it('resolves (capability, tier) through the registry when no explicit model is given', async () => {
    // code + stallion → Fable; a request API key makes the anthropic provider available
    await post('cowork', { message: 'refactor', chatId: 'c1', capability: 'code', tier: 'stallion', apiKey: 'sk-x' });
    expect(providerParams().model).toBe('claude-fable-5');

    // chat + good → sonnet
    await post('chat', { message: 'hi', chatId: 'c1', capability: 'chat', tier: 'good', apiKey: 'sk-x' });
    expect(providerParams().model).toBe('sonnet');
  });

  it('uses the surface default route when no model or tier is sent', async () => {
    // cowork defaults to code/smort → opus; chat defaults to chat/good → sonnet.
    await post('cowork', { message: 'go', chatId: 'c1', apiKey: 'sk-x' });
    expect(providerParams().model).toBe('opus');

    await post('chat', { message: 'go', chatId: 'c1', apiKey: 'sk-x' });
    expect(providerParams().model).toBe('sonnet');
  });

  it('honours a tier-only override, keeping the surface capability', async () => {
    // No capability sent: cowork's own 'code' capability + the requested tier.
    await post('cowork', { message: 'go', chatId: 'c1', tier: 'cheap', apiKey: 'sk-x' });
    expect(providerParams().model).toBe('haiku');

    await post('cowork', { message: 'go', chatId: 'c1', tier: 'stallion', apiKey: 'sk-x' });
    expect(providerParams().model).toBe('claude-fable-5');
  });

  it('tumbles a chat stallion request down to smort (opus)', async () => {
    await post('chat', { message: 'hi', chatId: 'c1', capability: 'chat', tier: 'stallion', apiKey: 'sk-x' });
    expect(providerParams().model).toBe('opus');
  });

  it('lets an explicit model override beat capability/tier resolution', async () => {
    await post('cowork', { message: 'hi', chatId: 'c1', model: 'opus', capability: 'code', tier: 'cheap', apiKey: 'sk-x' });
    expect(providerParams().model).toBe('opus');
  });

  it('drives an explicit model on a user-added provider via its base URL', async () => {
    // Picking a scanned OpenRouter model: explicit driver model + providerConfig.
    await post('chat', {
      message: 'hi',
      chatId: 'c1',
      model: 'moonshotai/kimi-k2',
      apiKey: 'sk-or-transient',
      providerConfig: {
        providerId: 'openrouter-1',
        transport: 'anthropic-native',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
    });
    const p = providerParams();
    expect(p.model).toBe('moonshotai/kimi-k2');
    expect(p.apiKey).toBe('sk-or-transient');
    // Trailing /v1 stripped: the SDK adds `/v1/messages` itself.
    expect(p.baseUrl).toBe('https://openrouter.ai/api');
  });

  it('leaves base URL unset on the default Anthropic path', async () => {
    await post('chat', { message: 'hi', chatId: 'c1', apiKey: 'sk-x' });
    expect(providerParams().baseUrl).toBeUndefined();
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

describe('writing voice injection (P4)', () => {
  /**
   * The claim is that VOICE.md reaches the model. Asserting on the system prompt
   * the provider actually receives is the only way to know — a unit test of
   * buildVoicePrompt would pass even if the route never called it.
   */
  let homeDir: string;

  const writeVoice = async (markdown: string) => {
    const { mkdtemp, mkdir, writeFile } = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'aime-route-voice-'));
    mocks.homeRef.value = homeDir;
    await mkdir(path.join(homeDir, '.claude'), { recursive: true });
    await writeFile(path.join(homeDir, '.claude', 'VOICE.md'), markdown, 'utf-8');
  };

  afterEach(async () => {
    mocks.homeRef.value = null;
    if (homeDir) {
      const { rm } = await import('fs/promises');
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('injects a saved voice into the system prompt', async () => {
    await writeVoice('# Writing voice\n\n## Tone\n\nDry and direct.\n\n## Never do this\n\nSemicolons.\n');

    await post('chat', { message: 'draft an email' });

    const prompt = promptText();
    expect(prompt).toContain('Dry and direct.');
    expect(prompt).toContain('Semicolons.');
    // scoped so it governs drafts, not the assistant's own replies
    expect(prompt).toContain('put their name to');
  });

  it('injects nothing when there is no voice file', async () => {
    const { mkdtemp } = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    homeDir = await mkdtemp(path.join(os.tmpdir(), 'aime-route-novoice-'));
    mocks.homeRef.value = homeDir;

    await post('chat', { message: 'hi' });

    expect(promptText()).not.toContain('put their name to');
  });

  it('injects nothing for a voice file with no recognised sections', async () => {
    // A user could empty the file, or write only their own notes into it.
    await writeVoice('# Writing voice\n\nnothing structured here\n');

    await post('chat', { message: 'hi' });

    expect(promptText()).not.toContain('put their name to');
  });
});

/**
 * DEFECT 2 (regression): the documented "no connected client" fallbacks were
 * unreachable on the HTTP path. This route defined onInputRequest,
 * onConnectorRequest and onDocumentPrint for EVERY request, and the provider
 * decides "can we relay to a human?" by whether those callbacks exist. The webhook
 * route server-side fetches this endpoint and never acts on the events, so a
 * DocumentCreate stalled for the full print budget and then reported an invented
 * failure, and an AskUserQuestion would stall for five minutes.
 *
 * Whether anyone is ACTING on the stream is knowable only at the caller, so the
 * caller now says.
 */
describe('client-relay callbacks (regression)', () => {
  it('withholds all three relay callbacks when the caller says it cannot relay', async () => {
    await post('cowork', { message: 'hi', chatId: 'nr-1', canRelayToClient: false });
    const params = providerParams();
    expect(params.onDocumentPrint).toBeUndefined();
    expect(params.onConnectorRequest).toBeUndefined();
    expect(params.onInputRequest).toBeUndefined();
  });

  it('relays by default, so an ordinary renderer is unaffected', async () => {
    await post('cowork', { message: 'hi', chatId: 'nr-2' });
    const params = providerParams();
    expect(typeof params.onDocumentPrint).toBe('function');
    expect(typeof params.onConnectorRequest).toBe('function');
    expect(typeof params.onInputRequest).toBe('function');
  });

  it('treats an explicit true the same as absence', async () => {
    await post('cowork', { message: 'hi', chatId: 'nr-3', canRelayToClient: true });
    expect(typeof providerParams().onDocumentPrint).toBe('function');
  });
});
