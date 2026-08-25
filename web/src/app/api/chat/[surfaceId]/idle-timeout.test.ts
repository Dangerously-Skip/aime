import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * THE QUERY TIMEOUT MEASURES SILENCE, NOT DURATION.
 *
 * It was wall-clock: armed once at stream start, never reset. So a run was
 * killed at the deadline however well it was going — a code review that had
 * been streaming findings for ten minutes died mid-sentence and was told "Try a
 * simpler request or break it into steps", which is exactly the wrong advice
 * for a request that was working.
 *
 * Long is not the same as stuck. What deserves aborting is a run that has
 * stopped producing anything — a wedged subprocess, a tool that never returns,
 * a provider holding the socket open. All of those look like SILENCE. None of
 * them looks like elapsed time.
 *
 * These drive the REAL route with a 1-second budget and a provider whose
 * pacing the test controls, because the bug was entirely in WHEN a timer was
 * re-armed and a mocked timer would have proved nothing.
 */

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  abortMock: vi.fn(),
  /** Seconds of silence tolerated; small so the tests stay fast. */
  timeoutSecs: { value: 1 },
}));

vi.mock('@/lib/providers', () => ({
  getProvider: () => ({ name: 'claude', query: mocks.queryMock, abort: mocks.abortMock }),
  getAvailableProviders: () => ['claude'],
}));
vi.mock('@/lib/agents-parser', () => ({
  loadAgents: vi.fn().mockResolvedValue([]),
  matchAgentForMessage: vi.fn().mockReturnValue(null),
  readAgentSystemPrompt: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/memory/extractor', () => ({ extractMemories: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/mcp/provisioned', () => ({ loadProvisionedMcpServers: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/surfaces', async (orig) => {
  const actual = await orig<typeof import('@/lib/surfaces')>();
  return {
    ...actual,
    getSurfaceConfig: (name: string, over = {}) => ({
      ...actual.getSurfaceConfig(name, over),
      queryTimeoutSecs: mocks.timeoutSecs.value,
    }),
  };
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(surfaceId: string, body: unknown) {
  const { POST } = await import('./route');
  const res = await POST(
    new NextRequest('http://localhost/api/chat/' + surfaceId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ surfaceId }) },
  );
  const events: Record<string, unknown>[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (const block of buf.split('\n\n')) {
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (line) {
        try {
          events.push(JSON.parse(line.slice(6)));
        } catch {
          /* partial frame; the next read completes it */
        }
      }
    }
    buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
  }
  return events;
}

const BODY = { message: 'review this', chatId: 'c1' };

beforeEach(() => {
  mocks.queryMock.mockReset();
  mocks.abortMock.mockReset();
  mocks.timeoutSecs.value = 1;
});
afterEach(() => vi.restoreAllMocks());

describe('a run that keeps producing output', () => {
  it('IS NOT KILLED for outliving the timeout — the reported bug', async () => {
    /*
     * Five chunks, 400ms apart: 2s of work against a 1s budget. Under the old
     * wall-clock timer this was dead at chunk 3 with everything after it lost.
     */
    mocks.queryMock.mockImplementation(async function* () {
      for (let i = 0; i < 5; i++) {
        await sleep(400);
        yield { type: 'text', content: `finding ${i} ` };
      }
    });

    const events = await post('code', BODY);

    const errors = events.filter((e) => e.type === 'error');
    expect(errors, `killed while working: ${JSON.stringify(errors)}`).toHaveLength(0);
    expect(mocks.abortMock).not.toHaveBeenCalled();

    const text = events
      .filter((e) => e.type === 'text')
      .map((e) => e.content)
      .join('');
    expect(text, 'output was truncated at the old deadline').toContain('finding 4');
  }, 20_000);
});

describe('a run that goes silent', () => {
  it('IS cancelled — the case the timeout exists for', async () => {
    mocks.queryMock.mockImplementation(async function* () {
      yield { type: 'text', content: 'starting…' };
      await sleep(2_500); // > 1s of nothing
      yield { type: 'text', content: 'too late' };
    });

    const events = await post('code', BODY);

    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(mocks.abortMock).toHaveBeenCalled();
  }, 20_000);

  it('says what happened, and does not blame the request', async () => {
    /*
     * "Try a simpler request or break it into steps" was advice for a request
     * that had been working fine, and it sent the user off to fix nothing.
     */
    mocks.queryMock.mockImplementation(async function* () {
      yield { type: 'text', content: 'starting…' };
      await sleep(2_500);
    });

    const events = await post('code', BODY);
    const err = events.find((e) => e.type === 'error');

    expect(String(err?.message)).toMatch(/stopped producing output/i);
    expect(String(err?.message)).toMatch(/kept/i);
    expect(String(err?.message)).not.toMatch(/simpler request/i);
  }, 20_000);

  it('keeps the partial output rather than discarding it', async () => {
    // A ten-minute review that produced six thousand characters should not lose
    // them because its last tool call hung.
    mocks.queryMock.mockImplementation(async function* () {
      yield { type: 'text', content: 'a real finding' };
      await sleep(2_500);
    });

    const events = await post('code', BODY);

    expect(events.filter((e) => e.type === 'text').map((e) => e.content).join('')).toContain(
      'a real finding',
    );
  }, 20_000);
});

describe('the timeout can be disabled', () => {
  it('never fires when the surface sets 0', async () => {
    mocks.timeoutSecs.value = 0;
    mocks.queryMock.mockImplementation(async function* () {
      yield { type: 'text', content: 'slow' };
      await sleep(1_500);
      yield { type: 'text', content: 'but fine' };
    });

    const events = await post('code', BODY);

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(mocks.abortMock).not.toHaveBeenCalled();
  }, 20_000);
});
