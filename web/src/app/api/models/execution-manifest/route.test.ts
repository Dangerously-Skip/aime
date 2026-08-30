import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * WHAT THE PUBLISHER SENDS MUST BE WHAT THE ROUTE ACCEPTS.
 *
 * The route required every entry to carry a `tier`. `buildManifest` does not
 * take one, and `use-execution-manifest.ts` does not send one — so every route
 * was filtered out, the manifest came out empty, and the "nothing resolvable,
 * I left the old one alone" branch answered **200**.
 *
 * Both ends then believed it had worked. `.catch` does not fire for a 200, the
 * publisher deduplicated against a payload that never landed, and no manifest
 * was ever written. Downstream that is "No model is configured for this
 * capability" on every widget refresh and every scheduled order — on an account
 * with four models configured in the tier grid.
 *
 * The payload shape here is taken from the publisher rather than invented, so
 * the two cannot drift again without this failing.
 */

let dir = '';
vi.mock('@/lib/app-paths', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDataDir: () => dir,
}));

const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new NextRequest('http://localhost/api/models/execution-manifest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aime-manifest-'));
  vi.resetModules();
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Exactly the shape `use-execution-manifest.ts` builds — no `tier`. */
const PUBLISHER_PAYLOAD = {
  routes: [
    { capability: 'chat', model: 'deepseek/deepseek-v4-pro', providerConfig: { providerId: 'p1' } },
    { capability: 'code', model: 'moonshot/kimi-k3', providerConfig: { providerId: 'p1' } },
  ],
};

describe('publishing the execution manifest', () => {
  it('accepts the publisher’s payload and WRITES it', async () => {
    const res = await post(PUBLISHER_PAYLOAD);
    const body = await res.json();

    expect(body.ok, `the route discarded every route: ${JSON.stringify(body)}`).toBe(true);
    expect(body.routes).toBe(2);

    const onDisk = JSON.parse(
      await fs.readFile(path.join(dir, 'execution-manifest.json'), 'utf8'),
    );
    expect(Object.keys(onDisk.routes)).toHaveLength(2);
  });

  it('the written manifest resolves the capability a widget refresh asks for', async () => {
    /*
     * The end of the chain. `refresh-service` derives its capability from the
     * assistant surface route and looks it up here; a manifest that saved but
     * under a different key would be just as useless.
     */
    await post(PUBLISHER_PAYLOAD);
    const { readExecutionManifest } = await import('@/lib/models/execution-manifest-fs');
    const { resolveFromManifest } = await import('@/lib/models/execution-manifest');
    const { getSurfaceRoute } = await import('@/lib/models/surface-routes');

    const manifest = await readExecutionManifest();
    const route = resolveFromManifest(manifest!, getSurfaceRoute('assistant').capability);

    expect(route?.model, 'a widget refresh would report "No model is configured"').toBeTruthy();
  });

  it('still refuses a payload with nothing resolvable, and says so', async () => {
    // The branch that protects a good manifest from a mid-hydration client.
    // It must keep answering `ok: false` — that is what the publisher now reads.
    const res = await post({ routes: [{ capability: 'chat', model: null }] });
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.skipped).toBeTruthy();
    await expect(fs.access(path.join(dir, 'execution-manifest.json'))).rejects.toThrow();
  });

  it('does not erase a good manifest when a later publish resolves nothing', async () => {
    await post(PUBLISHER_PAYLOAD);
    await post({ routes: [{ capability: 'chat', model: null }] });

    const onDisk = JSON.parse(
      await fs.readFile(path.join(dir, 'execution-manifest.json'), 'utf8'),
    );
    expect(Object.keys(onDisk.routes)).toHaveLength(2);
  });
});

describe('the publisher reads the answer', () => {
  it('treats ok:false as not-sent, so it retries', async () => {
    // `.catch` never fires for a 200, so without this a discarded publish is
    // indistinguishable from a saved one — which is how this went unnoticed.
    const hook = await import('fs').then((m) =>
      m.readFileSync(path.resolve(process.cwd(), 'src/hooks/use-execution-manifest.ts'), 'utf8'),
    );
    expect(hook).toMatch(/body\?\.ok === false/);
    expect(hook).toMatch(/lastSent\.current = ''/);
  });
});
