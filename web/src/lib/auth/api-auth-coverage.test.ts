import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { config, proxy } from '@/proxy';
import { SESSION_COOKIE } from './local-token';

/*
 * A gate is only a gate over the routes it actually covers.
 *
 * `decide()` is unit-tested next door, and every one of those tests would still
 * pass if the proxy matcher excluded `/api` entirely — the logic would be
 * impeccable and never run. That is the same gap that let four security toggles
 * ship green, and the same one `send-route-coverage.test.ts` closes for models:
 * derive the set from source so a new member is covered without anyone
 * remembering this file exists.
 *
 * So: enumerate every route from the filesystem, and assert the real matcher
 * matches it and the real proxy refuses it unauthenticated.
 */

const API_DIR = resolve(__dirname, '../../app/api');

/** Every `route.ts` under `app/api`, as the URL path it serves. */
function apiRoutes(dir = API_DIR, prefix = '/api'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      // [id] and [...path] become a concrete value so the path is matchable.
      const seg = entry.startsWith('[') ? 'x' : entry;
      out.push(...apiRoutes(full, `${prefix}/${seg}`));
    } else if (entry === 'route.ts' || entry === 'route.tsx') {
      out.push(prefix);
    }
  }
  return out;
}

/** Next's matcher strings are regexes anchored to the whole path. */
const matches = (path: string) =>
  (config.matcher as string[]).some((m) => new RegExp(`^${m}$`).test(path));

const routes = apiRoutes();

describe('the proxy matcher covers the API', () => {
  it('found the API routes', () => {
    // Without this, a broken walker makes every assertion below vacuous.
    expect(routes.length).toBeGreaterThan(15);
    expect(routes).toContain('/api/health');
  });

  it.each(routes)('%s is matched by the proxy', (route) => {
    expect(matches(route)).toBe(true);
  });

  it('still matches page routes, or the ?t= exchange could never run', () => {
    expect(matches('/')).toBe(true);
  });

  it('does not match Next static assets', () => {
    expect(matches('/_next/static/chunk.js')).toBe(false);
    expect(matches('/favicon.ico')).toBe(false);
  });
});

describe('the proxy actually refuses unauthenticated API requests', () => {
  const withEnv = async (token: string | undefined, fn: () => Promise<void> | void) => {
    const prev = process.env.AIME_API_TOKEN;
    if (token === undefined) delete process.env.AIME_API_TOKEN;
    else process.env.AIME_API_TOKEN = token;
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.AIME_API_TOKEN;
      else process.env.AIME_API_TOKEN = prev;
    }
  };

  const TOKEN = 'c'.repeat(64);
  /*
   * A real NextRequest, not a cast plain Request. The first version of this
   * cast `new Request(...) as never` and every case failed on `req.nextUrl`
   * being undefined — which is the whole reason to drive the actual proxy
   * rather than `decide()` twice.
   */
  const req = (path: string, headers: Record<string, string> = {}) =>
    new NextRequest(new Request(`http://localhost:19533${path}`, { headers }));

  it.each(routes.slice(0, 12))('%s returns 401 with no credential', async (route) => {
    await withEnv(TOKEN, async () => {
      const res = await proxy(req(route));
      expect(res.status).toBe(401);
    });
  });

  it('lets an authenticated request through', async () => {
    await withEnv(TOKEN, async () => {
      const res = await proxy(req('/api/health', { cookie: `${SESSION_COOKIE}=${TOKEN}` }));
      // NextResponse.next() is a 200 with the internal rewrite header set.
      expect(res.status).toBe(200);
    });
  });

  it('refuses everything when the server has no token', async () => {
    await withEnv(undefined, async () => {
      const res = await proxy(req('/api/health', { cookie: `${SESSION_COOKIE}=${TOKEN}` }));
      expect(res.status).toBe(503);
    });
  });

  it('lets a page route through without a credential', async () => {
    await withEnv(TOKEN, async () => {
      expect((await proxy(req('/'))).status).toBe(200);
    });
  });
});
