'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getGatedStorage } from '@/lib/gated-storage';
import { createThrottledJSONStorage } from '@/lib/throttled-storage';
import { onStreamAborted } from '@/lib/stream-registry';
import {
  findUnregisteredArtifacts,
  markTurnStart,
  turnStartedAt,
} from '@/lib/artifact-reconcile';
import {
  cleanStaleStreamingFlags,
  dedupeMessageIds,
  dedupeLegacyTranscriptRows,
} from '@/stores/chat-store';
import { createTranscriptSlice, type TranscriptSlice } from '@/stores/slices/transcript-slice';
import { type SessionControls } from '@/lib/slash-commands';
import type { A2UIDocument } from '@/lib/a2ui/types';
import type { ModelOption } from '@/lib/models/client-options';

export interface CanvasArtifact {
  id: string;
  title: string;
  doc: A2UIDocument;
  /** Optional templateId so the sidebar can show a more specific icon. */
  templateId?: string;
  createdAt: number;
}


/** Cowork's own state; the transcript half comes from `createTranscriptSlice`. */
interface CoworkState {
  /**
   * Selected route — a tier or a pinned model (in-memory); null ⇒ use the
   * built-in `model` enum.
   */
  modelRoute: ModelOption | null;
  folderByChat: Record<string, string | null>;
  contextFiles: Record<string, string[]>;
  artifactFiles: Record<string, string[]>;
  canvasArtifacts: Record<string, CanvasArtifact[]>;
  planContent: Record<string, string>;
  planOpen: boolean;
  sessionControls: Record<string, SessionControls>;
  lastActivityAt: Record<string, number>;
  searchGroups: Record<string, { query: string; results: { title: string; url: string; snippet: string }[] }[]>;
}

interface CoworkActions {
  setModelRoute: (opt: ModelOption | null) => void;
  setFolder: (chatId: string, folder: string | null) => void;
  addContextFile: (chatId: string, path: string) => void;
  addArtifactFile: (chatId: string, path: string) => void;
  removeContextFile: (chatId: string, path: string) => void;
  removeArtifactFile: (chatId: string, path: string) => void;
  addCanvasArtifact: (chatId: string, artifact: CanvasArtifact) => void;
  removeCanvasArtifact: (chatId: string, artifactId: string) => void;
  clearSidebarFiles: (chatId: string) => void;
  setPlanContent: (chatId: string, content: string) => void;
  setPlanOpen: (open: boolean) => void;
  setSessionControls: (chatId: string, controls: SessionControls) => void;
  touchActivity: (chatId: string) => void;
  addSearchGroup: (chatId: string, group: { query: string; results: { title: string; url: string; snippet: string }[] }) => void;
  clearSearchGroups: (chatId: string) => void;
}

export type CoworkStore = TranscriptSlice & CoworkState & CoworkActions;

export const useCoworkStore = create<CoworkStore>()(
  persist(
    (set) => ({
      ...createTranscriptSlice(set, {
        // Stamped here so an aborted turn can tell its own files from every
        // previous turn's when it reconciles the scratch directory.
        onStart: markTurnStart,
        /*
         * No selectOnStart. It used to switch the screen to whichever chat
         * started a turn — so an auto-continue firing in chat A yanked a user
         * who had moved on to B back to A. The composer selects a new
         * conversation itself before it sends.
         */
      }),
      modelRoute: null,
      folderByChat: {},
      contextFiles: {},
      artifactFiles: {},
      canvasArtifacts: {},
      planContent: {},
      planOpen: false,
      sessionControls: {},
      lastActivityAt: {},
      searchGroups: {},

      setModelRoute: (opt) => set({ modelRoute: opt }),

      setFolder: (chatId, folder) => set((state) => ({
        folderByChat: { ...state.folderByChat, [chatId]: folder },
      })),

      addContextFile: (chatId, path) =>
        set((state) => {
          const existing = state.contextFiles[chatId] ?? [];
          if (existing.includes(path)) return state;
          return { contextFiles: { ...state.contextFiles, [chatId]: [...existing, path] } };
        }),

      addArtifactFile: (chatId, path) =>
        set((state) => {
          const existing = state.artifactFiles[chatId] ?? [];
          if (existing.includes(path)) return state;
          return { artifactFiles: { ...state.artifactFiles, [chatId]: [...existing, path] } };
        }),

      removeContextFile: (chatId, path) =>
        set((state) => {
          const existing = state.contextFiles[chatId] ?? [];
          return { contextFiles: { ...state.contextFiles, [chatId]: existing.filter((p) => p !== path) } };
        }),

      removeArtifactFile: (chatId, path) =>
        set((state) => {
          const existing = state.artifactFiles[chatId] ?? [];
          return { artifactFiles: { ...state.artifactFiles, [chatId]: existing.filter((p) => p !== path) } };
        }),

      addCanvasArtifact: (chatId, artifact) =>
        set((state) => {
          const existing = state.canvasArtifacts[chatId] ?? [];
          return { canvasArtifacts: { ...state.canvasArtifacts, [chatId]: [...existing, artifact] } };
        }),

      removeCanvasArtifact: (chatId, artifactId) =>
        set((state) => {
          const existing = state.canvasArtifacts[chatId] ?? [];
          return { canvasArtifacts: { ...state.canvasArtifacts, [chatId]: existing.filter((c) => c.id !== artifactId) } };
        }),

      clearSidebarFiles: (chatId) =>
        set((state) => {
          const { [chatId]: _ctx, ...restCtx } = state.contextFiles;
          const { [chatId]: _art, ...restArt } = state.artifactFiles;
          const { [chatId]: _canvas, ...restCanvas } = state.canvasArtifacts;
          return { contextFiles: restCtx, artifactFiles: restArt, canvasArtifacts: restCanvas };
        }),

      setPlanContent: (chatId, content) =>
        set((state) => ({
          planContent: { ...state.planContent, [chatId]: content },
        })),

      setPlanOpen: (open) => set({ planOpen: open }),

      setSessionControls: (chatId, controls) =>
        set((state) => ({
          sessionControls: { ...state.sessionControls, [chatId]: controls },
        })),

      touchActivity: (chatId) =>
        set((state) => ({
          lastActivityAt: { ...state.lastActivityAt, [chatId]: Date.now() },
        })),

      addSearchGroup: (chatId, group) =>
        set((state) => ({
          searchGroups: {
            ...state.searchGroups,
            [chatId]: [...(state.searchGroups[chatId] ?? []), group],
          },
        })),
      clearSearchGroups: (chatId) =>
        set((state) => ({
          searchGroups: { ...state.searchGroups, [chatId]: [] },
        })),
    }),
    {
      name: 'aime:cowork',
      // Not per token: see lib/throttled-storage. Busy = any chat mid-turn.
      storage: createThrottledJSONStorage(() => getGatedStorage(), {
        isBusy: (): boolean => Object.keys(useCoworkStore.getState().streamingChats).length > 0,
      }),
      partialize: (state) => ({
        messages: state.messages,
        currentChatId: state.currentChatId,
        folderByChat: state.folderByChat,
        contextFiles: state.contextFiles,
        artifactFiles: state.artifactFiles,
        canvasArtifacts: state.canvasArtifacts,
        planContent: state.planContent,
        sessionControls: state.sessionControls,
        searchGroups: state.searchGroups,
      }),
      skipHydration: true,
      /*
       * v1: `verboseMode` now expands tool calls. Every persisted `true` is the
       * old default, which meant nothing — carrying it over would open every
       * tool card in those conversations. See DEFAULT_SESSION_CONTROLS.
       */
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as { sessionControls?: Record<string, SessionControls> };
        if (version < 1 && state?.sessionControls) {
          for (const ctrl of Object.values(state.sessionControls)) {
            if (ctrl) ctrl.verboseMode = false;
          }
        }
        return state as never;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.messages = dedupeLegacyTranscriptRows(dedupeMessageIds(cleanStaleStreamingFlags(state.messages)));
          // Migrate persisted sessionControls to include effortLevel (added in v1.2.0)
          if (state.sessionControls) {
            for (const chatId of Object.keys(state.sessionControls)) {
              const ctrl = state.sessionControls[chatId];
              if (ctrl && !('effortLevel' in ctrl)) {
                (ctrl as Record<string, unknown>).effortLevel = null;
              }
            }
          }
        }
      },
    }
  )
);

/**
 * Finalise a turn whose stream was aborted — see the matching subscription in
 * chat-store. Cowork reaches it from the Stop button, the conversation-switch
 * abort, and its own 120s stuck-tool cancel; none of those run onDone/onError,
 * so nothing else clears the per-message streaming flags.
 */
onStreamAborted(({ chatId }) => {
  const state = useCoworkStore.getState();
  if (!state.messages[chatId]?.length) return;
  state.completeRunningTools(chatId);
  state.stopStreaming(chatId);

  // An aborted turn stops delivering tool_use events but does not un-write the
  // files it already produced, so ask the disk what is actually there. Without
  // this, a finished 18-slide deck sat in scratch while the UI showed a timeout
  // and an instruction to try again.
  const since = turnStartedAt(chatId);
  if (since === undefined) return;
  const current = useCoworkStore.getState();
  const known = [
    ...(current.artifactFiles[chatId] ?? []),
    ...(current.contextFiles[chatId] ?? []),
  ];
  void findUnregisteredArtifacts(chatId, known, since).then((paths) => {
    for (const p of paths) useCoworkStore.getState().addArtifactFile(chatId, p);
  });
});
