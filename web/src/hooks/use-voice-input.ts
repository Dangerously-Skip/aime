'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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

// Lazy-loaded Whisper pipeline (shared across all hook instances)
let pipelinePromise: Promise<unknown> | null = null;
let pipelineInstance: unknown = null;
let loadError: string | null = null;

async function getWhisperPipeline() {
  if (pipelineInstance) return pipelineInstance;
  if (loadError) throw new Error(loadError);

  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        const { pipeline } = await import('@huggingface/transformers');
        const pipe = await pipeline(
          'automatic-speech-recognition',
          'onnx-community/whisper-base',
          {
            dtype: 'q8',
            device: 'wasm',
          },
        );
        pipelineInstance = pipe;
        return pipe;
      } catch (err) {
        loadError = err instanceof Error ? err.message : 'Failed to load Whisper model';
        pipelinePromise = null;
        throw err;
      }
    })();
  }

  return pipelinePromise;
}

/** Convert a Blob of recorded audio to a Float32Array at 16 kHz mono (Whisper's expected format). */
async function audioToFloat32(blob: Blob): Promise<Float32Array> {
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ sampleRate: 16000 });
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // Take channel 0 (mono)
  const float32 = audioBuffer.getChannelData(0);
  audioCtx.close();
  return float32;
}

export function useVoiceInput({ onTranscript, lang = 'en' }: UseVoiceInputOptions): UseVoiceInputReturn {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const langRef = useRef(lang);
  langRef.current = lang;

  // Check if MediaRecorder is available
  useEffect(() => {
    setIsSupported(
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }, []);

  // Pre-warm the model in the background on first mount
  useEffect(() => {
    if (isSupported && !pipelineInstance && !pipelinePromise) {
      getWhisperPipeline().catch(() => {
        // Silently fail — will retry on first use
      });
    }
  }, [isSupported]);

  const processAudio = useCallback(async (audioBlob: Blob) => {
    setIsTranscribing(true);
    try {
      const pipe = await getWhisperPipeline() as (
        input: Float32Array,
        options?: { language?: string; task?: string }
      ) => Promise<{ text: string }>;

      const float32 = await audioToFloat32(audioBlob);

      // Skip tiny recordings (< 0.5s of audio at 16kHz)
      if (float32.length < 8000) {
        return;
      }

      const result = await pipe(float32, {
        language: langRef.current,
        task: 'transcribe',
      });

      const text = result.text?.trim();
      if (text) {
        onTranscriptRef.current(text);
      }
    } catch (err) {
      console.warn('[VoiceInput] Transcription error:', err);
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const startListening = useCallback(async () => {
    if (mediaRecorderRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        // Combine chunks and transcribe
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        chunksRef.current = [];

        // Stop all tracks to release the mic
        stream.getTracks().forEach((track) => track.stop());

        if (blob.size > 0) {
          processAudio(blob);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000); // Collect in 1-second chunks
      setIsListening(true);
    } catch (err) {
      console.warn('[VoiceInput] Mic access error:', err);
      setIsListening(false);
    }
  }, [processAudio]);

  const stopListening = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setIsListening(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      mediaRecorderRef.current = null;
    };
  }, []);

  return { isListening, isTranscribing, isSupported, startListening, stopListening };
}
