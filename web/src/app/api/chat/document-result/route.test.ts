import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { waitForDocumentPrint, pendingDocumentCount } from '@/lib/pending-documents';

/** The real bridge — the claim is that this unblocks the paused tool call. */
const post = (body: unknown, raw?: string) =>
  POST(
    new NextRequest('http://localhost/api/chat/document-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    }),
  );

describe('POST /api/chat/document-result', () => {
  it('unblocks a waiting print with success', async () => {
    const waiting = waitForDocumentPrint('t1');
    const res = await post({ toolUseId: 't1', ok: true, path: '/o/r.pdf', bytes: 99 });
    expect(res.status).toBe(200);
    await expect(waiting).resolves.toEqual({ ok: true, path: '/o/r.pdf', bytes: 99 });
  });

  it('unblocks with a failure and its reason', async () => {
    const waiting = waitForDocumentPrint('t2');
    await post({ toolUseId: 't2', ok: false, error: 'no chromium' });
    await expect(waiting).resolves.toEqual({ ok: false, error: 'no chromium' });
  });

  it('404s when nothing is waiting rather than silently accepting', async () => {
    expect((await post({ toolUseId: 'nope', ok: true })).status).toBe(404);
  });

  it('rejects a missing toolUseId or a non-boolean ok', async () => {
    expect((await post({ ok: true })).status).toBe(400);
    expect((await post({ toolUseId: 'x' })).status).toBe(400);
    expect((await post({ toolUseId: 'x', ok: 'yes' })).status).toBe(400);
  });

  it('rejects a non-JSON body', async () => {
    expect((await post(null, 'not json')).status).toBe(400);
  });

  it('truncates an over-long error before it reaches the model', async () => {
    const waiting = waitForDocumentPrint('t3');
    await post({ toolUseId: 't3', ok: false, error: 'x'.repeat(4000) });
    expect((await waiting).error!.length).toBe(300);
  });

  it('leaves no entry behind', async () => {
    const before = pendingDocumentCount();
    const waiting = waitForDocumentPrint('t4');
    await post({ toolUseId: 't4', ok: true });
    await waiting;
    expect(pendingDocumentCount()).toBe(before);
  });
});
