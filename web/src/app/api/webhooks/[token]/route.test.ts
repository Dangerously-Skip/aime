import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as trigger } from './route';
import { POST as createWebhook } from '../route';

const create = async (body: Record<string, unknown>) => {
  const res = await createWebhook(
    new NextRequest('http://localhost/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return (await res.json()).webhook as { id: string; token: string };
};

const fire = (token: string, payload: unknown) =>
  trigger(
    new NextRequest(`http://localhost/api/webhooks/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ token }) },
  );

const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));

beforeEach(() => {
  globalThis.__webhookConfigs = undefined;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/webhooks/[token]', () => {
  it('returns 404 when no webhooks are configured', async () => {
    const res = await fire('any-token', {});
    expect(res.status).toBe(404);
  });

  it('returns 403 for an unknown token', async () => {
    await create({ name: 'hook' });
    const res = await fire('wrong-token', {});
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 403 for a disabled webhook', async () => {
    const webhook = await create({ name: 'hook' });
    globalThis.__webhookConfigs!.get(webhook.id)!.enabled = false;
    const res = await fire(webhook.token, {});
    expect(res.status).toBe(403);
  });

  it('accepts a valid token and fires a background agent run', async () => {
    const webhook = await create({
      name: 'jira',
      targetSurface: 'cowork',
      systemPrompt: 'Handle Jira events.',
    });

    const res = await fire(webhook.token, { issue: 'QA-42', action: 'created' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.chatId).toBeTruthy();
    expect(body.webhookId).toBe(webhook.id);
    expect(body.surface).toBe('cowork');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost/api/chat/cowork');
    const sent = JSON.parse(init.body as string);
    expect(sent.chatId).toBe(body.chatId);
    expect(sent.userId).toBe('webhook');
    expect(sent.projectInstructions).toBe('Handle Jira events.');
    expect(sent.message).toContain('<webhook-payload source="jira">');
    expect(sent.message).toContain('QA-42');
  });

  it('omits projectInstructions when the webhook has no systemPrompt', async () => {
    const webhook = await create({ name: 'bare' });
    await fire(webhook.token, { ping: true });

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.projectInstructions).toBeUndefined();
  });

  it('does not fail the webhook response when the agent run request rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('chat api down'));
    const webhook = await create({ name: 'resilient' });

    const res = await fire(webhook.token, {});
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

/**
 * DEFECT 2 (regression): this route fetches /api/chat/<surface> and never reads
 * response.body, so nothing here can act on a relay event (document_print,
 * input_request, connector_request). The chat route handed the provider those
 * callbacks anyway, so a webhook-triggered DocumentCreate stalled for the whole
 * 60s print budget and then told the model "PDF rendering timed out." — an
 * invented failure — instead of the honest "only the HTML was written".
 */
describe('a webhook run has no client to relay to', () => {
  it('tells the chat route it cannot relay, so the documented fallbacks fire', async () => {
    const webhook = await create({ name: 'hook' });
    await fire(webhook.token, { ping: true });

    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.canRelayToClient).toBe(false);
  });

  it('drains the agent run stream instead of abandoning the body', async () => {
    // Abandoning it leaves the server-side writer pushing into a stream nobody is
    // reading, which is where the "no consumer" bug lived in the first place.
    let cancelled = false;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 2) controller.close();
        else controller.enqueue(new TextEncoder().encode('data: {"type":"connected"}\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));

    const webhook = await create({ name: 'drain' });
    await fire(webhook.token, {});

    await vi.waitFor(() => expect(pulled).toBeGreaterThan(2));
    // Read to completion, not cancelled — cancelling would kill the agent run.
    expect(cancelled).toBe(false);
  });
});
