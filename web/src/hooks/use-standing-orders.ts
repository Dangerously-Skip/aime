'use client';

import { useEffect, useRef } from 'react';
import { useAssistantStore, type StandingOrder } from '@/stores/assistant-store';
import { useContextBusStore } from '@/stores/context-bus-store';
import type { InboxEntry, ManifestOrder } from '@/lib/orders/manifest';

/**
 * Standing-order SYNC + results replay (C5b).
 *
 * This hook used to evaluate schedules and execute orders from the renderer's
 * minute tick — so a closed window stopped every order. Execution now lives in
 * the server scheduler (lib/orders/scheduler-pass, on the same ticker as
 * widgets), which outlives the window. The renderer's remaining jobs:
 *
 *  - PUSH: mirror the order list to the server manifest whenever it changes.
 *  - PULL manifest: merge back server-owned execution results (lastRun,
 *    runCount, state, errors, terminal status) so counters survive a closed
 *    window.
 *  - REPLAY the inbox: a server-side execution can't touch renderer stores, so
 *    its side effects (cards, context-bus posts, notifications, completion)
 *    arrive as entries here, are applied, and are acknowledged AFTER applying —
 *    a crash mid-replay redelivers rather than drops.
 *
 * Ownership rule: the server executes; the renderer never does. One owner per
 * schedule, no double-fire across the IPC boundary.
 */

/** The manifest projection of a store order. */
function toManifestOrder(order: StandingOrder): ManifestOrder {
  return {
    id: order.id,
    instruction: order.instruction,
    trigger: order.trigger,
    condition: order.condition,
    completionCondition: order.completionCondition,
    agentName: order.agentName,
    notifyVia: order.notifyVia,
    maxExecutions: order.maxExecutions,
    expiresAt: order.expiresAt,
    state: order.state,
    status: order.status,
    lastRun: order.lastRun,
    runCount: order.runCount,
    errorCount: order.errorCount,
    lastSnapshotHash: order.lastSnapshotHash,
    totalCost: order.totalCost,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** Apply one inbox entry to the renderer stores. Exported for tests. */
export function applyInboxEntry(entry: InboxEntry): void {
  const assistant = useAssistantStore.getState();

  if (entry.kind === 'result') {
    let doc: import('@/lib/a2ui/types').A2UIDocument | undefined;
    if (entry.docJson) {
      try {
        doc = JSON.parse(entry.docJson);
      } catch {
        /* malformed doc — card still renders its text */
      }
    }
    assistant.addCard({
      orderId: entry.orderId,
      title: entry.title,
      summary: entry.summary ?? '',
      ...(doc ? { doc } : {}),
    });

    const targetSurface = entry.notifyVia.startsWith('inject:') ? entry.notifyVia.slice(7) : undefined;
    const priority = targetSurface ? 'p0' : 'p2';
    useContextBusStore.getState().publish({
      source: `standing-order:${entry.orderId}`,
      priority: priority as 'p0' | 'p1' | 'p2',
      targetSurface,
      summary: `[${entry.title.slice(0, 40)}] ${(entry.summary ?? '').slice(0, 500)}`,
      payload: { orderId: entry.orderId, fullText: (entry.summary ?? '').slice(0, 2000) },
    });

    if (
      (priority === 'p0' || entry.notifyVia === 'toast') &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification(`Standing Order: ${entry.title.slice(0, 40)}`, {
        body: (entry.summary ?? '').slice(0, 100),
      });
    }

    assistant.addActivity({ type: 'order-fired', label: `Executed: ${entry.title.slice(0, 60)}`, orderId: entry.orderId });
  } else if (entry.kind === 'completed') {
    assistant.completeOrder(entry.orderId);
    assistant.addActivity({ type: 'order-fired', label: `Completed: ${entry.title.slice(0, 60)}`, orderId: entry.orderId });
  } else if (entry.kind === 'paused') {
    assistant.pauseOrder(entry.orderId);
    assistant.addCard({ orderId: entry.orderId, title: entry.title, summary: entry.summary ?? '' });
    assistant.addActivity({ type: 'order-error', label: entry.summary?.slice(0, 100) ?? 'Order paused', orderId: entry.orderId });
  } else if (entry.kind === 'error') {
    assistant.addActivity({ type: 'order-error', label: `Error: ${(entry.error ?? 'unknown').slice(0, 100)}`, orderId: entry.orderId });
  }
}

/** Merge server-owned execution results back onto the store's orders. */
function mergeManifestIntoStore(manifest: ManifestOrder[]): void {
  const byId = new Map(manifest.map((o) => [o.id, o]));
  for (const order of useAssistantStore.getState().orders) {
    const server = byId.get(order.id);
    if (!server) continue;
    if ((server.lastRun ?? 0) <= (order.lastRun ?? 0)) continue;

    useAssistantStore.getState().updateOrder(order.id, {
      lastRun: server.lastRun,
      runCount: server.runCount,
      state: server.state,
      errorCount: server.errorCount,
      lastSnapshotHash: server.lastSnapshotHash,
      totalCost: server.totalCost,
      // Terminal transitions the server made stick; user pause/resume intents
      // travel the other way, via PUSH.
      ...(server.status === 'completed' || server.status === 'expired' || server.status === 'paused'
        ? { status: server.status }
        : {}),
    });
  }
}

export function useStandingOrders() {
  const pushInFlight = useRef(false);
  const lastPushed = useRef('');
  const replayInFlight = useRef(false);

  useEffect(() => {
    const push = async () => {
      if (pushInFlight.current) return;
      const orders = useAssistantStore.getState().orders.map(toManifestOrder);
      const snapshot = JSON.stringify(orders);
      if (snapshot === lastPushed.current) return;
      pushInFlight.current = true;
      try {
        /*
         * PRESERVE ATTENDED JOBS. This mirror replaces the whole manifest with
         * the assistant store's orders, which was safe while it was the only
         * writer — and stopped being safe when attended jobs moved in (DR-24).
         *
         * The file now has two owners: this mirrors UNATTENDED standing orders,
         * and `lib/schedule/write` maintains ATTENDED ones. A wholesale replace
         * deletes every scheduled job the assistant store has never heard of,
         * which is all of them.
         *
         * Found by an e2e whose seeded job kept vanishing — it read as flaky
         * until the second writer turned up.
         */
        let attended: unknown[] = [];
        try {
          const current = await fetch('/api/schedule/orders');
          /*
           * A NON-OK RESPONSE IS ALSO "cannot read", and treating it as an empty
           * manifest was the same bug one level down: `if (current.ok)` left
           * `attended` empty on a 500 and then pushed anyway, deleting exactly
           * the jobs this guard exists to protect. Only a THROWN error was
           * handled, which covers a dropped connection and not a server that
           * answers badly.
           */
          if (!current.ok) throw new Error(`manifest read failed: ${current.status}`);
          const body = (await current.json()) as { orders?: Array<{ attended?: boolean }> };
          attended = (body.orders ?? []).filter((o) => o.attended === true);
        } catch {
          /*
           * Could not read. Push nothing rather than replace with a partial
           * list: losing this cycle's mirror is invisible and recoverable,
           * whereas deleting the user's scheduled jobs is neither.
           */
          pushInFlight.current = false;
          return;
        }

        await fetch('/api/schedule/orders', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orders: [...orders, ...attended] }),
        });
        lastPushed.current = snapshot;
      } catch {
        /* offline — retry on the next change or tick */
      } finally {
        pushInFlight.current = false;
      }
    };

    const pullManifest = async () => {
      try {
        const res = await fetch('/api/schedule/orders');
        if (!res.ok) return;
        const data = (await res.json()) as { orders?: ManifestOrder[] };
        if (Array.isArray(data.orders)) mergeManifestIntoStore(data.orders);
      } catch {
        /* offline */
      }
    };

    const replayInbox = async () => {
      if (replayInFlight.current) return;
      replayInFlight.current = true;
      try {
        const res = await fetch('/api/schedule/orders/inbox');
        if (!res.ok) return;
        const data = (await res.json()) as { entries?: InboxEntry[] };
        const entries = Array.isArray(data.entries) ? data.entries : [];
        if (!entries.length) return;

        for (const entry of entries) applyInboxEntry(entry);
        // Ack AFTER applying: redelivery beats silent loss.
        await fetch('/api/schedule/orders/inbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: entries.map((e) => e.id) }),
        });
      } catch {
        /* offline — entries stay queued */
      } finally {
        replayInFlight.current = false;
      }
    };

    // Launch: reconcile counters, replay anything that happened while closed,
    // then mirror the (possibly updated) order list.
    void pullManifest().then(replayInbox).then(push);

    // PUSH on every order change, debounced by snapshot comparison.
    const unsub = useAssistantStore.subscribe(() => void push());

    // Tick: replay new results while the window is open (registered once —
    // the listener-leak discipline shared with the other minute-tick hooks).
    const api = (window as unknown as { electronAPI?: { onMinuteTick?: (cb: (ts: number) => void) => void } }).electronAPI;
    api?.onMinuteTick?.(() => {
      void replayInbox().then(pullManifest);
    });

    return () => unsub();
  }, []);
}
