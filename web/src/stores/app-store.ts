'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Surface = 'chat' | 'cowork' | 'code' | 'browser';
export type Theme = 'light' | 'dark' | 'system';

export type SidebarMode = 'history' | 'projects';

interface AppState {
  activeSurface: Surface;
  sidebarVisible: boolean;
  theme: Theme;
  settingsOpen: boolean;
  sidebarMode: SidebarMode;
  viewingProjectId: string | null;
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

      // Actions
      setActiveSurface: (surface) => set({ activeSurface: surface }),
      toggleSidebar: () => set((state) => ({ sidebarVisible: !state.sidebarVisible })),
      setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
      setTheme: (theme) => set({ theme }),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setSidebarMode: (mode) => set({ sidebarMode: mode }),
      setViewingProjectId: (id) => set({ viewingProjectId: id }),
      navigateToProject: (projectId) => set({ sidebarMode: 'projects', viewingProjectId: projectId }),
    }),
    {
      name: 'nibcowork:app',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { viewingProjectId, ...rest } = state;
        return rest;
      },
    }
  )
);
