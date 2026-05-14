'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  type PanelSlot,
  type RegionId,
  type WorkspaceLayout,
  type WorkspaceTab,
} from '@/lib/code-workspace/types';

/**
 * Per-workspace IDE layout: visibility, sizes, slot assignments, open tabs.
 * Keyed by the workspace folder path so each project remembers its own.
 *
 * The Code surface reads + writes through this store; the actual panel
 * components (Wave 2) just bind their slot's visibility / position.
 */
interface CodeWorkspaceState {
  byWorkspace: Record<string, WorkspaceLayout>;
}

interface CodeWorkspaceActions {
  getLayout: (workspace: string) => WorkspaceLayout;
  setVisible: (workspace: string, slot: PanelSlot, visible: boolean) => void;
  togglePanel: (workspace: string, slot: PanelSlot) => void;
  setSize: (workspace: string, key: keyof WorkspaceLayout['sizes'], value: number) => void;
  assignSlot: (workspace: string, slot: PanelSlot, region: RegionId) => void;
  openTab: (workspace: string, tab: WorkspaceTab) => void;
  closeTab: (workspace: string, tabId: string) => void;
  setActiveTab: (workspace: string, tabId: string | null) => void;
  pinTab: (workspace: string, tabId: string) => void;
  resetLayout: (workspace: string) => void;
  /** Persist the dockview JSON snapshot for a workspace. */
  setDockviewLayout: (workspace: string, layout: unknown) => void;
}

export type CodeWorkspaceStore = CodeWorkspaceState & CodeWorkspaceActions;

function ensure(state: CodeWorkspaceState, ws: string): WorkspaceLayout {
  return state.byWorkspace[ws] ?? DEFAULT_WORKSPACE_LAYOUT;
}

export const useCodeWorkspaceStore = create<CodeWorkspaceStore>()(
  persist(
    (set, get) => ({
      byWorkspace: {},

      getLayout: (ws) => ensure(get(), ws),

      setVisible: (ws, slot, visible) =>
        set((s) => {
          const layout = ensure(s, ws);
          return {
            byWorkspace: {
              ...s.byWorkspace,
              [ws]: { ...layout, visible: { ...layout.visible, [slot]: visible } },
            },
          };
        }),

      togglePanel: (ws, slot) =>
        set((s) => {
          const layout = ensure(s, ws);
          return {
            byWorkspace: {
              ...s.byWorkspace,
              [ws]: {
                ...layout,
                visible: { ...layout.visible, [slot]: !layout.visible[slot] },
              },
            },
          };
        }),

      setSize: (ws, key, value) =>
        set((s) => {
          const layout = ensure(s, ws);
          return {
            byWorkspace: {
              ...s.byWorkspace,
              [ws]: { ...layout, sizes: { ...layout.sizes, [key]: value } },
            },
          };
        }),

      assignSlot: (ws, slot, region) =>
        set((s) => {
          const layout = ensure(s, ws);
          return {
            byWorkspace: {
              ...s.byWorkspace,
              [ws]: {
                ...layout,
                slotAssignments: { ...layout.slotAssignments, [slot]: region },
              },
            },
          };
        }),

      openTab: (ws, tab) =>
        set((s) => {
          const layout = ensure(s, ws);
          const existing = layout.openTabs.find((t) => t.id === tab.id);
          if (existing) {
            return {
              byWorkspace: {
                ...s.byWorkspace,
                [ws]: { ...layout, activeTabId: tab.id },
              },
            };
          }
          // If we're opening a preview (unpinned) tab, replace the previous
          // preview tab. Pinned tabs are always additive.
          let nextTabs = layout.openTabs;
          if (!tab.pinned) {
            nextTabs = layout.openTabs.filter((t) => t.pinned);
          }
          return {
            byWorkspace: {
              ...s.byWorkspace,
              [ws]: {
                ...layout,
                openTabs: [...nextTabs, tab],
                activeTabId: tab.id,
              },
            },
          };
        }),

      closeTab: (ws, tabId) =>
        set((s) => {
          const layout = ensure(s, ws);
          const nextTabs = layout.openTabs.filter((t) => t.id !== tabId);
          const wasActive = layout.activeTabId === tabId;
          return {
            byWorkspace: {
              ...s.byWorkspace,
              [ws]: {
                ...layout,
                openTabs: nextTabs,
                activeTabId: wasActive ? (nextTabs[nextTabs.length - 1]?.id ?? null) : layout.activeTabId,
              },
            },
          };
        }),

      setActiveTab: (ws, tabId) =>
        set((s) => {
          const layout = ensure(s, ws);
          return {
            byWorkspace: {
              ...s.byWorkspace,
              [ws]: { ...layout, activeTabId: tabId },
            },
          };
        }),

      pinTab: (ws, tabId) =>
        set((s) => {
          const layout = ensure(s, ws);
          return {
            byWorkspace: {
              ...s.byWorkspace,
              [ws]: {
                ...layout,
                openTabs: layout.openTabs.map((t) => (t.id === tabId ? { ...t, pinned: true } : t)),
              },
            },
          };
        }),

      resetLayout: (ws) =>
        set((s) => ({
          byWorkspace: { ...s.byWorkspace, [ws]: DEFAULT_WORKSPACE_LAYOUT },
        })),

      setDockviewLayout: (ws, layout) =>
        set((s) => {
          const prev = ensure(s, ws);
          return {
            byWorkspace: {
              ...s.byWorkspace,
              [ws]: { ...prev, dockviewLayout: layout },
            },
          };
        }),
    }),
    {
      name: 'quarry:code-workspace',
      // v4: chat tab now uses the `chat-tab` tabComponent (hideClose);
      //     wipe stored layouts so new chat panels regenerate with it.
      version: 4,
      migrate: () => ({ byWorkspace: {} }),
    },
  ),
);
