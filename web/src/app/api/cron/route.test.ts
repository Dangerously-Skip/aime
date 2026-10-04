import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, DELETE } from './route';

const jsonRequest = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/cron', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/cron', () => {
  it('responds ok', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe('POST /api/cron', () => {
  it('accepts a valid job', async () => {
    const res = await POST(jsonRequest('POST', {
      expression: '0 9 * * 1',
      prompt: 'weekly summary',
      surfaceId: 'chat',
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, expression: '0 9 * * 1' });
  });

  it('rejects missing fields with 400', async () => {
    const res = await POST(jsonRequest('POST', { expression: '* * * * *' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('required');
  });

  it('rejects cron expressions without 5 fields', async () => {
    const res = await POST(jsonRequest('POST', {
      expression: '* * *',
      prompt: 'p',
      surfaceId: 's',
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('5 fields');
  });

  it('rejects a malformed body as a client error, without echoing parser internals', async () => {
    const res = await POST(new NextRequest('http://localhost/api/cron', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Request body must be JSON');
  });

  it.each([
    ['0 9 * * MON-FRI', 'Weekdays at 9:00 AM'],
    ['0 9 * * 7', 'Every Sunday at 9:00 AM'],
  ])('accepts %s — names and 7 = Sunday now match — and describes it', async (expression, description) => {
    const res = await POST(jsonRequest('POST', { expression, prompt: 'p', surfaceId: 'chat' }));
    expect(res.status).toBe(200);
    expect((await res.json()).description).toBe(description);
  });

  it.each([
    ['60 * * * *', 'minute must be between 0 and 59'],
    ['0 9 * * FUNDAY', 'not a valid day of week'],
    ['0 25 * * *', 'hour must be between 0 and 23'],
  ])('rejects %s with the reason, instead of saving a job that never runs', async (expression, reason) => {
    const res = await POST(jsonRequest('POST', { expression, prompt: 'p', surfaceId: 'chat' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(reason);
  });
});

describe('DELETE /api/cron', () => {
  it('requires an id', async () => {
    const res = await DELETE(jsonRequest('DELETE', {}));
    expect(res.status).toBe(400);
  });

  it('acknowledges deletion', async () => {
    const res = await DELETE(jsonRequest('DELETE', { id: 'job1' }));
    expect(await res.json()).toEqual({ ok: true, id: 'job1' });
  });
});
