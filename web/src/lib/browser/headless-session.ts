import { RemoteWebview, type RemoteCall } from './remote-webview';

/**
 * Borrow a browser from the main process, for work with no window.
 *
 * WHY THE MAIN PROCESS OWNS IT. The Next server runs as an Electron
 * `utilityProcess`, which cannot create a `BrowserWindow`. Relaying through the
 * renderer — the way document printing does — fails for the case that matters:
 * the widget scheduler exists so a refresh works with the window CLOSED, and a
 * browser that needs an open window is no use to work that runs because the
 * window is shut.
 *
 * WHAT CROSSES THE BOUNDARY. Method names and arguments, and back: a string, a
 * data URL, or an error. Never page content evaluated as code — the tools inject
 * strings into the PAGE's context and read values back, which is the existing
 * design and the reason the main process is not made unsafe by this.
 *
 * THE LIFECYCLE IS THE RISKY PART, not the tools (DR-23 D-3). A window belongs to
 * a run, dies with it including on abort, and is capped so a nightly fan-out
 * cannot open one Chromium per job. All of that lives here rather than in the
 * caller, because a caller that forgets to close is the failure mode.
 */

/** How many headless windows may exist at once, across all runs. */
export const MAX_HEADLESS_SESSIONS = 2;

/** A session with no activity for this long is reclaimed. */
export const HEADLESS_IDLE_MS = 5 * 60_000;

export interface HeadlessTransport {
  /** Ask main to open a browser. Resolves with its session id. */
  open(sessionId: string): Promise<void>;
  /** Drive it. */
  call(call: RemoteCall): Promise<unknown>;
  /** Close it. Must be safe to call twice. */
  close(sessionId: string): Promise<void>;
  /** False when there is no main process to ask — dev, or a non-Electron host. */
  available(): boolean;
}

interface Live {
  id: string;
  lastUsedAt: number;
  webview: RemoteWebview;
}

const KEY = Symbol.for('aime.headless.sessions');

function registry(): Map<string, Live> {
  const g = globalThis as unknown as Record<symbol, Map<string, Live> | undefined>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

/** Transport, injected once at startup. Absent ⇒ headless browsing is off. */
let transport: HeadlessTransport | null = null;

export function setHeadlessTransport(t: HeadlessTransport | null): void {
  transport = t;
}

export function headlessAvailable(): boolean {
  return !!transport && transport.available();
}

export class HeadlessUnavailable extends Error {}

/**
 * Open a browser for a run, or explain why not.
 *
 * THROWS RATHER THAN RETURNING NULL, deliberately. A caller that gets null tends
 * to carry on without a browser and produce a confidently wrong answer from
 * whatever it could reach; a caller that catches has to decide. The message names
 * the reason, because "unavailable" alone sends a model round the same loop.
 */
export async function openHeadlessSession(runId: string, nowMs = Date.now()): Promise<RemoteWebview> {
  if (!transport || !transport.available()) {
    throw new HeadlessUnavailable(
      'No headless browser is available in this build, so pages that need a real browser cannot ' +
        'be opened. Use FetchUrl for static pages, and say plainly if the task needed a session ' +
        'or a click.',
    );
  }

  const live = registry();
  const existing = live.get(runId);
  if (existing) {
    existing.lastUsedAt = nowMs;
    return existing.webview;
  }

  reclaimIdle(nowMs);

  if (live.size >= MAX_HEADLESS_SESSIONS) {
    /*
     * Queueing was the other option and is worse here: the caller is a scheduled
     * run with a budget and a deadline, and waiting behind another run's page
     * load spends both on nothing. Refusing lets it fall back to fetching.
     */
    throw new HeadlessUnavailable(
      `All ${MAX_HEADLESS_SESSIONS} headless browsers are in use by other runs. Try FetchUrl, or ` +
        `run this again when the others have finished.`,
    );
  }

  await transport.open(runId);
  const webview = new RemoteWebview(runId, (call) => {
    const s = registry().get(runId);
    if (s) s.lastUsedAt = Date.now();
    return transport!.call(call);
  });
  live.set(runId, { id: runId, lastUsedAt: nowMs, webview });
  return webview;
}

/** Close a run's browser. Safe to call for a run that never opened one. */
export async function closeHeadlessSession(runId: string): Promise<void> {
  const live = registry();
  if (!live.delete(runId)) return;
  await transport?.close(runId).catch(() => {});
}

/**
 * Reclaim sessions nothing has touched.
 *
 * A run that hangs must not hold a window for ever — that is how a cap becomes a
 * permanent outage rather than a queue.
 */
export function reclaimIdle(nowMs = Date.now()): string[] {
  const live = registry();
  const dead: string[] = [];
  for (const [id, s] of live) {
    if (nowMs - s.lastUsedAt >= HEADLESS_IDLE_MS) dead.push(id);
  }
  for (const id of dead) {
    live.delete(id);
    void transport?.close(id).catch(() => {});
  }
  return dead;
}

/** Test/observability helper. */
export function headlessSessionCount(): number {
  return registry().size;
}

/** Close everything. For shutdown, and for tests. */
export async function closeAllHeadlessSessions(): Promise<void> {
  const ids = [...registry().keys()];
  registry().clear();
  await Promise.all(ids.map((id) => transport?.close(id).catch(() => {})));
}
