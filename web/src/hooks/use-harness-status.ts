'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { HarnessStatus } from '@/components/harness/goal-panel';
import { useSurfaceActive } from '@/hooks/use-surface-active';

/**
 * ONE poll of `/api/harness` per conversation, shared by every consumer.
 *
 * Five components polled it independently — the question card (2s), the goal
 * panel (2s), the run status (3s), the transcript narrator (3s) and the
 * panel auto-opener (5s) — on Code and Cowork, whether or not either surface
 * was on screen, whether or not the window was, and whether or not the
 * conversation had ever had a goal. That is well over a request a second per
 * surface for a feature most conversations never use.
 *
 * Now:
 *  - one in-flight request per (conversation, folder), fanned out to all
 *    subscribers through `useSyncExternalStore`;
 *  - fast polling (2s) only while a run is RUNNING; otherwise a slow idle
 *    check (30s) — a run started from the UI calls `refresh()` rather than
 *    waiting for it;
 *  - no polling at all while every subscriber's surface is hidden, or while
 *    the window is (`document.visibilityState`), with an immediate refetch on
 *    return.
 */

export const ACTIVE_POLL_MS = 2_000;
export const IDLE_POLL_MS = 30_000;

interface Entry {
  key: string;
  url: string;
  status: HarnessStatus | null;
  listeners: Set<() => void>;
  /** Mounted consumers whose surface is on screen — the demand for polling. */
  demand: number;
  timer: ReturnType<typeof setTimeout> | null;
  inflight: Promise<void> | null;
}

const entries = new Map<string, Entry>();
let visibilityHooked = false;

const keyOf = (conversationId: string, workingDir: string) => `${conversationId}\u0000${workingDir}`;

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function hookVisibility() {
  if (visibilityHooked || typeof document === 'undefined') return;
  visibilityHooked = true;
  document.addEventListener('visibilitychange', () => {
    for (const e of entries.values()) {
      if (!pageVisible()) clearTimer(e);
      else if (e.demand > 0) void fetchNow(e);
    }
  });
}

function clearTimer(e: Entry) {
  if (e.timer) clearTimeout(e.timer);
  e.timer = null;
}

function schedule(e: Entry) {
  clearTimer(e);
  if (e.demand === 0 || !pageVisible() || entries.get(e.key) !== e) return;
  const delay = e.status?.running ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  e.timer = setTimeout(() => {
    e.timer = null;
    void fetchNow(e);
  }, delay);
}

function fetchNow(e: Entry): Promise<void> {
  if (e.inflight) return e.inflight;
  clearTimer(e);
  e.inflight = (async () => {
    try {
      const res = await fetch(e.url);
      if (res.ok) {
        e.status = (await res.json()) as HarnessStatus;
        for (const l of e.listeners) l();
      }
    } catch {
      // A failed poll is not worth surfacing; the next one is scheduled below.
    } finally {
      e.inflight = null;
      schedule(e);
    }
  })();
  return e.inflight;
}

function acquire(conversationId: string, workingDir: string): Entry {
  const key = keyOf(conversationId, workingDir);
  let e = entries.get(key);
  if (!e) {
    e = {
      key,
      url: `/api/harness?conversationId=${encodeURIComponent(conversationId)}&workingDir=${encodeURIComponent(workingDir)}`,
      status: null,
      listeners: new Set(),
      demand: 0,
      timer: null,
      inflight: null,
    };
    entries.set(key, e);
    hookVisibility();
  }
  return e;
}

function releaseIfUnused(e: Entry) {
  if (e.demand > 0 || e.listeners.size > 0) return;
  clearTimer(e);
  entries.delete(e.key);
}

/** Force an immediate fetch — after starting, answering or stopping a run. */
export function refreshHarnessStatus(conversationId: string, workingDir: string | null): Promise<void> {
  if (!conversationId || !workingDir) return Promise.resolve();
  const e = entries.get(keyOf(conversationId, workingDir));
  return e ? fetchNow(e) : Promise.resolve();
}

/** Test seam: forget every entry and timer. */
export function resetHarnessStatusForTests(): void {
  for (const e of entries.values()) clearTimer(e);
  entries.clear();
}

export function useHarnessStatus(
  conversationId: string,
  workingDir: string | null,
): { status: HarnessStatus | null; refresh: () => Promise<void> } {
  const surfaceActive = useSurfaceActive();
  const enabled = !!conversationId && !!workingDir;
  const key = enabled ? keyOf(conversationId, workingDir) : null;

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled) return () => {};
      const e = acquire(conversationId, workingDir!);
      e.listeners.add(onChange);
      return () => {
        e.listeners.delete(onChange);
        releaseIfUnused(e);
      };
    },
    [enabled, conversationId, workingDir],
  );
  const status = useSyncExternalStore(
    subscribe,
    () => (key ? entries.get(key)?.status ?? null : null),
    () => null,
  );

  // Polling demand: only while this consumer's surface is on screen.
  useEffect(() => {
    if (!enabled || !surfaceActive) return;
    const e = acquire(conversationId, workingDir!);
    e.demand += 1;
    // The first demand (mount, or returning to a hidden surface) fetches now;
    // the rest share that request or the running schedule.
    if (e.demand === 1 && pageVisible()) void fetchNow(e);
    return () => {
      e.demand -= 1;
      if (e.demand === 0) clearTimer(e);
      releaseIfUnused(e);
    };
  }, [enabled, surfaceActive, conversationId, workingDir]);

  const refresh = useCallback(
    () => refreshHarnessStatus(conversationId, workingDir),
    [conversationId, workingDir],
  );

  return { status, refresh };
}
