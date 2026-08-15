import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createPreviewServer, resolveRequestPath, isAllowedHost, type PreviewServer } from './static-server';

/**
 * A REAL server, a REAL socket, a REAL temp filesystem.
 *
 * This module exists to stop untrusted generated content reaching files it
 * should not. Every boundary here — traversal, symlink escape, Host validation,
 * the absence of CORS — is only worth what the actual HTTP stack does with it.
 * A mocked request object would answer whatever the mock was written to answer,
 * which is the one thing not in question.
 */
let root: string;
let outside: string;
let server: PreviewServer;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-root-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-outside-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>deck</h1>');
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'base.css'), 'body{color:red}');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  server = await createPreviewServer({ root, token: 'testtoken' });
});

afterEach(async () => {
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

const get = (p: string, init?: RequestInit) =>
  fetch(`http://127.0.0.1:${server.port}${p}`, { redirect: 'manual', ...init });

/**
 * A request written onto a raw socket.
 *
 * `fetch` cannot send a chosen `Host` — it is a forbidden header name, so undici
 * silently substitutes the real authority and the request arrives looking
 * legitimate. That is exactly the header the rebinding defence turns on, so
 * testing it through `fetch` asserts nothing. This writes the bytes itself.
 */
function rawRequest(port: number, requestLine: string, host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`${requestLine} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (c) => (data += c));
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

describe('serving', () => {
  it('serves a file inside the root, with a real content type', async () => {
    const res = await get('/testtoken/index.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe('<h1>deck</h1>');
  });

  it('serves nested assets, which is what makes relative URLs in a deck work', async () => {
    const res = await get('/testtoken/assets/base.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8');
  });

  it('maps the token root to index.html rather than listing the directory', async () => {
    const res = await get('/testtoken/');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<h1>deck</h1>');
  });

  it('gives a directory with no index a 404, never a listing', async () => {
    fs.mkdirSync(path.join(root, 'empty'));
    const res = await get('/testtoken/empty/');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('empty');
  });

  it('is bound to loopback only', async () => {
    /*
     * Asserting `baseUrl` here proved nothing — that string is built by the
     * same code under test, so it stays 127.0.0.1 even when the socket is
     * bound to 0.0.0.0 and the whole LAN can read generated content. Ask the
     * SOCKET what it bound.
     */
    expect(server.address).toBe('127.0.0.1');

    // And confirm it directly where the machine has a routable address.
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((n) => n && n.family === 'IPv4' && !n.internal);
    if (lan) {
      const refused = await new Promise<boolean>((resolve) => {
        const sock = net.connect(server.port, lan.address);
        sock.on('connect', () => { sock.destroy(); resolve(false); });
        sock.on('error', () => resolve(true));
        setTimeout(() => { sock.destroy(); resolve(true); }, 1500);
      });
      expect(refused).toBe(true);
    }
  });
});

describe('containment', () => {
  const traversals = [
    '/testtoken/../../etc/passwd',
    '/testtoken/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/testtoken/....//....//etc/passwd',
    '/testtoken//etc/passwd',
    '/testtoken/assets/../../../etc/passwd',
  ];
  for (const p of traversals) {
    it(`refuses traversal: ${p}`, async () => {
      const res = await get(p);
      expect(res.status).toBe(404);
    });
  }

  it('refuses a path that escapes to a real file outside the root', async () => {
    const rel = path.relative(root, path.join(outside, 'secret.txt')).split(path.sep).join('/');
    const res = await get(`/testtoken/${rel}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('SECRET');
  });

  it('refuses a SYMLINK inside the root that points outside it', async () => {
    // The string stays inside the root, so a containment check alone passes it.
    // Only resolving what will actually be opened catches this.
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'leak.txt'));
    const res = await get('/testtoken/leak.txt');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('SECRET');
  });

  it('still serves a symlink that stays INSIDE the root', async () => {
    fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'alias.html'));
    const res = await get('/testtoken/alias.html');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<h1>deck</h1>');
  });

  it('refuses a NUL byte, which truncates the path at the syscall', async () => {
    expect(await resolveRequestPath(root, '/index.html\0.png')).toBeNull();
  });

  it('refuses a non-regular file rather than hanging on it', async () => {
    expect(await resolveRequestPath(root, '/assets')).toBeNull();
  });

  it('refuses traversal WITHOUT touching the filesystem', async () => {
    /*
     * The layer this isolates. A traversal that escapes to a real file is also
     * caught later by the realpath check, so every over-HTTP test above passes
     * with string containment deleted — they prove the outer layer, not this
     * one. Attacker-controlled traversal must be refused before it becomes a
     * syscall at all, and the only way to see that is to watch for the syscall.
     */
    const stat = vi.spyOn(fsp, 'stat');
    try {
      expect(await resolveRequestPath(root, '/../../etc/passwd')).toBeNull();
      expect(stat).not.toHaveBeenCalled();

      // Control: a contained path DOES reach the filesystem, so the assertion
      // above is about containment and not about the spy never firing.
      expect(await resolveRequestPath(root, '/index.html')).not.toBeNull();
      expect(stat).toHaveBeenCalled();
    } finally {
      stat.mockRestore();
    }
  });
});

describe('token', () => {
  it('refuses a wrong token', async () => {
    expect((await get('/wrongtoken/index.html')).status).toBe(404);
  });
  it('refuses no token at all', async () => {
    expect((await get('/index.html')).status).toBe(404);
  });
  it('answers 404 rather than 403, so it does not confirm what it is', async () => {
    const res = await get('/wrongtoken/index.html');
    expect(res.status).toBe(404);
  });
});

describe('Host validation (DNS rebinding)', () => {
  it('refuses a rebound Host', async () => {
    // A hostile page points evil.test at 127.0.0.1 to become same-origin. It
    // cannot forge Host, so this is where the attack stops.
    const res = await rawRequest(server.port, 'GET /testtoken/index.html', 'evil.test');
    expect(res.split('\r\n')[0]).toContain('403');
    expect(res).not.toContain('<h1>deck</h1>');
  });

  it('control: the SAME raw request with a correct Host succeeds', async () => {
    // Without this, the test above would pass even if the raw request were
    // malformed and the server were rejecting it for some unrelated reason.
    const res = await rawRequest(server.port, 'GET /testtoken/index.html', `127.0.0.1:${server.port}`);
    expect(res.split('\r\n')[0]).toContain('200');
    expect(res).toContain('<h1>deck</h1>');
  });

  it('refuses a loopback name on the WRONG port', async () => {
    expect(isAllowedHost(`127.0.0.1:${server.port + 1}`, server.port)).toBe(false);
  });

  it('accepts the loopback names a browser actually sends', async () => {
    for (const h of [`127.0.0.1:${server.port}`, `localhost:${server.port}`, `[::1]:${server.port}`]) {
      expect(isAllowedHost(h, server.port)).toBe(true);
    }
  });

  it('refuses a missing or unparseable Host', () => {
    expect(isAllowedHost(undefined, 1234)).toBe(false);
    expect(isAllowedHost('not a host', 1234)).toBe(false);
  });

  it('does not mistake an IPv6 literal for a port split', () => {
    // Splitting on ':' would read `[` as the hostname and mangle the port.
    expect(isAllowedHost('[::1]:9999', 9999)).toBe(true);
    expect(isAllowedHost('[::1]:9999', 8888)).toBe(false);
  });
});

describe('what other origins can do with it', () => {
  it('never sends Access-Control-Allow-Origin', async () => {
    // A page may reach this server; it must not be able to READ the response.
    const res = await get('/testtoken/index.html');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses methods other than GET and HEAD', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      expect((await get('/testtoken/index.html', { method })).status).toBe(405);
    }
  });

  it('sets nosniff, so a text file cannot be executed as script', async () => {
    const res = await get('/testtoken/index.html');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves an unknown extension as bytes, not as a guessed type', async () => {
    fs.writeFileSync(path.join(root, 'thing.weird'), 'x');
    const res = await get('/testtoken/thing.weird');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });
});

describe('urlFor', () => {
  it('builds a URL for a path inside the root', () => {
    expect(server.urlFor('index.html')).toBe(`${server.baseUrl}/index.html`);
    expect(server.urlFor(path.join(root, 'assets', 'base.css'))).toBe(`${server.baseUrl}/assets/base.css`);
  });

  it('returns null for a path outside the root rather than a URL that 404s', () => {
    expect(server.urlFor(path.join(outside, 'secret.txt'))).toBeNull();
    expect(server.urlFor('../escape.html')).toBeNull();
  });

  it('percent-encodes names with spaces', () => {
    expect(server.urlFor('my deck.html')).toBe(`${server.baseUrl}/my%20deck.html`);
  });
});
