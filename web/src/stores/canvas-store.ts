'use client';

import { create } from 'zustand';
import type { A2UIDocument, A2UIComponent } from '@/lib/a2ui/types';

/**
 * Per-surface canvas state. Each surface (chat, cowork, code, ...) keeps its
 * own current document, history, and open flag. Previously this was global,
 * which meant the most recently-pushed canvas leaked into other surfaces.
 */
interface SurfaceCanvasState {
  doc: A2UIDocument | null;
  history: A2UIDocument[];
  historyIndex: number;
  open: boolean;
  /**
   * Conversation that produced the current `doc`. canvas-overlay reads this
   * and refuses to render if it doesn't match its current conversationId —
   * stops canvases from a previous chat bleeding into a freshly-opened one.
   */
  conversationId: string | null;
}

interface CanvasState {
  bySurface: Record<string, SurfaceCanvasState>;
}

interface CanvasActions {
  pushCanvas: (surfaceId: string, doc: A2UIDocument, conversationId?: string | null) => void;
  clearCanvas: (surfaceId: string) => void;
  goBack: (surfaceId: string) => void;
  goForward: (surfaceId: string) => void;
  setOpen: (surfaceId: string, open: boolean) => void;
  isOpen: (surfaceId: string) => boolean;
  updateComponent: (
    surfaceId: string,
    componentId: string,
    updater: (comp: A2UIComponent) => A2UIComponent,
  ) => void;
  /** Read-only accessor for a surface's state. Always returns a defined object. */
  getSurface: (surfaceId: string) => SurfaceCanvasState;
}

export type CanvasStore = CanvasState & CanvasActions;

const EMPTY_SURFACE: SurfaceCanvasState = {
  doc: null,
  history: [],
  historyIndex: -1,
  open: false,
  conversationId: null,
};

function ensureSurface(state: CanvasState, surfaceId: string): SurfaceCanvasState {
  return state.bySurface[surfaceId] ?? EMPTY_SURFACE;
}

export const useCanvasStore = create<CanvasStore>()((set, get) => ({
  bySurface: {},

  pushCanvas: (surfaceId, doc, conversationId = null) =>
    set((state) => {
      const prev = ensureSurface(state, surfaceId);
      // If the conversation changed, drop the prior history — it belonged to a
      // different chat and shouldn't be navigable via back/forward.
      const sameConversation = !conversationId || prev.conversationId === conversationId || prev.conversationId === null;
      const baseHistory = sameConversation ? prev.history.slice(0, prev.historyIndex + 1) : [];
      const newHistory = [...baseHistory, doc];
      return {
        bySurface: {
          ...state.bySurface,
          [surfaceId]: {
            ...prev,
            doc,
            history: newHistory,
            historyIndex: newHistory.length - 1,
            conversationId: conversationId ?? prev.conversationId,
          },
        },
      };
    }),

  clearCanvas: (surfaceId) =>
    set((state) => ({
      bySurface: {
        ...state.bySurface,
        [surfaceId]: { ...EMPTY_SURFACE, open: state.bySurface[surfaceId]?.open ?? false },
      },
    })),

  goBack: (surfaceId) =>
    set((state) => {
      const prev = ensureSurface(state, surfaceId);
      const newIndex = prev.historyIndex - 1;
      if (newIndex < 0) return state;
      return {
        bySurface: {
          ...state.bySurface,
          [surfaceId]: { ...prev, historyIndex: newIndex, doc: prev.history[newIndex] },
        },
      };
    }),

  goForward: (surfaceId) =>
    set((state) => {
      const prev = ensureSurface(state, surfaceId);
      const newIndex = prev.historyIndex + 1;
      if (newIndex >= prev.history.length) return state;
      return {
        bySurface: {
          ...state.bySurface,
          [surfaceId]: { ...prev, historyIndex: newIndex, doc: prev.history[newIndex] },
        },
      };
    }),

  setOpen: (surfaceId, open) =>
    set((state) => {
      const prev = ensureSurface(state, surfaceId);
      return {
        bySurface: { ...state.bySurface, [surfaceId]: { ...prev, open } },
      };
    }),

  isOpen: (surfaceId) => !!get().bySurface[surfaceId]?.open,

  updateComponent: (surfaceId, componentId, updater) =>
    set((state) => {
      const prev = ensureSurface(state, surfaceId);
      if (!prev.doc) return state;
      const updatedComponents = prev.doc.components.map((c) =>
        c.id === componentId ? updater(c) : c,
      );
      const updatedDoc = { ...prev.doc, components: updatedComponents };
      const updatedHistory = [...prev.history];
      if (prev.historyIndex >= 0) {
        updatedHistory[prev.historyIndex] = updatedDoc;
      }
      return {
        bySurface: {
          ...state.bySurface,
          [surfaceId]: { ...prev, doc: updatedDoc, history: updatedHistory },
        },
      };
    }),

  getSurface: (surfaceId) => ensureSurface(get(), surfaceId),
}));
