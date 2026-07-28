import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as chat } from './[surfaceId]/route';
import { POST as answer } from './answer/route';

/**
 * The blocking approval gate, end to end and across two HTTP requests.
 *
 * This path had never run in a real turn. It was well covered in pieces —
 * `claude-provider.test.ts` drives the real `canUseTool` and the real
 * rendezvous, and the route test checks that `onInputRequest` is withheld from
 * non-interactive callers — but nothing joined them, and `/api/chat/answer` had
 * no test at all. The pieces each passed while the seam between them was
 * unexercised, and the seam is the whole mechanism:
 *
 *   canUseTool parks a promise ──▶ SSE `input_request` ──▶ (client) ──▶
 *   POST /api/chat/answer ──▶ resolveAnswer ──▶ the parked promise settles
 *
 * The two ends live in DIFFERENT HTTP requests sharing one module-level map in
 * one Node process. That is the property under test, so nothing on that path is
 * mocked: the real chat route, the real ClaudeProvider, the real
 * `lib/rendezvous`, the real answer route. Only `@anthropic-ai/claude-agent-sdk`
 * is stubbed — it is the one thing that cannot run offline — and the stub does
 * what the real SDK does at the moment that matters: call `canUseTool` and await
 * the answer before proceeding.
 *
 * A mocked version of this test would prove the code CALLS resolveAnswer. It
 * would not prove the turn actually resumes, which is the only thing a user
 * clicking "Allow" cares about.
 */

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
  tool: (name: string, description: string, schema: unknown, handler: unknown) =>
    ({ name, description, schema, handler }),
  createSdkMcpServer: (config: unknown) => config,
}));

// A remote MCP server as loadProvisionedMcpServers would hand it over. Its
// world-side tools classify as always_ask, which is what opens the gate.
vi.mock('@/lib/mcp/provisioned', () => ({
  loadProvisionedMcpServers: async () => ({
    'aime-mcp-acme': { type: 'http', url: 'https://mcp.acme.com/mcp' },
  }),
}));

interface Decision {
  behavior: 'allow' | 'deny';
  message?: string;
}

/** What the stubbed SDK observed — the agent's side of the gate. */
let decisions: Decision[];

/**
 * Stub the SDK as a turn that reaches for one world-side MCP tool and BLOCKS on
 * the verdict, exactly as the real loop does.
 *
 * `sdkToolUseId` is the SDK's own id for the call. It is deliberately separate
 * from the handle the provider mints for the card: one of the tests below
 * presents this id to /api/chat/answer and must be refused.
 */
function scriptToolCall(toolName: string, sdkToolUseId = 'sdk-tool-1') {
  queryMock.mockImplementation((args: { options: Record<string, unknown> }) => {
    const canUseTool = args.options.canUseTool as (
      name: string,
      input: Record<string, unknown>,
      ctx: { toolUseID: string },
    ) => Promise<Decision>;
    return (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's1', data: {} };
      const decision = await canUseTool(toolName, { id: 'ACME-1' }, { toolUseID: sdkToolUseId });
      decisions.push(decision);
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: `verdict:${decision.behavior}` }] },
      };
    })();
  });
}

/** Open the chat stream and pump events as they arrive — do NOT drain to end. */
function openStream(body: Record<string, unknown>) {
  const events: Record<string, unknown>[] = [];
  const res = chat(
    new NextRequest('http://localhost/api/chat/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ surfaceId: 'chat' }) },
  );

  // Draining with res.text() would deadlock: the stream does not end until the
  // parked tool call settles, and settling it needs the toolUseId carried on an
  // event we have not read yet. That deadlock IS the feature.
  const finished = res.then(async (r) => {
    const reader = r.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop() ?? '';
      for (const f of frames) {
        if (f.startsWith('data: ')) events.push(JSON.parse(f.slice(6)));
      }
    }
  });

  return { events, finished };
}

/** POST answers the way QuestionCard does. */
async function postAnswer(toolUseId: string, answers: Record<string, string>) {
  const res = await answer(
    new NextRequest('http://localhost/api/chat/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolUseId, answers }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The outstanding approval card, once the stream has emitted it. */
async function awaitCard(events: Record<string, unknown>[]) {
  await vi.waitFor(() => {
    expect(events.some((e) => e.type === 'input_request')).toBe(true);
  });
  const card = events.find((e) => e.type === 'input_request')!;
  const questions = card.questions as Array<{ question: string; options: Array<{ label: string }> }>;
  return { toolUseId: card.toolUseId as string, question: questions[0] };
}

const ACME_DELETE = 'mcp__aime-mcp-acme__deleteIssue';

beforeEach(() => {
  decisions = [];
  queryMock.mockReset();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
});

afterEach(() => vi.unstubAllEnvs());

describe('approval gate — the full loop across two requests', () => {
  it('parks the turn, ships a card, and resumes it on "Allow once"', async () => {
    scriptToolCall(ACME_DELETE);
    const { events, finished } = openStream({ message: 'delete ACME-1', chatId: 'gate-allow' });

    const { toolUseId, question } = await awaitCard(events);

    // The turn is genuinely parked: the tool has no verdict and the stream has
    // not finished. Without the block, the SDK would already have run it.
    expect(decisions).toHaveLength(0);
    expect(events.some((e) => e.type === 'done')).toBe(false);
    expect(question.question).toMatch(/deleteIssue/);

    const res = await postAnswer(toolUseId, { [question.question]: 'Allow once' });
    expect(res.status).toBe(200);

    await finished;
    expect(decisions).toEqual([{ behavior: 'allow' }]);
    // ...and the turn really did carry on afterwards.
    expect(events.some((e) => e.type === 'text' && e.content === 'verdict:allow')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('refuses the tool and tells the agent why on "Deny"', async () => {
    scriptToolCall(ACME_DELETE);
    const { events, finished } = openStream({ message: 'delete ACME-1', chatId: 'gate-deny' });

    const { toolUseId, question } = await awaitCard(events);
    expect((await postAnswer(toolUseId, { [question.question]: 'Deny' })).status).toBe(200);

    await finished;
    expect(decisions[0].behavior).toBe('deny');
    // The agent must be able to act on the refusal rather than retry blindly.
    expect(decisions[0].message).toMatch(/did not approve/i);
    expect(decisions[0].message).toMatch(/[Dd]o not retry/);
  });

  it('offers the options the card is supposed to offer', async () => {
    scriptToolCall(ACME_DELETE);
    const { events, finished } = openStream({ message: 'delete ACME-1', chatId: 'gate-options' });

    const { toolUseId, question } = await awaitCard(events);
    expect(question.options.map((o) => o.label)).toEqual(
      expect.arrayContaining(['Allow once', 'Deny']),
    );

    await postAnswer(toolUseId, { [question.question]: 'Deny' });
    await finished;
  });
});

describe('approval gate — what may settle it', () => {
  /**
   * The handle is a capability, not an identifier. /api/chat/answer authenticates
   * nothing else, so an "Allow" that nothing proves came from the card we showed
   * is not an approval — and this gate exists to make the approval real. The SDK's
   * own toolUseID is guessable and never leaves the server; presenting it must
   * not work.
   */
  it('refuses an approval addressed to the SDK tool use id, and stays parked', async () => {
    scriptToolCall(ACME_DELETE, 'sdk-tool-guessable');
    const { events, finished } = openStream({ message: 'delete ACME-1', chatId: 'gate-forge' });

    const { toolUseId, question } = await awaitCard(events);
    expect(toolUseId).not.toBe('sdk-tool-guessable');

    const forged = await postAnswer('sdk-tool-guessable', { [question.question]: 'Allow once' });
    expect(forged.status).toBe(404);
    // Still parked — the forgery neither approved nor cancelled anything.
    expect(decisions).toHaveLength(0);

    // The real card still works afterwards.
    expect((await postAnswer(toolUseId, { [question.question]: 'Deny' })).status).toBe(200);
    await finished;
    expect(decisions[0].behavior).toBe('deny');
  });

  it('404s an unknown id with one message, so ids cannot be probed', async () => {
    const unknown = await postAnswer('no-such-handle', { q: 'Allow once' });
    expect(unknown.status).toBe(404);
    expect(String(unknown.body.error)).toMatch(/No pending question/);
  });

  it('404s a second answer to the same card — one card, one decision', async () => {
    scriptToolCall(ACME_DELETE);
    const { events, finished } = openStream({ message: 'delete ACME-1', chatId: 'gate-twice' });

    const { toolUseId, question } = await awaitCard(events);
    expect((await postAnswer(toolUseId, { [question.question]: 'Deny' })).status).toBe(200);
    await finished;

    // A replayed card cannot flip a decision the agent has already acted on.
    expect((await postAnswer(toolUseId, { [question.question]: 'Allow once' })).status).toBe(404);
    expect(decisions).toEqual([expect.objectContaining({ behavior: 'deny' })]);
  });

  it('rejects a malformed body before touching the rendezvous', async () => {
    const noAnswers = await answer(
      new NextRequest('http://localhost/api/chat/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolUseId: 'x' }),
      }),
    );
    expect(noAnswers.status).toBe(400);

    const notJson = await answer(
      new NextRequest('http://localhost/api/chat/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(notJson.status).toBe(400);
  });
});

describe('approval gate — surfaces that cannot ask', () => {
  it('denies rather than runs when nothing can relay a card to a human', async () => {
    scriptToolCall(ACME_DELETE);
    const { events, finished } = openStream({
      message: 'delete ACME-1',
      chatId: 'gate-headless',
      // A cron/webhook-style caller: no client is watching this stream.
      canRelayToClient: false,
    });

    await finished;
    expect(events.some((e) => e.type === 'input_request')).toBe(false);
    expect(decisions[0].behavior).toBe('deny');
    expect(decisions[0].message).toMatch(/cannot ask|no interactive client/i);
  });
});
