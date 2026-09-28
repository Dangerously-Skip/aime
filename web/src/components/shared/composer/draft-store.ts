'use client';

import { create } from 'zustand';
import type { AttachmentFile } from '@/components/shared/attachment-menu';

/**
 * What a composer holds before it is sent, per conversation.
 *
 * The text used to be one `useState` per surface, so it followed you: half a
 * question typed in chat A appeared in chat B when you switched, and was lost
 * when the empty-state composer handed over to the docked one. Keyed by
 * conversation, a draft stays where it was written.
 *
 * In memory only. Attachments carry base64 bodies that have no business in the
 * same 5MB localStorage budget as the transcripts, and a draft is worth keeping
 * across a switch, not across a restart.
 */
export interface ComposerDraft {
  text: string;
  attachments: AttachmentFile[];
}

interface DraftState {
  drafts: Record<string, ComposerDraft>;
  /** The last prompt sent from each surface — what Up-arrow recalls in a new chat. */
  lastSent: Record<string, string>;
  setText: (key: string, text: string) => void;
  /** Append with a separating space — dictation adds to what was typed. */
  appendText: (key: string, text: string) => void;
  addAttachment: (key: string, file: AttachmentFile) => void;
  removeAttachment: (key: string, index: number) => void;
  clearDraft: (key: string) => void;
  recordSent: (surface: string, text: string) => void;
}

export const EMPTY_DRAFT: ComposerDraft = Object.freeze({ text: '', attachments: [] }) as ComposerDraft;

/** One conversation's draft slot. A conversation not created yet is `new`. */
export function draftKey(surface: string, conversationId: string | null | undefined): string {
  return `${surface}:${conversationId || 'new'}`;
}

function patch(
  drafts: Record<string, ComposerDraft>,
  key: string,
  update: (d: ComposerDraft) => ComposerDraft,
): Record<string, ComposerDraft> {
  return { ...drafts, [key]: update(drafts[key] ?? EMPTY_DRAFT) };
}

export const useComposerDrafts = create<DraftState>((set) => ({
  drafts: {},
  lastSent: {},
  setText: (key, text) =>
    set((s) => ({ drafts: patch(s.drafts, key, (d) => ({ ...d, text })) })),
  appendText: (key, text) =>
    set((s) => ({
      drafts: patch(s.drafts, key, (d) => ({ ...d, text: d.text ? `${d.text} ${text}` : text })),
    })),
  addAttachment: (key, file) =>
    set((s) => ({
      drafts: patch(s.drafts, key, (d) => ({ ...d, attachments: [...d.attachments, file] })),
    })),
  removeAttachment: (key, index) =>
    set((s) => ({
      drafts: patch(s.drafts, key, (d) => ({
        ...d,
        attachments: d.attachments.filter((_, i) => i !== index),
      })),
    })),
  clearDraft: (key) =>
    set((s) => {
      if (!(key in s.drafts)) return s;
      const { [key]: _gone, ...rest } = s.drafts;
      return { drafts: rest };
    }),
  recordSent: (surface, text) => set((s) => ({ lastSent: { ...s.lastSent, [surface]: text } })),
}));

/**
 * For a surface's drop zone, suggestion chips and quick-start pills — anything
 * outside the composer that puts content into it. Goes through the store rather
 * than a ref so it works whichever of the surface's composers is mounted.
 */
export function addComposerAttachment(surface: string, conversationId: string, file: AttachmentFile): void {
  useComposerDrafts.getState().addAttachment(draftKey(surface, conversationId), file);
}

export function setComposerText(surface: string, conversationId: string, text: string): void {
  useComposerDrafts.getState().setText(draftKey(surface, conversationId), text);
}
