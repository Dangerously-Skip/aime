'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import { DEFAULT_PUSH_TO_TALK, validateAccelerator } from '@/lib/voice/accelerator';
import type { Tier } from '@/lib/models/types';
import type { SearchProviderId } from '@/lib/search/providers';

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
  /** Push-to-talk global hotkey (P4.1). Off by default — never claim a system-wide key uninvited. */
  pushToTalkEnabled: boolean;
  /** Electron accelerator held while push-to-talk is on. */
  pushToTalkAccelerator: string;

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

  /**
   * Web search. Opt-in and null by default: search is a second account or a
   * per-query cost, so it is never turned on for someone who did not ask.
   * `resolveSearchRoute` is the only thing that reads these.
   */
  searchProvider: SearchProviderId | null;
  searchApiKey: string | null;
  searchInstanceUrl: string | null;

  // Memory
  autoExtractMemories: boolean;

  // Onboarding
  onboardingComplete: boolean;
  onboardingSkippedAt: number | null;

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
  setPushToTalkEnabled: (enabled: boolean) => void;
  setPushToTalkAccelerator: (raw: string) => import('@/lib/voice/accelerator').AcceleratorVerdict;
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
  setSearchProvider: (id: SearchProviderId | null) => void;
  setSearchApiKey: (key: string | null) => void;
  setSearchInstanceUrl: (url: string | null) => void;
  setAutoExtractMemories: (enabled: boolean) => void;
  setBlockDangerousCommands: (enabled: boolean) => void;
  setBlockNetworkCommands: (enabled: boolean) => void;
  setRestrictToProjectFolder: (enabled: boolean) => void;
  setDisableBashTool: (enabled: boolean) => void;
  setOnboardingComplete: (complete: boolean) => void;
  setOnboardingSkippedAt: (timestamp: number | null) => void;
  resetAll: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;

export const INITIAL_SETTINGS: SettingsState = {
  fullName: '',
  displayName: '',
  workFunction: '',
  personalPreferences: '',
  chatFont: 'default',
  toolAccessMode: 'onDemand',
  toolProfile: 'full',
  pushToTalkEnabled: false,
  pushToTalkAccelerator: DEFAULT_PUSH_TO_TALK,
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
  searchProvider: null,
  searchApiKey: null,
  searchInstanceUrl: null,
  autoExtractMemories: true,
  blockDangerousCommands: true,
  blockNetworkCommands: false,
  restrictToProjectFolder: true,
  disableBashTool: false,
  onboardingComplete: false,
  onboardingSkippedAt: null,
  devHourlyRate: 150,
  surfaceTiers: {},
  tierModels: {},
};

/**
 * Exactly which fields reach storage.
 *
 * This is a list rather than an inline object literal because `partialize` was
 * where push-to-talk quietly died: the fields existed in state, had a version
 * bump and a migration written for them, and were never written to disk — so
 * every reload silently reset them. A migration for a field that is never
 * persisted is a no-op dressed as a feature.
 *
 * With the list exported, `settings-store.test.tsx` can assert that every field
 * in `INITIAL_SETTINGS` appears either here or in `EPHEMERAL_SETTINGS_KEYS`, so
 * adding a field without deciding whether it persists fails a test instead of
 * shipping.
 */
export const PERSISTED_SETTINGS_KEYS = [
  'fullName',
  'displayName',
  'workFunction',
  'personalPreferences',
  'chatFont',
  'toolAccessMode',
  'toolProfile',
  'pushToTalkEnabled',
  'pushToTalkAccelerator',
  'heartbeatEnabled',
  'heartbeatIntervalMinutes',
  'heartbeatModes',
  'loopDetectionThreshold',
  'sessionResetMode',
  'sessionResetTime',
  'sessionIdleMinutes',
  'coworkInstructions',
  'codeWorktreeLocation',
  'codeBranchPrefix',
  'recentFolders',
  'trustedFolders',
  'githubToken',
  'githubUser',
  'anthropicApiKey',
  'searchProvider',
  'searchApiKey',
  'searchInstanceUrl',
  'autoExtractMemories',
  'blockDangerousCommands',
  'blockNetworkCommands',
  'restrictToProjectFolder',
  'disableBashTool',
  'onboardingComplete',
  'onboardingSkippedAt',
  'devHourlyRate',
  'surfaceTiers',
  'tierModels',
] as const satisfies readonly (keyof SettingsState)[];

/**
 * Fields that are deliberately NOT persisted. Empty today; anything added here
 * needs a reason in a comment, because "resets on every reload" has to be a
 * decision rather than an omission.
 */
export const EPHEMERAL_SETTINGS_KEYS = [] as const satisfies readonly (keyof SettingsState)[];

type PersistedSettingsKey = (typeof PERSISTED_SETTINGS_KEYS)[number];

function pickPersisted(state: SettingsStore): Pick<SettingsState, PersistedSettingsKey> {
  const out: Record<string, unknown> = {};
  for (const key of PERSISTED_SETTINGS_KEYS) out[key] = state[key];
  return out as Pick<SettingsState, PersistedSettingsKey>;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...INITIAL_SETTINGS,

      setFullName: (fullName) => set({ fullName }),
      setDisplayName: (displayName) => set({ displayName }),
      setWorkFunction: (workFunction) => set({ workFunction }),
      setPersonalPreferences: (personalPreferences) => set({ personalPreferences }),
      setChatFont: (chatFont) => set({ chatFont }),
      setToolAccessMode: (toolAccessMode) => set({ toolAccessMode }),
      setToolProfile: (toolProfile) => set({ toolProfile }),
      setPushToTalkEnabled: (pushToTalkEnabled) => set({ pushToTalkEnabled }),
      /** Stores the CANONICAL form, so the same combination never persists two ways. */
      setPushToTalkAccelerator: (raw) => {
        const verdict = validateAccelerator(raw);
        if (verdict.ok) set({ pushToTalkAccelerator: verdict.accelerator });
        return verdict;
      },
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
      setSearchProvider: (searchProvider) => set({ searchProvider }),
      setSearchApiKey: (searchApiKey) => set({ searchApiKey }),
      setSearchInstanceUrl: (searchInstanceUrl) => set({ searchInstanceUrl }),

      setAutoExtractMemories: (autoExtractMemories) => set({ autoExtractMemories }),

      setBlockDangerousCommands: (blockDangerousCommands) => set({ blockDangerousCommands }),
      setBlockNetworkCommands: (blockNetworkCommands) => set({ blockNetworkCommands }),
      setRestrictToProjectFolder: (restrictToProjectFolder) => set({ restrictToProjectFolder }),
      setDisableBashTool: (disableBashTool) => set({ disableBashTool }),

      setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
      setOnboardingSkippedAt: (onboardingSkippedAt) => set({ onboardingSkippedAt }),
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

      resetAll: () => set(INITIAL_SETTINGS),
    }),
    {
      name: 'aime:settings',
      storage: createJSONStorage(() => getGatedStorage()),
      skipHydration: true,
      version: 12,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        // v12: search became a configurable provider instead of one env var.
        // Backfilled up front, not in a per-version branch, because the
        // branches below return early — same rationale as v8/v9. null is the
        // correct default: any existing SEARXNG_INSTANCES install keeps working
        // through the legacy path in `resolveSearchRoute`.
        if (version < 12) {
          if (state.searchProvider === undefined) state.searchProvider = null;
          if (state.searchApiKey === undefined) state.searchApiKey = null;
          if (state.searchInstanceUrl === undefined) state.searchInstanceUrl = null;
        }
        // v11: the org "select your team" concept moved to a separate product.
        // DROP the key rather than leaving it: zustand's default merge splices
        // every persisted field into state, so an orphan `teamId` would sit in
        // the live store (invisible to `partialize`, and typed as absent)
        // until the next write happened to overwrite the payload.
        if (version < 11) {
          delete state.teamId;
        }
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
          return { ...INITIAL_SETTINGS, ...state } as unknown as SettingsState & SettingsActions;
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
      partialize: pickPersisted,
    }
  )
);
