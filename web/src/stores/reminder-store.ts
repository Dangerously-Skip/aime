'use client';

import { create } from 'zustand';

interface ReminderState {
  pending: { id: string; prompt: string } | null;
}

interface ReminderActions {
  showReminder: (id: string, prompt: string) => void;
  dismissReminder: () => void;
}

export const useReminderStore = create<ReminderState & ReminderActions>((set) => ({
  pending: null,
  showReminder: (id, prompt) => set({ pending: { id, prompt } }),
  dismissReminder: () => set({ pending: null }),
}));

/** Play a short ding using Web Audio API */
export function playDing() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
    osc.onended = () => ctx.close();
  } catch {
    // AudioContext not available — silently skip
  }
}
