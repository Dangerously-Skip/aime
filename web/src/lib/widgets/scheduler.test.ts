import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runDueWidgets, refreshWithRetry } from './scheduler';
import { readManifest, writeManifest, patchManifestWidget, __resetManifestPath } from './schedule-manifest';
import type { Widget } from './widget';
import type { RefreshResult } from './refresh-service';
import type { Run } from '@/lib/runs/types';

/**
 * The C5 scheduler pass, against a REAL temp-dir manifest (the durability is
 * the point) with the model call injected (a scheduler test must never touch
 * a model).
 */

const widget = (over: Partial<Widget> = {}): Widget => ({
  id: 'w1',
  title: 'Build health',
  recipe: 'Show overnight build failures',
  render: null,
  enabled: true,
  createdAt: 0,
  refreshEverySeconds: 1_800,
  ...over,
});

const okResult = (node = { type: 'divider' as const }): RefreshResult => ({
  node,
  run: { id: 'r1', goalId: 'widget:w1', trigger: 'cron', status: 'succeeded', startedAt: 1, deliverables: [] } as Run,
  status: 200,
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aime-sched-'));
  process.env.AIME_USER_DATA_DIR = dir;
  __resetManifestPath();
});
afterEach(() => {
  delete process.env.AIME_USER_DATA_DIR;
  __resetManifestPath();
  rmSync(dir, { recursive: true, force: true });
});

describe('schedule manifest', () => {
  it('round-trips widgets and tolerates a missing file', async () => {
    expect(await readManifest()).toEqual([]);
    await writeManifest([widget()]);
    expect(await readManifest()).toHaveLength(1);
  });

  it('patches one widget in place', async () => {
    await writeManifest([widget({ id: 'a' }), widget({ id: 'b' })]);
    await patchManifestWidget('a', { refreshedAt: 42 });
    const widgets = await readManifest();
    expect(widgets.find((w) => w.id === 'a')?.refreshedAt).toBe(42);
    expect(widgets.find((w) => w.id === 'b')?.refreshedAt).toBeUndefined();
  });

  it('drops garbage entries rather than failing the read', async () => {
    const fs = await import('fs/promises');
    const path = join(dir, 'runs', 'widget-schedule.json');
    await fs.mkdir(join(dir, 'runs'), { recursive: true });
    await fs.writeFile(path, JSON.stringify({ widgets: [widget(), null, 42, { nope: true }] }), 'utf-8');
    expect(await readManifest()).toHaveLength(1);
  });

  it('returns empty on a corrupt file', async () => {
    const fs = await import('fs/promises');
    await fs.mkdir(join(dir, 'runs'), { recursive: true });
    await fs.writeFile(join(dir, 'runs', 'widget-schedule.json'), '{broken', 'utf-8');
    expect(await readManifest()).toEqual([]);
  });
});

describe('runDueWidgets', () => {
  it('refreshes a due widget and writes the render back to the manifest', async () => {
    await writeManifest([widget()]); // never run ⇒ due
    const refresh = vi.fn(async () => okResult({ type: 'divider' }));

    const acted = await runDueWidgets(Date.now(), refresh);

    expect(acted).toEqual(['w1']);
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' }), 'cron', { model: 'haiku' });
    const [saved] = await readManifest();
    expect(saved.render).toEqual({ type: 'divider' });
    expect(saved.refreshedAt).toBeTruthy();
  });

  it('skips disabled, manual and not-yet-due widgets', async () => {
    const now = Date.now();
    await writeManifest([
      widget({ id: 'off', enabled: false }),
      widget({ id: 'manual', refreshEverySeconds: undefined }),
      widget({ id: 'fresh', refreshedAt: now - 60_000 }),
    ]);
    const refresh = vi.fn(async () => okResult());

    expect(await runDueWidgets(now, refresh)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stamps refreshedAt on failure so a broken widget retries next interval, not every tick', async () => {
    await writeManifest([widget()]);
    const refresh = vi.fn(async (): Promise<RefreshResult> => ({
      node: null,
      run: { id: 'r1', goalId: 'widget:w1', trigger: 'cron', status: 'failed', startedAt: 1, deliverables: [] } as Run,
      error: 'nope',
      status: 502,
    }));

    await runDueWidgets(Date.now(), refresh);
    const [saved] = await readManifest();
    expect(saved.refreshedAt).toBeTruthy();
    expect(saved.render).toBeNull(); // the last good render is not clobbered

    // second pass immediately after: not due again
    const acted = await runDueWidgets(Date.now(), refresh);
    expect(acted).toEqual([]);
  });

  it('survives a refresh that throws, still stamping the widget', async () => {
    await writeManifest([widget()]);
    const refresh = vi.fn(async () => {
      throw new Error('provider exploded');
    });

    const acted = await runDueWidgets(Date.now(), refresh);
    expect(acted).toEqual(['w1']);
    expect((await readManifest())[0].refreshedAt).toBeTruthy();
  });

  it('processes multiple due widgets in one pass', async () => {
    await writeManifest([widget({ id: 'a' }), widget({ id: 'b' })]);
    const refresh = vi.fn(async () => okResult());
    const acted = await runDueWidgets(Date.now(), refresh);
    expect(acted.sort()).toEqual(['a', 'b']);
  });
});

describe('refreshWithRetry — the C4 policy, auto-invoked', () => {
  const failRenderable = (model?: string): RefreshResult => ({
    node: null,
    run: { id: `r-${model}`, goalId: 'widget:w1', trigger: 'cron', status: 'failed', startedAt: 1, deliverables: [], model } as Run,
    error: "The refresh didn't produce a renderable widget — try a more specific recipe",
    status: 502,
  });
  const failTransient = (model?: string): RefreshResult => ({
    node: null,
    run: { id: `r-${model}`, goalId: 'widget:w1', trigger: 'cron', status: 'failed', startedAt: 1, deliverables: [], model } as Run,
    error: 'upstream 502',
    status: 502,
  });

  type Args = [Widget, 'cron', { model?: string }?];

  it('starts on the cheap tier', async () => {
    const refresh = vi.fn<(...a: Args) => Promise<RefreshResult>>(async () => okResult());
    await refreshWithRetry(widget(), refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][2]).toEqual({ model: 'haiku' });
  });

  // A non-renderable reply is a CAPABILITY failure: the cheap model answered
  // and couldn't do the job. Re-asking it is pointless — escalate.
  it('escalates the model when a cheap attempt cannot produce a renderable node', async () => {
    const refresh = vi.fn<(...a: Args) => Promise<RefreshResult>>()
      .mockResolvedValueOnce(failRenderable('haiku'))
      .mockResolvedValueOnce(okResult());
    const result = await refreshWithRetry(widget(), refresh);

    expect(result.status).toBe(200);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh.mock.calls[0][2]).toEqual({ model: 'haiku' });   // cheap
    expect(refresh.mock.calls[1][2]).toEqual({ model: 'sonnet' });  // good
  });

  it('retries a transient failure on the SAME tier', async () => {
    const refresh = vi.fn<(...a: Args) => Promise<RefreshResult>>()
      .mockResolvedValueOnce(failTransient('haiku'))
      .mockResolvedValueOnce(okResult());
    await refreshWithRetry(widget(), refresh);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(refresh.mock.calls[1][2]).toEqual({ model: 'haiku' }); // unchanged
  });

  // Retries cost real money on someone else's schedule — the ceiling is hard.
  it('never exceeds MAX_ATTEMPTS', async () => {
    const refresh = vi.fn(async () => failTransient('haiku'));
    const result = await refreshWithRetry(widget(), refresh);
    expect(refresh.mock.calls.length).toBeLessThanOrEqual(3);
    expect(result.status).toBe(502);
  });

  it('a first-attempt success makes exactly one call', async () => {
    const refresh = vi.fn(async () => okResult());
    await refreshWithRetry(widget(), refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the scheduler pass stores the render from a successful RETRY', async () => {
    await writeManifest([widget()]);
    const refresh = vi.fn()
      .mockResolvedValueOnce(failRenderable('haiku'))
      .mockResolvedValueOnce(okResult({ type: 'divider' }));

    await runDueWidgets(Date.now(), refresh);
    const [saved] = await readManifest();
    expect(saved.render).toEqual({ type: 'divider' });
  });
});
