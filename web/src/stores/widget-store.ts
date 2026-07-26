'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import type { Widget } from '@/lib/widgets/widget';
import type { WidgetNode } from '@/lib/widgets/catalog';

/**
 * Cockpit widgets (`aime:widgets`). A widget is a stored RECIPE plus its last
 * rendered node — small and bounded (the coercer caps node size), so
 * localStorage is fine here, unlike run records.
 *
 * The persisted `render` is treated as untrusted on read: tiles re-validate
 * through `parseWidget` on every render. We don't trust our own stored bytes,
 * because they originated from a model reading data we don't control.
 */

interface WidgetState {
  widgets: Widget[];
}

interface WidgetActions {
  /** Upsert by id so re-adding edits rather than duplicates. */
  addWidget: (widget: Widget) => void;
  updateWidget: (id: string, patch: Partial<Widget>) => void;
  removeWidget: (id: string) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  /** Store a successful refresh result. */
  setRender: (id: string, node: WidgetNode, refreshedAt: number) => void;
  getWidget: (id: string) => Widget | undefined;
}

export type WidgetStore = WidgetState & WidgetActions;

export const useWidgetStore = create<WidgetStore>()(
  persist(
    (set, get) => ({
      widgets: [],

      addWidget: (widget) =>
        set((state) => ({
          widgets: [...state.widgets.filter((w) => w.id !== widget.id), widget],
        })),

      updateWidget: (id, patch) =>
        set((state) => ({
          widgets: state.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
        })),

      removeWidget: (id) =>
        set((state) => ({ widgets: state.widgets.filter((w) => w.id !== id) })),

      setEnabled: (id, enabled) =>
        set((state) => ({
          widgets: state.widgets.map((w) => (w.id === id ? { ...w, enabled } : w)),
        })),

      setRender: (id, node, refreshedAt) =>
        set((state) => ({
          widgets: state.widgets.map((w) =>
            w.id === id ? { ...w, render: node, refreshedAt } : w,
          ),
        })),

      getWidget: (id) => get().widgets.find((w) => w.id === id),
    }),
    {
      name: 'aime:widgets',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
    },
  ),
);
