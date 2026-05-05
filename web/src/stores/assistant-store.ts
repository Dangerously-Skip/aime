'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import type { A2UIDocument } from '@/lib/a2ui/types';

// ── Standing Order ───────────────────────────────────────────────────────────

export interface StandingOrder {
  id: string;
  instruction: string;
  agentName?: string;
  trigger: {
    type: 'cron' | 'interval' | 'event';
    expression?: string;
    event?: string;
  };
  condition?: string;
  completionCondition?: string;
  state: Record<string, unknown>;
  status: 'active' | 'paused' | 'completed' | 'expired';
  maxExecutions?: number;
  expiresAt?: number;
  notifyVia: 'assistant' | 'toast' | string; // string for 'inject:surfaceId'
  lastResult?: string;
  lastSnapshotHash?: string;
  lastRun?: number;
  runCount: number;
  errorCount: number;
  totalCost?: number;
  createdAt: number;
  updatedAt: number;
}

// ── Card Feed ────────────────────────────────────────────────────────────────

export interface AssistantCard {
  id: string;
  orderId?: string;
  title: string;
  summary?: string;
  doc?: A2UIDocument;
  timestamp: number;
  unread: boolean;
  pinned: boolean;
  /**
   * When set, this card is a dashboard widget that auto-refreshes by re-running
   * `widget.regeneratePrompt` on the heartbeat schedule. Pinned widgets persist
   * across sessions; the `lastRefreshedAt` timestamp gates re-firing.
   */
  widget?: {
    refreshIntervalMs: number;
    regeneratePrompt: string;
    lastRefreshedAt?: number;
    /** Optional surface to run the refresh against (default: 'assistant'). */
    surface?: string;
  };
}

// ── Activity Log ─────────────────────────────────────────────────────────────

export interface ActivityEntry {
  id: string;
  timestamp: number;
  type: 'order-created' | 'order-fired' | 'order-completed' | 'order-paused' | 'order-error' | 'user-action';
  label: string;
  detail?: string;
  orderId?: string;
}

// ── Store ────────────────────────────────────────────────────────────────────

interface AssistantState {
  orders: StandingOrder[];
  cards: AssistantCard[];
  activity: ActivityEntry[];
}

interface AssistantActions {
  // Standing order CRUD
  addOrder: (order: Omit<StandingOrder, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'errorCount' | 'state' | 'status'>) => string;
  updateOrder: (id: string, updates: Partial<StandingOrder>) => void;
  removeOrder: (id: string) => void;
  pauseOrder: (id: string) => void;
  resumeOrder: (id: string) => void;
  completeOrder: (id: string) => void;
  resumeAllPaused: () => void;
  getOrder: (id: string) => StandingOrder | undefined;

  // Card feed
  addCard: (card: Omit<AssistantCard, 'id' | 'timestamp' | 'unread' | 'pinned'>) => string;
  dismissCard: (id: string) => void;
  pinCard: (id: string) => void;
  unpinCard: (id: string) => void;
  markAllRead: () => void;
  clearOldCards: (days: number) => void;
  /** Replace a card's body in place (used by widget refresh and card streaming). */
  updateCard: (id: string, updates: Partial<AssistantCard>) => void;

  // Activity log
  addActivity: (entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => void;
  getActivityForOrder: (orderId: string) => ActivityEntry[];

  // Migration
  migrateCronJobs: (cronJobs: Array<{ id: string; expression: string; prompt: string; surfaceId: string; enabled: boolean; createdAt: number }>) => void;
}

export type AssistantStore = AssistantState & AssistantActions;

export const useAssistantStore = create<AssistantStore>()(
  persist(
    (set, get) => ({
      orders: [],
      cards: [],
      activity: [],

      // ── Standing order CRUD ─────────────────────────────────────────────

      addOrder: (order) => {
        const id = crypto.randomUUID();
        const now = Date.now();
        set((state) => ({
          orders: [
            ...state.orders,
            {
              ...order,
              id,
              state: {},
              status: 'active' as const,
              runCount: 0,
              errorCount: 0,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }));
        get().addActivity({ type: 'order-created', label: `Created: ${order.instruction.slice(0, 60)}`, orderId: id });
        import('@/lib/telemetry/events').then(({ sendFeatureAdoptionEvent }) => {
          sendFeatureAdoptionEvent({ feature: 'standing_order', surface: 'assistant' });
        }).catch(() => {});
        return id;
      },

      updateOrder: (id, updates) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === id ? { ...o, ...updates, updatedAt: Date.now() } : o
          ),
        })),

      removeOrder: (id) =>
        set((state) => ({
          orders: state.orders.filter((o) => o.id !== id),
        })),

      pauseOrder: (id) => {
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === id ? { ...o, status: 'paused' as const, updatedAt: Date.now() } : o
          ),
        }));
        get().addActivity({ type: 'order-paused', label: 'Order paused', orderId: id });
      },

      resumeOrder: (id) =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === id ? { ...o, status: 'active' as const, errorCount: 0, updatedAt: Date.now() } : o
          ),
        })),

      completeOrder: (id) => {
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === id ? { ...o, status: 'completed' as const, updatedAt: Date.now() } : o
          ),
        }));
        get().addActivity({ type: 'order-completed', label: 'Order completed', orderId: id });
      },

      resumeAllPaused: () =>
        set((state) => ({
          orders: state.orders.map((o) =>
            o.status === 'paused' ? { ...o, status: 'active' as const, errorCount: 0, updatedAt: Date.now() } : o
          ),
        })),

      getOrder: (id) => get().orders.find((o) => o.id === id),

      // ── Card feed ───────────────────────────────────────────────────────

      addCard: (card) => {
        const id = crypto.randomUUID();
        // Widgets default to pinned so they persist as dashboard tiles.
        const isWidget = !!card.widget;
        set((state) => ({
          cards: [
            { ...card, id, timestamp: Date.now(), unread: !isWidget, pinned: isWidget },
            ...state.cards,
          ],
        }));
        return id;
      },

      updateCard: (id, updates) =>
        set((state) => ({
          cards: state.cards.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        })),

      dismissCard: (id) =>
        set((state) => ({ cards: state.cards.filter((c) => c.id !== id) })),

      pinCard: (id) =>
        set((state) => ({
          cards: state.cards.map((c) => (c.id === id ? { ...c, pinned: true } : c)),
        })),

      unpinCard: (id) =>
        set((state) => ({
          cards: state.cards.map((c) => (c.id === id ? { ...c, pinned: false } : c)),
        })),

      markAllRead: () =>
        set((state) => ({
          cards: state.cards.map((c) => ({ ...c, unread: false })),
        })),

      clearOldCards: (days) => {
        const cutoff = Date.now() - days * 86400000;
        set((state) => ({
          cards: state.cards.filter((c) => c.pinned || c.timestamp > cutoff),
        }));
      },

      // ── Activity log ────────────────────────────────────────────────────

      addActivity: (entry) =>
        set((state) => ({
          activity: [
            { ...entry, id: crypto.randomUUID(), timestamp: Date.now() },
            ...state.activity.slice(0, 499), // Keep last 500 entries
          ],
        })),

      getActivityForOrder: (orderId) =>
        get().activity.filter((a) => a.orderId === orderId),

      // ── Migration ───────────────────────────────────────────────────────

      migrateCronJobs: (cronJobs) => {
        const existingIds = new Set(get().orders.map((o) => o.id));
        const newOrders: StandingOrder[] = [];
        const now = Date.now();

        for (const job of cronJobs) {
          if (existingIds.has(job.id)) continue;
          newOrders.push({
            id: job.id,
            instruction: job.prompt,
            trigger: { type: 'cron', expression: job.expression },
            state: {},
            status: job.enabled ? 'active' : 'paused',
            notifyVia: 'assistant',
            runCount: 0,
            errorCount: 0,
            createdAt: job.createdAt,
            updatedAt: now,
          });
        }

        if (newOrders.length > 0) {
          set((state) => ({ orders: [...state.orders, ...newOrders] }));
          get().addActivity({
            type: 'user-action',
            label: `Migrated ${newOrders.length} cron job(s) to standing orders`,
          });
        }
      },
    }),
    {
      name: 'nibcowork:assistant',
      storage: createJSONStorage(() => getGatedStorage()),
      partialize: (state) => ({
        orders: state.orders,
        cards: state.cards.slice(0, 100), // Keep at most 100 cards
        activity: state.activity.slice(0, 200), // Keep at most 200 activity entries
      }),
      skipHydration: true,
    }
  )
);
