'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { migrateThemeId, type ThemeId } from '@/lib/themes/app-themes';
import { getGatedStorage } from '@/lib/gated-storage';

export type Surface = 'chat' | 'cowork' | 'code' | 'browser' | 'assistant';
/** Re-exported so existing imports keep working; the list lives in one place. */
export type Theme = ThemeId;

export type SidebarMode = 'history' | 'projects' | 'customize';
export type CustomizeSection = 'landing' | 'skills' | 'connectors' | 'browse-connectors' | 'browse-marketplace' | 'automation' | 'agents' | 'design';

interface AppState {
  activeSurface: Surface;
  sidebarVisible: boolean;
  theme: Theme;
  settingsOpen: boolean;
  sidebarMode: SidebarMode;
  viewingProjectId: string | null;
  customizeSection: CustomizeSection;
  selectedSkillId: string | null;
  selectedConnectorId: string | null;
  selectedAgentName: string | null;
  heartbeatPanelOpen: boolean;
}

interface AppActions {
  setActiveSurface: (surface: Surface) => void;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  setTheme: (theme: Theme) => void;
  setSettingsOpen: (open: boolean) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  setViewingProjectId: (id: string | null) => void;
  navigateToProject: (projectId: string) => void;
  setCustomizeSection: (section: CustomizeSection) => void;
  setSelectedSkillId: (id: string | null) => void;
  setSelectedConnectorId: (id: string | null) => void;
  setSelectedAgentName: (name: string | null) => void;
  setHeartbeatPanelOpen: (open: boolean) => void;
}

export type AppStore = AppState & AppActions;

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      // State
      activeSurface: 'chat',
      sidebarVisible: true,
      theme: 'light',
      settingsOpen: false,
      sidebarMode: 'history',
      viewingProjectId: null,
      customizeSection: 'landing',
      selectedSkillId: null,
      selectedConnectorId: null,
      selectedAgentName: null,
      heartbeatPanelOpen: false,

      // Actions
      setActiveSurface: (surface) => set({ activeSurface: surface }),
      toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
      setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
      setTheme: (theme) => set({ theme }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setSidebarMode: (mode) => set({ sidebarMode: mode }),
      setViewingProjectId: (id) => set({ viewingProjectId: id }),
      navigateToProject: (projectId) => set({ sidebarMode: 'projects', viewingProjectId: projectId }),
      setCustomizeSection: (section) => set({ customizeSection: section, selectedSkillId: null, selectedConnectorId: null, selectedAgentName: null }),
      setSelectedSkillId: (id) => set({ selectedSkillId: id }),
      setSelectedConnectorId: (id) => set({ selectedConnectorId: id }),
      setSelectedAgentName: (name) => set({ selectedAgentName: name }),
      setHeartbeatPanelOpen: (open) => set({ heartbeatPanelOpen: open }),
    }),
    {
      name: 'aime:app',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
      /**
       * v1: "The Emma" was renamed to "Zara".
       *
       * This store had no migration path at all, and a renamed enum value needs
       * one: zustand merges the persisted slice over the defaults, so a stored
       * `theme: 'emma'` would survive as a value nothing recognises, `applyTheme`
       * would match no class, and the user would silently find themselves on
       * light — a theme they never picked, with nothing to explain it.
       */
      version: 1,
      migrate: (persisted: unknown, _version: number) => {
        const state = persisted as Record<string, unknown> | null;
        if (!state) return state as never;
        return { ...state, theme: migrateThemeId(state.theme) } as never;
      },
      partialize: (state) => {
        // These four are transient view state — dropped from the persisted slice.
        const { viewingProjectId, selectedSkillId, selectedConnectorId, selectedAgentName, ...rest } = state;
        return rest;
      },
    }
  )
);
