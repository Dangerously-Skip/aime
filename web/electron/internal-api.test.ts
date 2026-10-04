import { describe, it, expect, afterEach, vi } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { createRequire } from 'module';
import { decide } from '@/lib/auth/local-token';

const require_ = createRequire(import.meta.url);
const { postInternal } = require_('./internal-api.js') as {
  postInternal: (o: {
    port: number;
    path: string;
    token: string | null;
    body?: unknown;
    timeoutMs?: number;
    log?: (m: string) => void;
    label?: string;
  }) => Promise<{ ok: boolean; status: number; error?: string }>;
};

/**
 * Main's own calls to the local API (bundled-skill install, lifecycle telemetry)
 * sent no credential and got 401 on every launch — logged as though it were an
 * outcome, or not looked at at all. The server here makes the REAL decision
 * (`decide` from lib/auth/local-token, the function src/proxy.ts calls) rather
 * than a stub that accepts any Authorization header.
 */

const TOKEN = 'a'.repeat(64);
let server: http.Server | null = null;

function startServer(token: string | null): Promise<{ port: number; seen: http.IncomingHttpHeaders[] }> {
  const seen: http.IncomingHttpHeaders[] = [];
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      seen.push(req.headers);
      const verdict = decide(
        {
          pathname: req.url || '/',
          origin: (req.headers.origin as string) ?? null,
          host: req.headers.host ?? null,
          cookie: req.headers.cookie ?? null,
          authorization: req.headers.authorization ?? null,
          tokenParam: null,
        },
        token,
      );
      req.resume();
      req.on('end', () => {
        res.statusCode = verdict.ok ? 200 : verdict.status;
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: (server!.address() as AddressInfo).port, seen }));
  });
}

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

describe('postInternal', () => {
  it('authenticates with the launch token, which the real proxy decision accepts', async () => {
    const { port, seen } = await startServer(TOKEN);
    const log = vi.fn();
    const r = await postInternal({ port, path: '/api/customize/skills/install-bundled', token: TOKEN, log });
    expect(r).toEqual({ ok: true, status: 200 });
    expect(seen[0].authorization).toBe(`Bearer ${TOKEN}`);
    expect(log).not.toHaveBeenCalled();
  });

  it('what the old call sent — no credential — is refused by the same decision', async () => {
    const { port } = await startServer(TOKEN);
    const status = await new Promise<number>((resolve) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/api/telemetry/events', method: 'POST', headers: { 'Content-Length': '0' } },
        (res) => {
          res.resume();
          resolve(res.statusCode || 0);
        },
      );
      req.end();
    });
    expect(status).toBe(401);
  });

  it('checks the status and logs a failure with it, instead of reporting it as a result', async () => {
    const { port } = await startServer(TOKEN);
    const log = vi.fn();
    const r = await postInternal({ port, path: '/api/x', token: 'b'.repeat(64), log, label: 'Bundled-skills install' });
    expect(r).toEqual({ ok: false, status: 401 });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Bundled-skills install failed: HTTP 401/));
  });

  it('sends a JSON body with a correct length', async () => {
    const received: string[] = [];
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        let b = '';
        req.on('data', (c) => (b += c));
        req.on('end', () => {
          received.push(b);
          res.end();
        });
      });
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server!.address() as AddressInfo).port;
    await postInternal({ port, path: '/api/telemetry/events', token: TOKEN, body: { events: [{ a: 'é' }] } });
    expect(JSON.parse(received[0])).toEqual({ events: [{ a: 'é' }] });
  });

  it('never rejects: an unreachable server resolves not-ok and is logged', async () => {
    const { port } = await startServer(TOKEN);
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    const log = vi.fn();
    const r = await postInternal({ port, path: '/api/x', token: TOKEN, log });
    expect(r.ok).toBe(false);
    expect(log).toHaveBeenCalled();
  });

  it('refuses to send without a token rather than collecting a guaranteed 401', async () => {
    const log = vi.fn();
    const r = await postInternal({ port: 1, path: '/api/x', token: null, log });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no API token/);
  });

  it('is bounded by its timeout', async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer(() => {
        /* never answers */
      });
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const port = (server!.address() as AddressInfo).port;
    const r = await postInternal({ port, path: '/api/x', token: TOKEN, timeoutMs: 100, log: () => {} });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/timed out/) });
    server!.closeAllConnections();
  });
});
