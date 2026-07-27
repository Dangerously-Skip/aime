'use client';

import { useCallback } from 'react';
import { useRunRecorder } from './use-run-recorder';
import { useCloseRunOnAbort } from './use-close-run-on-abort';

/**
 * The bookkeeping every streaming surface needs around a turn.
 *
 * Four surfaces — Chat, Cowork, Code and the project page — each hand-rolled the
 * same three pieces: a Run recorder, an abort listener to close a Run that neither
 * `onDone` nor `onError` will ever reach, and the two callbacks that persist a
 * card's answer onto the message it belongs to. Identical code, four times, and
 * that is exactly how the original defect shipped in some surfaces and not others:
 * `connectorRequestSettled` was written by Chat and forgotten by Cowork, so the
 * same connect card kept its buttons live after being answered in one surface and
 * not the other. Nothing about the wiring was surface-specific; only the store it
 * writes to and the question of which chatIds belong to this surface.
 *
 * Standing a 2000-line surface up in jsdom to test one `useCallback` is the
 * alternative, and it tests the mount, not the wiring. This is the seam worth
 * having: one test covers all four.
 */

/** The patch a settled card leaves on its message. */
type MessagePatch = { questionAnswered?: boolean; connectorRequestSettled?: boolean };

export interface TurnWiringOptions {
  /** Which surface Runs are recorded against ('chat', 'cowork', 'code'). */
  surfaceId: string;
  /** The conversation on screen. A card answered with no conversation is dropped. */
  chatId: string;
  /**
   * Does an aborted chatId belong to this surface?
   *
   * Aborts are broadcast to every listener, so without this a Stop in Cowork would
   * close Chat's live Run. Must be stable across renders — wrap it in useCallback.
   */
  ownsChat: (chatId: string) => boolean;
  /**
   * The surface store's `updateMessage`. Omit on a surface that renders no cards
   * (the project page): the returned callbacks then do nothing, rather than each
   * caller having to remember to leave the props off.
   */
  updateMessage?: (chatId: string, messageId: string, patch: MessagePatch) => void;
}

export interface TurnWiring {
  /** Pass `onUsage`, and call `begin`/`succeed`/`fail` from the stream callbacks. */
  runRecorder: ReturnType<typeof useRunRecorder>;
  /** For MessageList's `onQuestionAnswered`. */
  onQuestionAnswered: (toolUseId: string) => void;
  /** For MessageList's `onConnectorSettled`. */
  onConnectorSettled: (toolUseId: string) => void;
}

export function useTurnWiring({
  surfaceId,
  chatId,
  ownsChat,
  updateMessage,
}: TurnWiringOptions): TurnWiring {
  // Records a Run per turn so every execution leaves a durable trace with its
  // cost attached (P6 substrate — see lib/runs).
  const runRecorder = useRunRecorder(surfaceId);
  // A Stop, a conversation switch or an inactivity timeout aborts the fetch, so
  // neither onDone nor onError runs — without this the Run stays 'running'.
  useCloseRunOnAbort(runRecorder.finish, ownsChat);

  // Both of these persist the answer on the MESSAGE. The answered state used to
  // live in the card's own useState while the message itself is persisted, so
  // leaving the conversation and coming back re-armed a card that had already been
  // dealt with — and clicking it re-ran the whole OAuth flow to report to a
  // toolUseId with no waiter left.
  const onQuestionAnswered = useCallback(
    (toolUseId: string) => {
      if (chatId) updateMessage?.(chatId, toolUseId, { questionAnswered: true });
    },
    [chatId, updateMessage],
  );

  const onConnectorSettled = useCallback(
    (toolUseId: string) => {
      if (chatId) updateMessage?.(chatId, toolUseId, { connectorRequestSettled: true });
    },
    [chatId, updateMessage],
  );

  return { runRecorder, onQuestionAnswered, onConnectorSettled };
}
