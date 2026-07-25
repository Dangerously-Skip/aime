import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { readRuns, __resetRunLogPath } from '@/lib/runs/run-log';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/providers', () => ({
  getProvider: () => ({ name: 'claude', query: queryMock, abort: vi.fn() }),
  getAvailableProviders: () => ['claude'],
}));

/** Script the provider to reply with the given text. */
function reply(text: string) {
  queryMock.mockImplementation(async function* () {
    yield { type: 'text', provider: 'claude', content: text };
  });
}

const widget = {
  id: 'w1',
  title: 'Build health',
  recipe: 'Show overnight build failures',
  render: null,
  enabled: true,
  createdAt: 0,
};

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/widgets/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

let dir: string;

beforeEach(() => {
  queryMock.mockReset();
  dir = mkdtempSync(join(tmpdir(), 'aime-widget-'));
  process.env.AIME_USER_DATA_DIR = dir;
  __resetRunLogPath();
});
afterEach(() => {
  delete process.env.AIME_USER_DATA_DIR;
  __resetRunLogPath();
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/widgets/refresh — validation', () => {
  it('rejects a malformed body or a widget with no recipe', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ widget: { id: 'w', recipe: '  ' } })).status).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/widgets/refresh — success', () => {
  it('returns a validated node and records a succeeded run', async () => {
    reply(JSON.stringify({ type: 'card', title: 'Builds', children: [{ type: 'metric', label: 'Failures', value: '2' }] }));
    const res = await post({ widget });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.node).toMatchObject({ type: 'card', title: 'Builds' });
    expect(data.run.status).toBe('succeeded');

    // A refresh is an ordinary Run — it lands in the same durable log.
    const logged = await readRuns();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ goalId: 'widget:w1', status: 'succeeded' });
    expect(logged[0].deliverables[0]).toMatchObject({ kind: 'widget', title: 'Build health' });
  });

  it('unwraps a fenced reply', async () => {
    reply('```json\n' + JSON.stringify({ type: 'divider' }) + '\n```');
    const data = await (await post({ widget })).json();
    expect(data.node).toEqual({ type: 'divider' });
  });

  // The coercer runs server-side too, so a hostile node never even reaches the client.
  it('strips a remote image before returning the node', async () => {
    reply(
      JSON.stringify({
        type: 'card',
        children: [{ type: 'text', text: 'ok' }, { type: 'image', src: 'https://tracker.test/p.png' }],
      }),
    );
    const data = await (await post({ widget })).json();
    expect(JSON.stringify(data.node)).not.toContain('tracker.test');
    expect(data.node.children).toHaveLength(1);
  });
});

describe('POST /api/widgets/refresh — failure is recorded, not swallowed', () => {
  // A widget that never renders must not look idle — that is the Burnbox defect.
  it('records a failed run when the reply is not a renderable widget', async () => {
    reply('I could not find any build data, sorry!');
    const res = await post({ widget });
    expect(res.status).toBe(502);

    const data = await res.json();
    expect(data.error).toMatch(/didn't produce a renderable widget/i);
    expect(data.run.status).toBe('failed');

    const logged = await readRuns();
    expect(logged[0]).toMatchObject({ status: 'failed', goalId: 'widget:w1' });
    expect(logged[0].error).toBeTruthy();
  });

  it('records a failed run when the provider throws', async () => {
    queryMock.mockImplementation(async function* () {
      throw new Error('upstream 502');
    });
    const res = await post({ widget });
    expect(res.status).toBe(502);
    expect((await readRuns())[0]).toMatchObject({ status: 'failed', error: 'upstream 502' });
  });
});

describe('POST /api/widgets/refresh — grounding', () => {
  it('sends the no-invention prompt and a single turn when ungrounded', async () => {
    reply(JSON.stringify({ type: 'divider' }));
    await post({ widget });
    const params = queryMock.mock.calls[0][0];
    expect(params.systemPrompt).toMatch(/MUST NOT invent/i);
    expect(params.maxTurns).toBe(1); // no source to read ⇒ no tool loop
  });

  it('allows a bounded tool loop when the widget has a source', async () => {
    reply(JSON.stringify({ type: 'divider' }));
    await post({ widget: { ...widget, scopeProjectId: 'p1' } });
    const params = queryMock.mock.calls[0][0];
    expect(params.systemPrompt).toMatch(/Gather the data FIRST/i);
    expect(params.maxTurns).toBeGreaterThan(1);
  });

  it('pins refreshes to a cheap model', async () => {
    reply(JSON.stringify({ type: 'divider' }));
    await post({ widget });
    expect(queryMock.mock.calls[0][0].model).toBe('haiku');
  });
});
