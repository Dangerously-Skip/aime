'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ChatFont = 'default' | 'sans' | 'mono' | 'system';
export type ToolAccessMode = 'onDemand' | 'alwaysLoaded';

interface SettingsState {
  // Profile
  fullName: string;
  displayName: string;
  workFunction: string;
  personalPreferences: string;

  // Appearance
  chatFont: ChatFont;

  // Capabilities
  toolAccessMode: ToolAccessMode;

  // Cowork
  coworkInstructions: string;

  // Code
  codeWorktreeLocation: string;
  codeBranchPrefix: string;

  // Folder picker
  recentFolders: string[];
  trustedFolders: string[];

  // GitHub
  githubToken: string | null;
  githubUser: string | null;

  // nib Gateway
  nibGatewayApiKey: string | null;

  // Memory
  autoExtractMemories: boolean;
}

interface SettingsActions {
  setFullName: (name: string) => void;
  setDisplayName: (name: string) => void;
  setWorkFunction: (fn: string) => void;
  setPersonalPreferences: (prefs: string) => void;
  setChatFont: (font: ChatFont) => void;
  setToolAccessMode: (mode: ToolAccessMode) => void;
  setCoworkInstructions: (instructions: string) => void;
  setCodeWorktreeLocation: (location: string) => void;
  setCodeBranchPrefix: (prefix: string) => void;
  addRecentFolder: (path: string) => void;
  addTrustedFolder: (path: string) => void;
  setGithubToken: (token: string | null) => void;
  setGithubUser: (user: string | null) => void;
  clearGithubAuth: () => void;
  setNibGatewayApiKey: (key: string | null) => void;
  setAutoExtractMemories: (enabled: boolean) => void;
  resetAll: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;

const initialState: SettingsState = {
  fullName: '',
  displayName: '',
  workFunction: '',
  personalPreferences: '',
  chatFont: 'default',
  toolAccessMode: 'onDemand',
  coworkInstructions: '',
  codeWorktreeLocation: '',
  codeBranchPrefix: '',
  recentFolders: [],
  trustedFolders: [],
  githubToken: null,
  githubUser: null,
  nibGatewayApiKey: null,
  autoExtractMemories: true,
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...initialState,

      setFullName: (fullName) => set({ fullName }),
      setDisplayName: (displayName) => set({ displayName }),
      setWorkFunction: (workFunction) => set({ workFunction }),
      setPersonalPreferences: (personalPreferences) => set({ personalPreferences }),
      setChatFont: (chatFont) => set({ chatFont }),
      setToolAccessMode: (toolAccessMode) => set({ toolAccessMode }),
      setCoworkInstructions: (coworkInstructions) => set({ coworkInstructions }),
      setCodeWorktreeLocation: (codeWorktreeLocation) => set({ codeWorktreeLocation }),
      setCodeBranchPrefix: (codeBranchPrefix) => set({ codeBranchPrefix }),

      addRecentFolder: (path) =>
        set((state) => {
          const filtered = state.recentFolders.filter((f) => f !== path);
          return { recentFolders: [path, ...filtered].slice(0, 10) };
        }),

      addTrustedFolder: (path) =>
        set((state) => {
          if (state.trustedFolders.includes(path)) return state;
          // Limit to 100 trusted folders — drop oldest when exceeded
          const updated = [...state.trustedFolders, path];
          return { trustedFolders: updated.length > 100 ? updated.slice(-100) : updated };
        }),

      setGithubToken: (githubToken) => set({ githubToken }),
      setGithubUser: (githubUser) => set({ githubUser }),
      clearGithubAuth: () => set({ githubToken: null, githubUser: null }),

      setNibGatewayApiKey: (nibGatewayApiKey) => set({ nibGatewayApiKey }),

      setAutoExtractMemories: (autoExtractMemories) => set({ autoExtractMemories }),

      resetAll: () => set(initialState),
    }),
    {
      name: 'nibcowork:settings',
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 1,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        if (version === 0) {
          // v0 -> v1: ensure all fields exist with defaults
          return { ...initialState, ...state } as unknown as SettingsState & SettingsActions;
        }
        return state as unknown as SettingsState & SettingsActions;
      },
      partialize: (state) => ({
        fullName: state.fullName,
        displayName: state.displayName,
        workFunction: state.workFunction,
        personalPreferences: state.personalPreferences,
        chatFont: state.chatFont,
        toolAccessMode: state.toolAccessMode,
        coworkInstructions: state.coworkInstructions,
        codeWorktreeLocation: state.codeWorktreeLocation,
        codeBranchPrefix: state.codeBranchPrefix,
        recentFolders: state.recentFolders,
        trustedFolders: state.trustedFolders,
        githubToken: state.githubToken,
        githubUser: state.githubUser,
        nibGatewayApiKey: state.nibGatewayApiKey,
        autoExtractMemories: state.autoExtractMemories,
      }),
    }
  )
);
