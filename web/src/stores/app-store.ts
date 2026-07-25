'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';

export type Surface = 'chat' | 'cowork' | 'code' | 'browser' | 'assistant';
export type Theme = 'light' | 'dark' | 'system' | 'emma';

export type SidebarMode = 'history' | 'projects' | 'customize';
export type CustomizeSection = 'landing' | 'skills' | 'connectors' | 'browse-connectors' | 'browse-marketplace' | 'automation' | 'agents';

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
      partialize: (state) => {
        // These four are transient view state — dropped from the persisted slice.
        const { viewingProjectId, selectedSkillId, selectedConnectorId, selectedAgentName, ...rest } = state;
        return rest;
      },
    }
  )
);
