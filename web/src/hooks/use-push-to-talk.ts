"use client";

import { useCallback, useEffect, useRef } from "react";
import { useVoiceInput } from "./use-voice-input";

/**
 * Dictate from anywhere via a global hotkey (P4.1).
 *
 * Local Whisper transcription already existed but was reachable only by clicking
 * the mic button, which means it was only usable when AIME was already focused —
 * the opposite of what dictation is for. Electron main owns the shortcut and
 * emits `voice:toggle`; this hook turns that into start/stop and routes the
 * transcript.
 *
 * Toggle rather than hold-to-talk: a global keydown/keyup pair is unreliable
 * across platforms (macOS in particular does not deliver keyup for a registered
 * global shortcut), so press-to-start / press-to-stop is the behaviour that
 * actually works everywhere rather than the one that reads better in a changelog.
 */

interface UsePushToTalkOptions {
  /** Called with each completed transcript. */
  onTranscript: (text: string) => void;
  /** Off by default so a hotkey is never registered behind the user's back. */
  enabled?: boolean;
}

export interface UsePushToTalkReturn {
  /** Capturing audio right now. */
  isListening: boolean;
  /** Audio captured, Whisper still working. */
  isTranscribing: boolean;
  /** Whether a global hotkey is available at all (Electron only). */
  isAvailable: boolean;
  /** Toggle manually — the same path the hotkey takes. */
  toggle: () => void;
}

export function usePushToTalk({
  onTranscript,
  enabled = false,
}: UsePushToTalkOptions): UsePushToTalkReturn {
  const { isListening, isTranscribing, isSupported, startListening, stopListening } = useVoiceInput({
    onTranscript,
  });

  // Derived, not state: the preload bridge is injected before the renderer runs
  // and never appears or disappears afterwards, so storing this in state only
  // bought a cascading render — which the lint gate caught.
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const canRegister = !!api?.onVoiceToggle && !!api?.setPushToTalkEnabled;

  // Read through refs inside the IPC listener: re-subscribing on every state
  // change would drop hotkey presses during the resubscribe window.
  //
  // Synced in an effect rather than assigned during render — a render-phase ref
  // write is unsafe under concurrent rendering, and the lint gate rightly
  // rejects it.
  const listeningRef = useRef(isListening);
  const transcribingRef = useRef(isTranscribing);
  useEffect(() => {
    listeningRef.current = isListening;
    transcribingRef.current = isTranscribing;
  }, [isListening, isTranscribing]);

  const toggle = useCallback(() => {
    if (!isSupported) return;
    // Ignore a press while Whisper is still working on the previous take —
    // starting a new recording would discard a transcript the user is waiting for.
    if (transcribingRef.current) return;
    if (listeningRef.current) stopListening();
    else startListening();
  }, [isSupported, startListening, stopListening]);

  const toggleRef = useRef(toggle);
  useEffect(() => {
    toggleRef.current = toggle;
  }, [toggle]);

  useEffect(() => {
    if (!canRegister) return;

    // Tell main whether to hold the shortcut, so a disabled setting genuinely
    // releases it rather than merely ignoring the event here — otherwise the
    // combination stays stolen from every other application.
    void api!.setPushToTalkEnabled!(enabled);
    if (!enabled) return;

    const unsubscribe = api!.onVoiceToggle!(() => toggleRef.current());
    return () => {
      unsubscribe?.();
      void api!.setPushToTalkEnabled!(false);
    };
  }, [enabled, canRegister, api]);

  return { isListening, isTranscribing, isAvailable: canRegister && isSupported, toggle };
}
