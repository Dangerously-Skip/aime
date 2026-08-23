import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A SCHEDULED REFRESH USES THE MODEL THE USER CONFIGURED, OR NONE.
 *
 * `refresh-service.ts` read `opts.model ?? 'haiku'` and took its key from
 * `getServerAnthropicKey()`. On an account with no Anthropic key that is not a
 * degraded refresh — it is no refresh at all, once per tick, silently, because a
 * failed refresh and a refresh that never ran look identical from outside.
 *
 * Third instance of that bug this week; the memory extractor and the search
 * carrier were the others, and all three had the same root: code naming a model
 * without resolving one.
 *
 * These drive the REAL `refreshWidget` against a real manifest file, because the
 * failure was a value that was never read.
 */

let dir = '';
const provider = { query: vi.fn() };

vi.mock('@/lib/app-paths', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDataDir: () => dir,
}));
vi.mock('@/lib/providers', () => ({ getProvider: () => provider }));

const WIDGET = {
  id: 'w1',
  title: 'Camera prices',
  recipe: 'list the cameras',
  refreshEvery: 'daily',
} as never;

async function writeManifest(routes: Record<string, unknown>) {
  await fs.writeFile(
    path.join(dir, 'execution-manifest.json'),
    JSON.stringify({ version: 1, updatedAt: '2026-08-22T00:00:00.000Z', routes }),
    'utf8',
  );
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'widget-model-'));
  vi.resetModules();
  provider.query.mockReset();
  provider.query.mockImplementation(async function* () {
    yield { type: 'text', content: '{"type":"text","text":"ok"}' };
  });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

/** The model actually sent to the provider, or undefined if it never got there. */
const sentModel = () => provider.query.mock.calls[0]?.[0]?.model;

describe('with a manifest', () => {
  it('runs on the model the user configured', async () => {
    await writeManifest({ chat: { model: 'deepseek/deepseek-v4-pro' } });
    const { refreshWidget } = await import('./refresh-service');
    await refreshWidget(WIDGET, 'cron');
    expect(sentModel()).toBe('deepseek/deepseek-v4-pro');
  });

  it('never falls back to a hardcoded vendor model', async () => {
    /*
     * The regression that matters. `'haiku'` reaching a provider that has never
     * heard of it is a 400 the user never sees.
     */
    await writeManifest({ chat: { model: 'openai/gpt-5-mini' } });
    const { refreshWidget } = await import('./refresh-service');
    await refreshWidget(WIDGET, 'cron');
    expect(sentModel()).not.toBe('haiku');
    expect(sentModel()).toBe('openai/gpt-5-mini');
  });

  it('an explicit opts.model still wins — the scheduler escalates on retry', async () => {
    await writeManifest({ chat: { model: 'cheap/model' } });
    const { refreshWidget } = await import('./refresh-service');
    await refreshWidget(WIDGET, 'cron', { model: 'better/model' });
    expect(sentModel()).toBe('better/model');
  });
});

describe('with NO usable manifest, it declines rather than guessing', () => {
  const expectDeclined = async () => {
    const { refreshWidget } = await import('./refresh-service');
    const result = await refreshWidget(WIDGET, 'cron');
    expect(provider.query, 'a refresh ran without a configured model').not.toHaveBeenCalled();
    expect(result.node).toBeNull();
    expect(result.error).toMatch(/no model is configured/i);
    // Named so the user can act on it, not just told it failed.
    expect(result.error).toMatch(/tier grid/i);
    return result;
  };

  it('declines when the file is absent', async () => {
    await expectDeclined();
  });

  it('declines when the file is corrupt', async () => {
    await fs.writeFile(path.join(dir, 'execution-manifest.json'), 'not json', 'utf8');
    await expectDeclined();
  });

  it('declines when the manifest has no route for this capability', async () => {
    await writeManifest({ image: { model: 'some/image-model' } });
    await expectDeclined();
  });

  it('records a run, so the gap is visible in history and not only in a log', async () => {
    const result = await expectDeclined();
    expect(result.run).toBeTruthy();
    expect(result.run.status).toBe('failed');
  });
});
