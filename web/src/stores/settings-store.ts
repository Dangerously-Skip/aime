'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import type { Tier } from '@/lib/models/types';

export type ChatFont = 'default' | 'sans' | 'mono' | 'system';
export type ToolAccessMode = 'onDemand' | 'alwaysLoaded';
export type ToolProfile = 'minimal' | 'coding' | 'full';
export type SessionResetMode = 'manual' | 'daily' | 'idle';

export interface HeartbeatMode {
  enabled: boolean;
  time: string;         // HH:MM for morning/evening modes
  connectors: string[]; // connector IDs to pull data from
  idleMinutes: number;  // threshold for idle nudge mode
}

export interface HeartbeatModes {
  morning: HeartbeatMode;
  evening: HeartbeatMode;
  idle: HeartbeatMode;
}

export const DEFAULT_HEARTBEAT_MODES: HeartbeatModes = {
  morning: { enabled: false, time: '09:00', connectors: [], idleMinutes: 0 },
  evening: { enabled: false, time: '17:30', connectors: [], idleMinutes: 0 },
  idle:    { enabled: false, time: '',       connectors: [], idleMinutes: 120 },
};

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
  toolProfile: ToolProfile;

  // Automation
  heartbeatEnabled: boolean;
  heartbeatIntervalMinutes: number;
  heartbeatModes: HeartbeatModes;
  loopDetectionThreshold: number;
  sessionResetMode: SessionResetMode;
  sessionResetTime: string;
  sessionIdleMinutes: number;

  // Cowork
  coworkInstructions: string;

  // Code
  codeWorktreeLocation: string;
  codeBranchPrefix: string;

  // Security
  blockDangerousCommands: boolean;
  blockNetworkCommands: boolean;
  restrictToProjectFolder: boolean;
  disableBashTool: boolean;

  // Folder picker
  recentFolders: string[];
  trustedFolders: string[];

  // GitHub
  githubToken: string | null;
  githubUser: string | null;

  // API access
  anthropicApiKey: string | null;

  // Memory
  autoExtractMemories: boolean;

  // Onboarding
  onboardingComplete: boolean;
  onboardingSkippedAt: number | null;
  teamId: string | null;

  // ROI / Telemetry
  devHourlyRate: number;

  /**
   * Per-surface quality/cost tier override, keyed by surfaceId. Absent ⇒ use the
   * surface's default from SURFACE_ROUTES. The capability is a property of the
   * surface and is never user-overridable.
   */
  surfaceTiers: Record<string, Tier>;

  /**
   * Which model fills each tier, keyed by tier — a built-in registry id
   * (`claude-opus`) or a user-provider composite (`prov-1:kimi-k2`). Absent ⇒
   * the tier is filled by price-band inference. This is the "assign models to
   * tiers" grid: 4 decisions, pre-filled, instead of labelling 345 models.
   */
  tierModels: Partial<Record<Tier, string>>;
}

interface SettingsActions {
  setDevHourlyRate: (rate: number) => void;
  /** Set (or clear, with null) a surface's tier override. */
  setSurfaceTier: (surfaceId: string, tier: Tier | null) => void;
  /** Set (or clear, with null) which model fills a tier. */
  setTierModel: (tier: Tier, modelId: string | null) => void;
  setFullName: (name: string) => void;
  setDisplayName: (name: string) => void;
  setWorkFunction: (fn: string) => void;
  setPersonalPreferences: (prefs: string) => void;
  setChatFont: (font: ChatFont) => void;
  setToolAccessMode: (mode: ToolAccessMode) => void;
  setToolProfile: (profile: ToolProfile) => void;
  setHeartbeatEnabled: (enabled: boolean) => void;
  setHeartbeatIntervalMinutes: (minutes: number) => void;
  setHeartbeatMode: (mode: keyof HeartbeatModes, config: Partial<HeartbeatMode>) => void;
  setLoopDetectionThreshold: (threshold: number) => void;
  setSessionResetMode: (mode: SessionResetMode) => void;
  setSessionResetTime: (time: string) => void;
  setSessionIdleMinutes: (minutes: number) => void;
  setCoworkInstructions: (instructions: string) => void;
  setCodeWorktreeLocation: (location: string) => void;
  setCodeBranchPrefix: (prefix: string) => void;
  addRecentFolder: (path: string) => void;
  addTrustedFolder: (path: string) => void;
  setGithubToken: (token: string | null) => void;
  setGithubUser: (user: string | null) => void;
  clearGithubAuth: () => void;
  setAnthropicApiKey: (key: string | null) => void;
  setAutoExtractMemories: (enabled: boolean) => void;
  setBlockDangerousCommands: (enabled: boolean) => void;
  setBlockNetworkCommands: (enabled: boolean) => void;
  setRestrictToProjectFolder: (enabled: boolean) => void;
  setDisableBashTool: (enabled: boolean) => void;
  setOnboardingComplete: (complete: boolean) => void;
  setOnboardingSkippedAt: (timestamp: number | null) => void;
  setTeamId: (id: string | null) => void;
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
  toolProfile: 'full',
  heartbeatEnabled: false,
  heartbeatIntervalMinutes: 30,
  heartbeatModes: DEFAULT_HEARTBEAT_MODES,
  loopDetectionThreshold: 3,
  sessionResetMode: 'manual',
  sessionResetTime: '04:00',
  sessionIdleMinutes: 60,
  coworkInstructions: '',
  codeWorktreeLocation: '',
  codeBranchPrefix: '',
  recentFolders: [],
  trustedFolders: [],
  githubToken: null,
  githubUser: null,
  anthropicApiKey: null,
  autoExtractMemories: true,
  blockDangerousCommands: true,
  blockNetworkCommands: false,
  restrictToProjectFolder: true,
  disableBashTool: false,
  onboardingComplete: false,
  onboardingSkippedAt: null,
  teamId: null,
  devHourlyRate: 150,
  surfaceTiers: {},
  tierModels: {},
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
      setToolProfile: (toolProfile) => set({ toolProfile }),
      setHeartbeatEnabled: (heartbeatEnabled) => set({ heartbeatEnabled }),
      setHeartbeatIntervalMinutes: (heartbeatIntervalMinutes) => set({ heartbeatIntervalMinutes }),
      setHeartbeatMode: (mode, config) =>
        set((state) => ({
          heartbeatModes: {
            ...state.heartbeatModes,
            [mode]: { ...state.heartbeatModes[mode], ...config },
          },
        })),
      setLoopDetectionThreshold: (loopDetectionThreshold) => set({ loopDetectionThreshold }),
      setSessionResetMode: (sessionResetMode) => set({ sessionResetMode }),
      setSessionResetTime: (sessionResetTime) => set({ sessionResetTime }),
      setSessionIdleMinutes: (sessionIdleMinutes) => set({ sessionIdleMinutes }),
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

      setAnthropicApiKey: (anthropicApiKey) => set({ anthropicApiKey }),

      setAutoExtractMemories: (autoExtractMemories) => set({ autoExtractMemories }),

      setBlockDangerousCommands: (blockDangerousCommands) => set({ blockDangerousCommands }),
      setBlockNetworkCommands: (blockNetworkCommands) => set({ blockNetworkCommands }),
      setRestrictToProjectFolder: (restrictToProjectFolder) => set({ restrictToProjectFolder }),
      setDisableBashTool: (disableBashTool) => set({ disableBashTool }),

      setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
      setOnboardingSkippedAt: (onboardingSkippedAt) => set({ onboardingSkippedAt }),
      setTeamId: (teamId) => set({ teamId }),
      setDevHourlyRate: (devHourlyRate) => set({ devHourlyRate }),

      setSurfaceTier: (surfaceId, tier) =>
        set((state) => {
          const next = { ...state.surfaceTiers };
          if (tier === null) delete next[surfaceId];
          else next[surfaceId] = tier;
          return { surfaceTiers: next };
        }),

      setTierModel: (tier, modelId) =>
        set((state) => {
          const next = { ...state.tierModels };
          if (modelId === null) delete next[tier];
          else next[tier] = modelId;
          return { tierModels: next };
        }),

      resetAll: () => set(initialState),
    }),
    {
      name: 'aime:settings',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
      version: 9,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        // v7 rename (applies to every pre-v7 payload regardless of source
        // version): nibGatewayApiKey → anthropicApiKey. Done up front so the
        // per-version branches below stay additive-only.
        if (version < 7 && state.nibGatewayApiKey !== undefined && state.anthropicApiKey === undefined) {
          state.anthropicApiKey = state.nibGatewayApiKey;
          delete state.nibGatewayApiKey;
        }
        // v8: per-surface tier overrides. Backfilled up front (not as a
        // per-version branch) because the branches below return early, so only
        // an up-front write is guaranteed to apply to every source version.
        if (version < 8 && state.surfaceTiers === undefined) {
          state.surfaceTiers = {};
        }
        // v9: which model fills each tier. Same up-front rationale as v8.
        if (version < 9 && state.tierModels === undefined) {
          state.tierModels = {};
        }
        if (version === 0) {
          return { ...initialState, ...state } as unknown as SettingsState & SettingsActions;
        }
        if (version === 1) {
          return {
            ...state,
            blockDangerousCommands: true,
            blockNetworkCommands: false,
            restrictToProjectFolder: true,
            disableBashTool: false,
          } as unknown as SettingsState & SettingsActions;
        }
        if (version === 2) {
          return {
            ...state,
            onboardingComplete: false,
            onboardingSkippedAt: null,
            teamId: null,
          } as unknown as SettingsState & SettingsActions;
        }
        if (version === 3) {
          // v3 -> v4: add tool profile, automation, session reset settings
          return {
            ...state,
            toolProfile: 'full',
            heartbeatEnabled: false,
            heartbeatIntervalMinutes: 30,
            loopDetectionThreshold: 3,
            sessionResetMode: 'manual',
            sessionResetTime: '04:00',
            sessionIdleMinutes: 60,
          } as unknown as SettingsState & SettingsActions;
        }
        if (version === 4) {
          // v4 -> v5: replace interval-based heartbeat with mode-based
          return {
            ...state,
            heartbeatModes: DEFAULT_HEARTBEAT_MODES,
          } as unknown as SettingsState & SettingsActions;
        }
        if (version === 5) {
          // v5 -> v6: add devHourlyRate for ROI tracking
          return {
            ...state,
            devHourlyRate: 150,
          } as unknown as SettingsState & SettingsActions;
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
        toolProfile: state.toolProfile,
        heartbeatEnabled: state.heartbeatEnabled,
        heartbeatIntervalMinutes: state.heartbeatIntervalMinutes,
        heartbeatModes: state.heartbeatModes,
        loopDetectionThreshold: state.loopDetectionThreshold,
        sessionResetMode: state.sessionResetMode,
        sessionResetTime: state.sessionResetTime,
        sessionIdleMinutes: state.sessionIdleMinutes,
        coworkInstructions: state.coworkInstructions,
        codeWorktreeLocation: state.codeWorktreeLocation,
        codeBranchPrefix: state.codeBranchPrefix,
        recentFolders: state.recentFolders,
        trustedFolders: state.trustedFolders,
        githubToken: state.githubToken,
        githubUser: state.githubUser,
        anthropicApiKey: state.anthropicApiKey,
        autoExtractMemories: state.autoExtractMemories,
        blockDangerousCommands: state.blockDangerousCommands,
        blockNetworkCommands: state.blockNetworkCommands,
        restrictToProjectFolder: state.restrictToProjectFolder,
        disableBashTool: state.disableBashTool,
        onboardingComplete: state.onboardingComplete,
        onboardingSkippedAt: state.onboardingSkippedAt,
        teamId: state.teamId,
        devHourlyRate: state.devHourlyRate,
        surfaceTiers: state.surfaceTiers,
        tierModels: state.tierModels,
      }),
    }
  )
);
