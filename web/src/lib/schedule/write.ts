import type { ManifestOrderLike } from './attended-jobs';

/**
 * Creating, pausing and deleting scheduled jobs — against the manifest.
 *
 * DR-24 step 5. Until now every creation path wrote to the browser's cron store
 * and the migration moved it across on the NEXT launch. That worked, because the
 * dual read ticks both — but it meant the cron store never emptied, so step 6
 * could never happen.
 *
 * WHY A MODULE AND NOT FOUR EDITS. There are four creation paths — the Customize
 * automation panel, per-project schedules, Cowork, and the `CronCreate` agent
 * tool — and the difference between writing to a store and writing to a manifest
 * is that one is synchronous and the other is a round trip. Four call sites each
 * growing their own fetch, their own error handling and their own optimistic
 * update is four chances to get it subtly different. This is the one place that
 * knows how.
 *
 * READ-MODIFY-WRITE, and it is worth naming the hazard. The orders API takes the
 * whole list, so two windows creating a job at the same moment can lose one.
 * That is a real race and it is NOT solved here — it is the same race the widget
 * sync already lives with, and solving it properly needs an append endpoint
 * rather than a PUT. Named so the next person does not assume it was considered
 * and dismissed.
 */

export interface NewAttendedJob {
  /** Cron expression. Interval and event triggers come later. */
  expression: string;
  prompt: string;
  surfaceId: string;
  /** When created from a project, so it stays visible there. */
  projectId?: string;
}

async function readOrders(): Promise<ManifestOrderLike[] | null> {
  try {
    const res = await fetch('/api/schedule/orders');
    if (!res.ok) return null;
    const data = (await res.json()) as { orders?: ManifestOrderLike[] };
    return Array.isArray(data.orders) ? data.orders : [];
  } catch {
    return null;
  }
}

async function writeOrders(orders: unknown[]): Promise<boolean> {
  try {
    const res = await fetch('/api/schedule/orders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Create a scheduled job that runs in the renderer against a surface.
 *
 * Returns the id, or null when it could not be written. Callers must treat null
 * as "not created" and say so — the previous store call could not fail, so a
 * caller that ignores this silently loses the user's job.
 */
export async function createAttendedJob(job: NewAttendedJob): Promise<string | null> {
  const existing = await readOrders();
  if (existing === null) return null;

  const now = Date.now();
  const order = {
    id: globalThis.crypto.randomUUID(),
    instruction: job.prompt,
    attended: true,
    surfaceId: job.surfaceId,
    projectId: job.projectId,
    trigger: { type: 'cron' as const, expression: job.expression },
    status: 'active' as const,
    /*
     * STAMPED AS RUN NOW, for the same reason the migration does it: a job with
     * no `lastRun` and an interval trigger is due immediately. A cron job is
     * usually safe — it waits for its expression — but a `* * * * *` job created
     * mid-minute would otherwise fire in the same minute it was created, which
     * reads as the UI running it on save.
     */
    lastRun: now,
    runCount: 0,
    errorCount: 0,
    notifyVia: 'surface',
    state: {},
    createdAt: now,
    updatedAt: now,
  };

  return (await writeOrders([...existing, order])) ? order.id : null;
}

/** Pause or resume. Returns false when the write did not land. */
export async function setJobEnabled(id: string, enabled: boolean): Promise<boolean> {
  const existing = await readOrders();
  if (existing === null) return false;
  const next = existing.map((o) =>
    o.id === id ? { ...o, status: enabled ? 'active' : 'paused', updatedAt: Date.now() } : o,
  );
  return writeOrders(next);
}

/** Delete. Returns false when the write did not land. */
export async function deleteJob(id: string): Promise<boolean> {
  const existing = await readOrders();
  if (existing === null) return false;
  return writeOrders(existing.filter((o) => o.id !== id));
}
