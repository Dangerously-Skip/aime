import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { waitForConnector, pendingConnectorCount } from '@/lib/pending-connectors';

/**
 * The real bridge is used, not a mock — the thing being claimed is that this
 * route actually unblocks the paused agent turn.
 */

const post = (body: unknown, raw?: string) =>
  POST(
    new NextRequest('http://localhost/api/chat/connector-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    }),
  );

describe('POST /api/chat/connector-result', () => {
  it('unblocks the waiting turn with a success', async () => {
    const waiting = waitForConnector('tool-1');
    const res = await post({ toolUseId: 'tool-1', connected: true });
    expect(res.status).toBe(200);
    await expect(waiting).resolves.toEqual({ connected: true });
  });

  it('unblocks with a decline and its reason', async () => {
    const waiting = waitForConnector('tool-2');
    await post({ toolUseId: 'tool-2', connected: false, reason: 'The user declined to connect it.' });
    await expect(waiting).resolves.toEqual({
      connected: false,
      reason: 'The user declined to connect it.',
    });
  });

  it('404s when nothing is waiting, rather than silently accepting', async () => {
    const res = await post({ toolUseId: 'never-registered', connected: true });
    expect(res.status).toBe(404);
  });

  it('rejects a missing toolUseId or a non-boolean connected', async () => {
    expect((await post({ connected: true })).status).toBe(400);
    expect((await post({ toolUseId: 'x' })).status).toBe(400);
    expect((await post({ toolUseId: 'x', connected: 'yes' })).status).toBe(400);
  });

  it('rejects a non-JSON body', async () => {
    expect((await post(null, 'not json')).status).toBe(400);
  });

  it('truncates an over-long reason before it reaches the model', async () => {
    const waiting = waitForConnector('tool-3');
    await post({ toolUseId: 'tool-3', connected: false, reason: 'x'.repeat(5000) });
    const result = await waiting;
    expect(result.reason!.length).toBe(300);
  });

  it('leaves no entry behind after resolving', async () => {
    const before = pendingConnectorCount();
    const waiting = waitForConnector('tool-4');
    await post({ toolUseId: 'tool-4', connected: true });
    await waiting;
    expect(pendingConnectorCount()).toBe(before);
  });

  it('a second report for the same id 404s', async () => {
    const waiting = waitForConnector('tool-5');
    await post({ toolUseId: 'tool-5', connected: true });
    await waiting;
    expect((await post({ toolUseId: 'tool-5', connected: false })).status).toBe(404);
  });
});
