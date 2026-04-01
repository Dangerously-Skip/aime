'use client';

import { create } from 'zustand';

/**
 * Context Bus — cross-surface event pub/sub.
 *
 * Events are published by the standing order engine or assistant surface,
 * and consumed by target surfaces before each LLM call to inject background
 * context into the model's system prompt.
 *
 * Priority levels:
 * - P0 (urgent): inject immediately + desktop notification
 * - P1 (relevant): queue for next turn boundary
 * - P2 (informational): show in assistant feed only
 *
 * Events are ephemeral — not persisted to localStorage.
 */

export interface ContextEvent {
  id: string;
  source: string;                // "standing-order:{orderId}" or "assistant" or "user"
  priority: 'p0' | 'p1' | 'p2';
  targetSurface?: string;        // specific surface, or undefined for broadcast
  summary: string;               // human-readable summary
  payload?: Record<string, unknown>;
  timestamp: number;
  consumed: boolean;
}

interface ContextBusState {
  events: ContextEvent[];
}

interface ContextBusActions {
  /** Publish a new event to the bus */
  publish: (event: Omit<ContextEvent, 'id' | 'timestamp' | 'consumed'>) => void;
  /** Mark a single event as consumed */
  consume: (eventId: string) => void;
  /** Mark all unconsumed events for a surface as consumed */
  consumeAll: (surface: string) => void;
  /** Get unconsumed events, optionally filtered by target surface */
  getUnconsumed: (surface?: string) => ContextEvent[];
  /** Get count of unconsumed P0/P1 events for a surface (for badges) */
  getUnreadCount: (surface: string) => number;
  /** Remove events older than N minutes */
  clearOlderThan: (minutes: number) => void;
}

export type ContextBusStore = ContextBusState & ContextBusActions;

export const useContextBusStore = create<ContextBusStore>()((set, get) => ({
  events: [],

  publish: (event) =>
    set((state) => ({
      events: [
        ...state.events,
        {
          ...event,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          consumed: false,
        },
      ],
    })),

  consume: (eventId) =>
    set((state) => ({
      events: state.events.map((e) =>
        e.id === eventId ? { ...e, consumed: true } : e
      ),
    })),

  consumeAll: (surface) =>
    set((state) => ({
      events: state.events.map((e) =>
        !e.consumed && (!e.targetSurface || e.targetSurface === surface)
          ? { ...e, consumed: true }
          : e
      ),
    })),

  getUnconsumed: (surface?) => {
    const events = get().events.filter((e) => !e.consumed);
    if (!surface) return events;
    return events.filter((e) => !e.targetSurface || e.targetSurface === surface);
  },

  getUnreadCount: (surface) => {
    return get().events.filter(
      (e) => !e.consumed
        && (e.priority === 'p0' || e.priority === 'p1')
        && (!e.targetSurface || e.targetSurface === surface)
    ).length;
  },

  clearOlderThan: (minutes) => {
    const cutoff = Date.now() - minutes * 60000;
    set((state) => ({
      events: state.events.filter((e) => e.timestamp > cutoff),
    }));
  },
}));
