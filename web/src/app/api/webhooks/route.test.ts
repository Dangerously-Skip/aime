import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from './route';

const jsonRequest = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/webhooks', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  globalThis.__webhookConfigs = undefined;
});

describe('POST /api/webhooks', () => {
  it('creates a webhook with generated id and token', async () => {
    const res = await POST(jsonRequest('POST', { name: 'jira-events' }));
    expect(res.status).toBe(200);
    const { webhook } = await res.json();
    expect(webhook).toMatchObject({
      name: 'jira-events',
      targetSurface: 'cowork',
      systemPrompt: '',
      enabled: true,
    });
    expect(webhook.id).toBeTruthy();
    expect(webhook.token).toBeTruthy();
    expect(webhook.id).not.toBe(webhook.token);
  });

  it('honours explicit targetSurface and systemPrompt', async () => {
    const res = await POST(jsonRequest('POST', {
      name: 'alerts',
      targetSurface: 'chat',
      systemPrompt: 'Triage this alert.',
    }));
    const { webhook } = await res.json();
    expect(webhook.targetSurface).toBe('chat');
    expect(webhook.systemPrompt).toBe('Triage this alert.');
  });

  it('requires a name', async () => {
    const res = await POST(jsonRequest('POST', {}));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/webhooks', () => {
  it('lists created webhooks', async () => {
    await POST(jsonRequest('POST', { name: 'one' }));
    await POST(jsonRequest('POST', { name: 'two' }));

    const res = await GET();
    const { webhooks } = await res.json();
    expect(webhooks.map((w: { name: string }) => w.name).sort()).toEqual(['one', 'two']);
  });

  it('returns an empty list when none exist', async () => {
    const { webhooks } = await (await GET()).json();
    expect(webhooks).toEqual([]);
  });
});

describe('DELETE /api/webhooks', () => {
  it('removes a webhook by id', async () => {
    const { webhook } = await (await POST(jsonRequest('POST', { name: 'temp' }))).json();
    const res = await DELETE(jsonRequest('DELETE', { id: webhook.id }));
    expect((await res.json()).ok).toBe(true);

    const { webhooks } = await (await GET()).json();
    expect(webhooks).toEqual([]);
  });

  it('requires an id', async () => {
    const res = await DELETE(jsonRequest('DELETE', {}));
    expect(res.status).toBe(400);
  });
});
