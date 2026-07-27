"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_PUSH_TO_TALK } from "@/lib/voice/accelerator";
import {
  detectVoiceSupport,
  getServerVoiceSnapshot,
  getVoiceSnapshot,
  prewarmTranscriber,
  setHotkeyStatus,
  stopRecording,
  subscribeToVoiceSession,
  toggleRecording,
  type HotkeyStatus,
} from "@/lib/voice/voice-session";

/**
 * Owns the global dictation hotkey (P4.1).
 *
 * Local Whisper transcription already existed but was reachable only by clicking
 * the mic button, which means it was only usable when AIME was already focused —
 * the opposite of what dictation is for. Electron main owns the OS registration
 * and emits `voice:toggle`; this hook decides whether main should be holding a
 * combination, and turns a press into a start or a stop.
 *
 * MOUNT THIS ONCE, IN THE APP SHELL. Not in a surface. An OS-wide hotkey is a
 * single exclusive resource, and which surface is on screen has nothing to do
 * with who should hold it. When each surface called this hook and gated on
 * `activeSurface === '<own id>'`, every mounted surface still ran the effect:
 * the shipped version told main `enabled: false` BEFORE its own `if (!enabled)
 * return` guard, main released whatever was held without asking who wanted it
 * released, and so the inactive surfaces unregistered the active one's shortcut.
 * It worked on cowork purely because chat's `false` happened to land first.
 *
 * Three things now hold the invariant instead of a comment:
 *  1. a disabled instance sends main nothing at all;
 *  2. a module-level owner claim means a second enabled instance is refused
 *     rather than allowed to fight over the registration;
 *  3. main tracks the owner id, so a release from a non-owner is ignored.
 *
 * The transcript is not this hook's business — `lib/voice/voice-session` routes
 * it to the composer of the surface that is on screen.
 */

/**
 * The single owner, if any. Module scope on purpose: the invariant is "one per
 * app", which no amount of per-component state can express.
 */
let currentOwner: string | null = null;

/** Main's reply. Older builds resolved to the accelerator string, or null. */
type RegistrationResult =
  | { ok: boolean; accelerator: string | null; reason?: string; message?: string }
  | string
  | null;

interface UsePushToTalkOptions {
  /** Off by default so a hotkey is never registered behind the user's back. */
  enabled?: boolean;
  /** Electron accelerator to claim. Validated by `lib/voice/accelerator`. */
  accelerator?: string;
}

export interface UsePushToTalkReturn {
  /** Capturing audio right now. */
  isListening: boolean;
  /** Audio captured, Whisper still working. */
  isTranscribing: boolean;
  /** Whether a global hotkey is possible at all (Electron + a working mic). */
  isAvailable: boolean;
  /** What the OS actually did — not what the setting says. */
  hotkey: HotkeyStatus;
  /** Toggle manually — the same path the hotkey takes. */
  toggle: () => void;
}

/** Turn main's reply into something the UI can show a user. */
function interpretRegistration(result: RegistrationResult, accelerator: string): HotkeyStatus {
  if (typeof result === "string" && result !== "") {
    return { state: "held", accelerator: result };
  }
  if (result && typeof result === "object") {
    if (result.ok) {
      return { state: "held", accelerator: result.accelerator || accelerator };
    }
    const reason =
      result.reason === "taken" ||
      result.reason === "invalid" ||
      result.reason === "owned-elsewhere"
        ? result.reason
        : "unknown";
    return {
      state: "failed",
      accelerator,
      reason,
      message:
        result.message ||
        `${accelerator} could not be registered. Another application may already use it.`,
    };
  }
  // null: an older main that reported failure without saying why.
  return {
    state: "failed",
    accelerator,
    reason: "unknown",
    message: `${accelerator} could not be registered. Another application may already use it.`,
  };
}

export function usePushToTalk({
  enabled = false,
  accelerator = DEFAULT_PUSH_TO_TALK,
}: UsePushToTalkOptions = {}): UsePushToTalkReturn {
  const snapshot = useSyncExternalStore(
    subscribeToVoiceSession,
    getVoiceSnapshot,
    getServerVoiceSnapshot,
  );

  // Derived, not state: the preload bridge is injected before the renderer runs
  // and never appears or disappears afterwards.
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;
  const canRegister = !!api?.onVoiceToggle && !!api?.setPushToTalkEnabled;

  // Identifies this instance to main for the ownership check. Generated once, in
  // a state initialiser — a ref assigned during render is unsafe under
  // concurrent rendering.
  const [ownerId] = useState(
    () =>
      `push-to-talk:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
  );

  useEffect(() => {
    detectVoiceSupport();
    prewarmTranscriber();
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Deliberately silent. THE defect this replaces: `setPushToTalkEnabled(false)`
      // was sent from here, by every mounted instance, and released the owner's
      // shortcut. Nothing was registered by this instance, so there is nothing
      // to give back.
      if (currentOwner === null) setHotkeyStatus({ state: "off" });
      return;
    }
    if (!canRegister) {
      setHotkeyStatus({ state: "unavailable" });
      return;
    }
    if (currentOwner !== null && currentOwner !== ownerId) {
      console.warn(
        "[PushToTalk] Another instance already owns the global hotkey; this one is inert. " +
          "usePushToTalk belongs in the app shell, mounted once.",
      );
      return;
    }
    currentOwner = ownerId;

    let live = true;
    // The session state machine lives in a module, so the listener has no
    // closure to go stale and never needs resubscribing.
    const unsubscribe = api!.onVoiceToggle!(() => toggleRecording());

    Promise.resolve(api!.setPushToTalkEnabled!(enabled, accelerator, ownerId))
      .then((result) => {
        if (live) setHotkeyStatus(interpretRegistration(result as RegistrationResult, accelerator));
      })
      .catch((err: unknown) => {
        if (!live) return;
        setHotkeyStatus({
          state: "failed",
          accelerator,
          reason: "unknown",
          message: err instanceof Error ? err.message : "Could not register the shortcut.",
        });
      });

    return () => {
      live = false;
      unsubscribe?.();
      // Global shortcuts outlive the component, so the combination has to be
      // handed back or it stays stolen from every other application.
      void Promise.resolve(api!.setPushToTalkEnabled!(false, accelerator, ownerId)).catch(() => {});
      currentOwner = null;
      setHotkeyStatus({ state: "off" });
      // Stop any capture in flight. Turning the setting off mid-dictation left
      // MediaRecorder running: `enabled` merely flipped, so nothing unmounted,
      // and the hotkey that would have stopped it had just been released. The
      // only way out was quitting the app.
      if (getVoiceSnapshot().status === "recording") stopRecording();
    };
  }, [enabled, accelerator, canRegister, api, ownerId]);

  const toggle = useCallback(() => toggleRecording(), []);

  return {
    isListening: snapshot.status === "recording",
    isTranscribing: snapshot.status === "transcribing",
    isAvailable: canRegister && snapshot.isSupported,
    hotkey: snapshot.hotkey,
    toggle,
  };
}
