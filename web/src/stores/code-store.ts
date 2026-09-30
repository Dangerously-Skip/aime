'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { surfaceTranscriptStorage } from '@/lib/transcripts/transcript-storage';
import { onStreamAborted } from '@/lib/stream-registry';
import type { ModelOption } from '@/lib/models/client-options';
import { cleanStaleStreamingFlags, dedupeMessageIds, dedupeLegacyTranscriptRows } from '@/stores/chat-store';
import { type SessionControls, DEFAULT_SESSION_CONTROLS } from '@/lib/slash-commands';
import { createTranscriptSlice, type TranscriptSlice } from '@/stores/slices/transcript-slice';

export type PermissionMode = 'acceptEdits' | 'default' | 'plan' | 'bypass';
export type SessionStatus = 'idle' | 'active' | 'streaming';
export type ConnectionType = 'local' | 'github';

/** Code's own state; the transcript half comes from `createTranscriptSlice`. */
interface CodeState {
  /**
   * Selected route — a tier or a pinned model (in-memory); null ⇒ use the
   * built-in `model` enum.
   */
  modelRoute: ModelOption | null;
  folderByChat: Record<string, string | null>;
  permissionMode: PermissionMode;
  sessionStatus: SessionStatus;
  connectionType: ConnectionType;
  planContent: Record<string, string>;
  planOpen: boolean;
  sessionControls: Record<string, SessionControls>;
}

interface CodeActions {
  setModelRoute: (opt: ModelOption | null) => void;
  setFolder: (chatId: string, folder: string | null) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setSessionStatus: (status: SessionStatus) => void;
  setConnectionType: (type: ConnectionType) => void;
  setPlanContent: (chatId: string, content: string) => void;
  setPlanOpen: (open: boolean) => void;
  setSessionControls: (chatId: string, controls: SessionControls) => void;
}

export { DEFAULT_SESSION_CONTROLS };

export type CodeStore = TranscriptSlice & CodeState & CodeActions;

export const useCodeStore = create<CodeStore>()(
  persist(
    (set) => ({
      ...createTranscriptSlice(set),
      modelRoute: null,
      folderByChat: {},
      permissionMode: 'default',
      sessionStatus: 'idle',
      connectionType: 'local',
      planContent: {},
      planOpen: false,
      sessionControls: {},

      setModelRoute: (opt) => set({ modelRoute: opt }),

      setFolder: (chatId, folder) => set((state) => ({
        folderByChat: { ...state.folderByChat, [chatId]: folder },
      })),
      setPermissionMode: (mode) => set({ permissionMode: mode }),
      setSessionStatus: (status) => set({ sessionStatus: status }),
      setConnectionType: (connectionType) => set({ connectionType }),

      setPlanContent: (chatId, content) =>
        set((state) => ({
          planContent: { ...state.planContent, [chatId]: content },
        })),

      setPlanOpen: (open) => set({ planOpen: open }),

      setSessionControls: (chatId, controls) =>
        set((state) => ({
          sessionControls: { ...state.sessionControls, [chatId]: controls },
        })),
    }),
    {
      name: 'aime:code',
      // Transcripts to IndexedDB per conversation, the rest to localStorage;
      // see lib/transcripts/transcript-storage.
      storage: surfaceTranscriptStorage('code', (): Record<string, true> => useCodeStore.getState().streamingChats),
      partialize: (state) => ({
        messages: state.messages,
        currentChatId: state.currentChatId,
        folderByChat: state.folderByChat,
        permissionMode: state.permissionMode,
        connectionType: state.connectionType,
        planContent: state.planContent,
      }),
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (state) state.messages = dedupeLegacyTranscriptRows(dedupeMessageIds(cleanStaleStreamingFlags(state.messages)));
      },
    }
  )
);

/**
 * Finalise a turn whose stream was aborted — see the matching subscription in
 * chat-store.
 */
onStreamAborted(({ chatId }) => {
  const state = useCodeStore.getState();
  if (!state.messages[chatId]?.length) return;
  state.completeRunningTools(chatId);
  state.stopStreaming(chatId);
});
