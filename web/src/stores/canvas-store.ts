'use client';

import { create } from 'zustand';
import type { A2UIDocument } from '@/lib/a2ui/types';

interface CanvasState {
  canvasDoc: A2UIDocument | null;
  history: A2UIDocument[];
  historyIndex: number;
  openSurfaces: Record<string, boolean>;
}

interface CanvasActions {
  pushCanvas: (doc: A2UIDocument) => void;
  clearCanvas: () => void;
  goBack: () => void;
  goForward: () => void;
  setOpen: (surfaceId: string, open: boolean) => void;
  isOpen: (surfaceId: string) => boolean;
}

export type CanvasStore = CanvasState & CanvasActions;

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
  canvasDoc: null,
  history: [],
  historyIndex: -1,
  openSurfaces: {} as Record<string, boolean>,

  pushCanvas: (doc) =>
    set((state) => {
      // Truncate forward history when pushing new doc
      const newHistory = [...state.history.slice(0, state.historyIndex + 1), doc];
      return {
        canvasDoc: doc,
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    }),

  clearCanvas: () => set({ canvasDoc: null, history: [], historyIndex: -1 }),

  goBack: () =>
    set((state) => {
      const newIndex = state.historyIndex - 1;
      if (newIndex < 0) return state;
      return {
        historyIndex: newIndex,
        canvasDoc: state.history[newIndex],
      };
    }),

  goForward: () =>
    set((state) => {
      const newIndex = state.historyIndex + 1;
      if (newIndex >= state.history.length) return state;
      return {
        historyIndex: newIndex,
        canvasDoc: state.history[newIndex],
      };
    }),

  setOpen: (surfaceId, open) =>
    set((state) => ({
      openSurfaces: { ...state.openSurfaces, [surfaceId]: open },
    })),

  isOpen: (surfaceId) => !!get().openSurfaces[surfaceId],
}));
