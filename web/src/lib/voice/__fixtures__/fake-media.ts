import { vi, type Mock } from 'vitest';

/**
 * A fake browser media stack for the voice tests.
 *
 * This is NOT a mock of anything under test. It stands in for the four things
 * vitest genuinely cannot provide — `getUserMedia`, `MediaRecorder`,
 * `AudioContext.decodeAudioData`, and the Whisper WASM model — and counts how
 * many times each is used. Everything between them stays real: the session
 * state machine, the single-recorder claim, the decode call, the transcript
 * routing, and the React hooks.
 *
 * The counts are the point. The push-to-talk defect was two independent
 * recording sessions, which no amount of asserting on `isListening` could see;
 * only "how many microphone streams did we actually open" catches it.
 */

export interface RecordedTrack {
  stop: () => void;
  stopped: boolean;
}

/** Minimal MediaRecorder stand-in. Fires its callbacks synchronously on stop(). */
export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (_type: string) => true;

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  startCalls = 0;

  constructor(public stream: { getTracks: () => RecordedTrack[] }) {
    FakeMediaRecorder.instances.push(this);
  }

  start(_timesliceMs?: number) {
    this.startCalls += 1;
    this.state = 'recording';
  }

  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    // A real recorder flushes a final chunk before onstop; mirror that so the
    // blob is non-empty and the transcription path actually runs.
    this.ondataavailable?.({ data: new Blob(['pretend-opus-bytes']) });
    this.onstop?.();
  }
}

export interface FakeMediaStack {
  /** Every `getUserMedia` call — one per microphone session. */
  getUserMedia: Mock;
  /** Tracks handed out, so a stream nobody released is visible. */
  tracks: RecordedTrack[];
  /** Every recorder ever constructed. */
  recorders: () => FakeMediaRecorder[];
  /** Recorders still running. Must never exceed 1. */
  liveRecorders: () => FakeMediaRecorder[];
  /** Audio decoded, i.e. transcription attempts. */
  decodes: () => number;
  /** How much audio the decoder returns; below 8000 trips the too-short guard. */
  setDecodedSamples: (samples: number) => void;
}

/** Samples returned by the fake decoder: 1s at 16 kHz, above the 0.5s floor. */
const DECODED_SAMPLES = 16000;

/**
 * Install the fake stack on the jsdom globals. Call from `beforeEach`
 * (`vi.unstubAllGlobals()` in `afterEach` undoes the global stubs).
 */
export function installFakeMediaStack(): FakeMediaStack {
  const tracks: RecordedTrack[] = [];
  let decodeCount = 0;
  let decodedSamples = DECODED_SAMPLES;
  FakeMediaRecorder.instances = [];

  const getUserMedia = vi.fn(async () => {
    const track: RecordedTrack = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    tracks.push(track);
    return { getTracks: () => [track] } as unknown as MediaStream;
  });

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

  // jsdom ships no Web Audio at all, so the real audioToFloat32 needs one.
  vi.stubGlobal(
    'AudioContext',
    class FakeAudioContext {
      constructor(_options?: { sampleRate?: number }) {}
      async decodeAudioData(_buffer: ArrayBuffer) {
        decodeCount += 1;
        return { getChannelData: (_channel: number) => new Float32Array(decodedSamples) };
      }
      close() {}
    },
  );

  return {
    getUserMedia,
    tracks,
    recorders: () => FakeMediaRecorder.instances,
    liveRecorders: () => FakeMediaRecorder.instances.filter((r) => r.state !== 'inactive'),
    decodes: () => decodeCount,
    setDecodedSamples: (samples: number) => {
      decodedSamples = samples;
    },
  };
}
