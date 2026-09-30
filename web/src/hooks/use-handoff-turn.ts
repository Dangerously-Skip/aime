'use client';

import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { AttachmentFile } from '@/components/shared/attachment-menu';

/**
 * A first message written somewhere that is not the surface it belongs to.
 *
 * The project page has a composer, and it used to run the turn itself: its own
 * `useSSEStream`, its own run recorder, its own copy of the request — the sixth
 * copy of the send path. It sent a subset of what Chat sends (no memories, no
 * deck theme, no search or security settings), wrote failures into the reply as
 * text, and could not be retried, because the component that owned the stream
 * unmounted the moment it navigated to the chat it had created.
 *
 * So it no longer runs anything. It creates the conversation, leaves the
 * message here and opens the chat; the Chat surface picks the message up as
 * soon as that conversation is on screen and submits it through its own turn —
 * the one every typed message takes.
 *
 * In memory only: a handoff is consumed within a render or two, and one that
 * survived a restart would send a message nobody just asked for.
 */

export interface HandoffTurn {
  text: string;
  attachments: AttachmentFile[];
}

interface HandoffState {
  turns: Record<string, HandoffTurn>;
  put: (key: string, turn: HandoffTurn) => void;
  /** Remove and return — consumed BEFORE it is submitted, so it cannot run twice. */
  take: (key: string) => HandoffTurn | undefined;
}

const handoffKey = (surface: string, conversationId: string) => `${surface}:${conversationId}`;

export const useHandoffStore = create<HandoffState>((set, get) => ({
  turns: {},
  put: (key, turn) => set((s) => ({ turns: { ...s.turns, [key]: turn } })),
  take: (key) => {
    const turn = get().turns[key];
    if (!turn) return undefined;
    set((s) => {
      const { [key]: _taken, ...rest } = s.turns;
      return { turns: rest };
    });
    return turn;
  },
}));

/** Leave a first message for `surface` to send once `conversationId` is on screen. */
export function handOffTurn(surface: string, conversationId: string, turn: HandoffTurn): void {
  useHandoffStore.getState().put(handoffKey(surface, conversationId), turn);
}

/**
 * Send a handed-off message when its conversation is the one on screen.
 *
 * Waits for `chatId` to BE that conversation rather than sending into it from
 * outside: the submit a render hands us is bound to the conversation that render
 * showed, and the project context, memories and folder all come from there.
 */
export function useHandoffTurn(
  surface: string,
  chatId: string,
  submit: (text: string, attachments: AttachmentFile[]) => unknown,
): void {
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  const pending = useHandoffStore((s) => (chatId ? s.turns[handoffKey(surface, chatId)] : undefined));
  useEffect(() => {
    if (!pending || !chatId) return;
    const turn = useHandoffStore.getState().take(handoffKey(surface, chatId));
    if (turn) void submitRef.current(turn.text, turn.attachments);
  }, [pending, surface, chatId]);
}
