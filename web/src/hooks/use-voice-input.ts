'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  detectVoiceSupport,
  getServerVoiceHotkeyStatus,
  getServerVoiceSnapshot,
  getVoiceHotkeyStatus,
  getVoiceSnapshot,
  prewarmTranscriber,
  registerTranscriptSink,
  setVoiceLanguage,
  startRecording,
  stopRecording,
  subscribeToVoiceSession,
  type HotkeyStatus,
} from '@/lib/voice/voice-session';
import { useVoiceScopeId } from '@/lib/voice/voice-scope';

/**
 * A view onto the app's single recording session (see `lib/voice/voice-session`).
 *
 * This hook used to OWN a recorder: private `mediaRecorderRef`, private
 * `isListening`, a start guard that only knew about itself. Mounting it twice —
 * which the app did, once in `VoiceButton` and once inside `usePushToTalk` —
 * therefore produced two microphones. The state now lives in one module and this
 * hook only subscribes to it, so "two mounts, one recording" is structural
 * rather than something callers have to arrange.
 *
 * `onTranscript` registers a destination for the finished text, scoped to the
 * enclosing `VoiceScope`. Whether it is the one that receives a given transcript
 * is decided by which scope is on screen, not by who started the recording.
 */

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  lang?: string;
}

interface UseVoiceInputReturn {
  isListening: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
  startListening: () => void;
  stopListening: () => void;
}

export function useVoiceInput({ onTranscript, lang = 'en' }: UseVoiceInputOptions): UseVoiceInputReturn {
  const scope = useVoiceScopeId();
  const snapshot = useSyncExternalStore(
    subscribeToVoiceSession,
    getVoiceSnapshot,
    getServerVoiceSnapshot,
  );

  // Read through a ref so the sink registration does not churn on every render:
  // re-registering would reorder sinks and change which composer wins.
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    // Support detection needs `window`, so it cannot happen during render.
    detectVoiceSupport();
    prewarmTranscriber();
  }, []);

  useEffect(() => {
    setVoiceLanguage(lang);
  }, [lang]);

  useEffect(
    () => registerTranscriptSink(scope, (text) => onTranscriptRef.current(text)),
    [scope],
  );

  const startListening = useCallback(() => {
    void startRecording();
  }, []);

  return {
    isListening: snapshot.status === 'recording',
    isTranscribing: snapshot.status === 'transcribing',
    isSupported: snapshot.isSupported,
    startListening,
    stopListening: stopRecording,
  };
}

/**
 * What the global hotkey is doing right now, for UI that has to be honest about
 * it — a settings switch that reads ON while the OS refused the combination is
 * the failure this exists to prevent.
 */
export function useVoiceHotkeyStatus(): HotkeyStatus {
  return useSyncExternalStore(
    subscribeToVoiceSession,
    getVoiceHotkeyStatus,
    getServerVoiceHotkeyStatus,
  );
}
