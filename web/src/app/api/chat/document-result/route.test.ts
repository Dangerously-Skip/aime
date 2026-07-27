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
    const res = await post({ toolUseId: 't1', ok: true, bytes: 99 });
    expect(res.status).toBe(200);
    await expect(waiting).resolves.toEqual({ ok: true, bytes: 99 });
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

/**
 * DEFECT 3 (regression): this route is unauthenticated and bound nothing to the
 * requester, so any local process could resolve a pending print with `ok: true`
 * and a fabricated `path` — and the model would then tell the user about a PDF at
 * a path of the caller's choosing. The rendezvous already knows where the PDF was
 * asked to go, so a caller-supplied path is not information, only an attack
 * surface. It is now ignored outright.
 */
describe('the reported path is not taken from the caller', () => {
  it('ignores a path in the body rather than passing it to the tool', async () => {
    const waiting = waitForDocumentPrint('p1');
    const res = await post({ toolUseId: 'p1', ok: true, path: '/Users/victim/.ssh/id_rsa', bytes: 42 });
    expect(res.status).toBe(200);

    const result = await waiting;
    expect(result).toEqual({ ok: true, bytes: 42 });
    expect(JSON.stringify(result)).not.toContain('id_rsa');
  });

  it('does not let a caller invent the unclaimed marker', async () => {
    // `unclaimed` is how the bridge says "nobody answered at all", which the tool
    // reports as "PDF rendering needs the desktop app". A caller that DID answer
    // must not be able to claim it did not.
    const waiting = waitForDocumentPrint('p2');
    await post({ toolUseId: 'p2', ok: false, unclaimed: true, error: 'nope' });
    expect((await waiting).unclaimed).toBeUndefined();
  });
});
