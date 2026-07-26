/**
 * Server-side standing-order manifest + results inbox — C5b.
 *
 * The renderer owns order CRUD (assistant-store, localStorage). The server
 * ticker executes from THIS file, so orders fire with every window closed.
 * Results the renderer must replay (cards, context-bus posts, notifications,
 * state merges) go into the INBOX and are acknowledged after replay — a
 * server-side execution can't touch renderer stores, so its side effects
 * travel as data.
 *
 * Same corruption discipline as the run log and widget manifest.
 */
import { getDataDir } from '@/lib/app-paths';

/** The order shape the server needs. Structurally a subset of StandingOrder. */
export interface ManifestOrder {
  id: string;
  instruction: string;
  trigger: { type: 'cron' | 'interval' | 'event'; expression?: string; event?: string };
  condition?: string;
  completionCondition?: string;
  agentName?: string;
  notifyVia: string;
  maxExecutions?: number;
  expiresAt?: number;
  state: Record<string, unknown>;
  status: 'active' | 'paused' | 'completed' | 'expired';
  lastRun?: number;
  runCount: number;
  errorCount: number;
  lastSnapshotHash?: string;
  totalCost?: number;
  createdAt: number;
  updatedAt: number;
}

/** One renderer-replayable result of a server-side execution. */
export interface InboxEntry {
  id: string;
  orderId: string;
  ts: number;
  kind: 'result' | 'completed' | 'paused' | 'error';
  title: string;
  /** Display text for the card (already STATE-stripped). */
  summary?: string;
  /** Raw A2UI document JSON, if the output carried one. */
  docJson?: string;
  notifyVia: string;
  error?: string;
}

const MANIFEST = 'order-schedule.json';
const INBOX = 'order-inbox.json';

let cachedDir: string | null = null;

async function baseDir(): Promise<string> {
  if (cachedDir) return cachedDir;
  const path = await import('path');
  const fs = await import('fs/promises');
  const userDataDir = process.env.AIME_USER_DATA_DIR;
  const dir = userDataDir ? path.join(userDataDir, 'runs') : getDataDir();
  await fs.mkdir(dir, { recursive: true });
  cachedDir = dir;
  return dir;
}

/** Reset memoization. Tests only. */
export function __resetOrderPaths(): void {
  cachedDir = null;
}

function isOrderLike(v: unknown): v is ManifestOrder {
  const o = v as Partial<ManifestOrder> | null;
  return Boolean(o && typeof o === 'object' && typeof o.id === 'string' && typeof o.instruction === 'string');
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const raw = await fs.readFile(path.join(await baseDir(), file), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    await fs.writeFile(path.join(await baseDir(), file), JSON.stringify(value, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[orders] failed to write', file, err);
    return false;
  }
}

export async function readOrderManifest(): Promise<ManifestOrder[]> {
  const parsed = await readJson<{ orders?: unknown[] }>(MANIFEST, {});
  return Array.isArray(parsed.orders) ? parsed.orders.filter(isOrderLike) : [];
}

export async function writeOrderManifest(orders: ManifestOrder[]): Promise<boolean> {
  return writeJson(MANIFEST, { orders: orders.filter(isOrderLike) });
}

/**
 * Merge a renderer mirror over the server copy. Ownership per field:
 * - The RENDERER owns CRUD and user intent (instruction, trigger, status from
 *   pause/resume, notifyVia…) — incoming wins by default.
 * - The SERVER owns execution results (lastRun, runCount, state, errorCount,
 *   snapshot hash, totalCost) — kept when the server copy ran more recently,
 *   so a stale client can't erase work done while it was closed.
 * - A terminal server status (completed/expired) sticks when the server ran
 *   more recently: flipping it back to active from a stale mirror would
 *   re-execute a finished order.
 */
export function mergeOrders(incoming: ManifestOrder[], current: ManifestOrder[]): ManifestOrder[] {
  const byId = new Map(current.map((o) => [o.id, o]));
  return incoming.map((order) => {
    const server = byId.get(order.id);
    if (!server) return order;
    const serverRanLater = (server.lastRun ?? 0) > (order.lastRun ?? 0);
    if (!serverRanLater) return order;
    return {
      ...order,
      lastRun: server.lastRun,
      runCount: server.runCount,
      state: server.state,
      errorCount: server.errorCount,
      lastSnapshotHash: server.lastSnapshotHash,
      totalCost: server.totalCost,
      status:
        server.status === 'completed' || server.status === 'expired' || server.status === 'paused'
          ? server.status
          : order.status,
    };
  });
}

export async function patchManifestOrder(id: string, patch: Partial<ManifestOrder>): Promise<boolean> {
  const orders = await readOrderManifest();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return false;
  orders[idx] = { ...orders[idx], ...patch };
  return writeOrderManifest(orders);
}

// ── Inbox ─────────────────────────────────────────────────────────────────

export async function readInbox(): Promise<InboxEntry[]> {
  const parsed = await readJson<{ entries?: InboxEntry[] }>(INBOX, {});
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

export async function appendInbox(entries: InboxEntry[]): Promise<boolean> {
  if (!entries.length) return true;
  const current = await readInbox();
  return writeJson(INBOX, { entries: [...current, ...entries] });
}

/** Remove replayed entries. The renderer acks AFTER applying them to stores. */
export async function ackInbox(ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const keep = (await readInbox()).filter((e) => !ids.includes(e.id));
  return writeJson(INBOX, { entries: keep });
}
