'use client';

import { create } from 'zustand';

/**
 * Transient Customize state shared between the sidebar and the main pane.
 *
 * The sidebar's `+` and the empty state's "Create skill" button are two ways
 * into the same composer, and they live in different component trees. The
 * composer flag was local state inside `SkillDetail`, which is why the sidebar
 * button shipped with no onClick: there was nothing it could reach.
 *
 * `skillsRevision` exists for the opposite direction. The sidebar list fetched
 * only when the section changed, so a skill created, edited or deleted in the
 * main pane did not appear (or disappear) until you navigated away and back.
 *
 * Deliberately not persisted — a half-open composer is not something to
 * restore on the next launch.
 */
interface CustomizeUiState {
  composingSkill: boolean;
  skillsRevision: number;
  startSkillComposer: () => void;
  closeSkillComposer: () => void;
  /** Tell every skills list that the set on disk changed. */
  skillsChanged: () => void;
}

export const useCustomizeUiStore = create<CustomizeUiState>()((set) => ({
  composingSkill: false,
  skillsRevision: 0,
  startSkillComposer: () => set({ composingSkill: true }),
  closeSkillComposer: () => set({ composingSkill: false }),
  skillsChanged: () => set((s) => ({ skillsRevision: s.skillsRevision + 1 })),
}));
