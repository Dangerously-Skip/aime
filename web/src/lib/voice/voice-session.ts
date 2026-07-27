/**
 * The app's ONE voice recording session.
 *
 * Dictation has two triggers — the mic button in a composer and the global
 * hotkey — and they were originally implemented as two independent
 * `useVoiceInput` instances, each with its own `MediaRecorder` and its own
 * `isListening`. Neither could see the other, so clicking the mic and then
 * pressing the hotkey opened two microphone streams, transcribed the same words
 * twice, and left the button rendering "Voice input" while a recording it did
 * not own was running.
 *
 * A microphone is a single, exclusive, machine-wide resource; the code that
 * models it has to be single too. So the state machine lives here, at module
 * scope, and every trigger goes through it. "At most one recording" is then a
 * property of the module rather than a rule each caller has to remember:
 *
 *   idle ──start──▶ recording ──stop──▶ transcribing ──▶ idle
 *
 * React reads this through `useSyncExternalStore` (see `use-voice-input.ts`),
 * which is why the snapshot is an immutable object swapped on every change.
 *
 * Deliberately free of React and of Electron so it can be driven directly from
 * tests.
 */

/** Where the single session is in its cycle. */
export type VoiceStatus = 'idle' | 'recording' | 'transcribing';

/** Why the OS would not give us the combination. */
export type HotkeyFailure = 'taken' | 'invalid' | 'owned-elsewhere' | 'unknown';

/**
 * What the global hotkey is actually doing right now — as opposed to what the
 * setting says. The gap between the two is the failure mode worth surfacing: a
 * switch that reads ON while no hotkey works.
 */
export type HotkeyStatus =
  | { state: 'off' }
  | { state: 'unavailable' }
  | { state: 'held'; accelerator: string }
  | { state: 'failed'; accelerator: string; reason: HotkeyFailure; message: string };

export interface VoiceSnapshot {
  status: VoiceStatus;
  /** Whether this browser/renderer can record at all. */
  isSupported: boolean;
  hotkey: HotkeyStatus;
}

const HOTKEY_OFF: HotkeyStatus = { state: 'off' };

/**
 * The snapshot used during SSR and hydration. A constant, because
 * `useSyncExternalStore` compares by identity and a fresh object each call
 * would re-render forever.
 */
const SERVER_SNAPSHOT: VoiceSnapshot = { status: 'idle', isSupported: false, hotkey: HOTKEY_OFF };

let snapshot: VoiceSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();

function update(patch: Partial<VoiceSnapshot>): void {
  const next = { ...snapshot, ...patch };
  if (
    next.status === snapshot.status &&
    next.isSupported === snapshot.isSupported &&
    next.hotkey === snapshot.hotkey
  ) {
    return;
  }
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeToVoiceSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVoiceSnapshot(): VoiceSnapshot {
  return snapshot;
}

export function getServerVoiceSnapshot(): VoiceSnapshot {
  return SERVER_SNAPSHOT;
}

export function getVoiceHotkeyStatus(): HotkeyStatus {
  return snapshot.hotkey;
}

export function getServerVoiceHotkeyStatus(): HotkeyStatus {
  return HOTKEY_OFF;
}

/** Recorded by the hotkey owner so Settings can show what the OS actually did. */
export function setHotkeyStatus(status: HotkeyStatus): void {
  update({ hotkey: status });
}

// ── Where a finished transcript goes ────────────────────────────────────────
//
// One session, many possible destinations: each surface has its own composer
// with its own local input state. A sink is registered per voice scope (see
// `voice-scope.tsx`), and the shell nominates which scope is on screen. That
// keeps `activeSurface === '<literal>'` out of the surfaces themselves, which is
// where the original ownership bug was copied from.

interface TranscriptSink {
  /** Voice scope id, or null for a consumer mounted outside any scope. */
  scope: string | null;
  deliver: (text: string) => void;
}

/** Registration order; the newest wins, so a re-mounted composer takes over. */
const sinks: TranscriptSink[] = [];
let targetScope: string | null = null;

export function registerTranscriptSink(
  scope: string | null,
  deliver: (text: string) => void,
): () => void {
  const sink: TranscriptSink = { scope, deliver };
  sinks.push(sink);
  return () => {
    const index = sinks.indexOf(sink);
    if (index >= 0) sinks.splice(index, 1);
  };
}

/** Called by the active `VoiceScope`. */
export function setTranscriptTarget(scope: string | null): void {
  targetScope = scope;
}

/** Called when a scope stops being active, so a stale target cannot linger. */
export function releaseTranscriptTarget(scope: string): void {
  if (targetScope === scope) targetScope = null;
}

export function getTranscriptTarget(): string | null {
  return targetScope;
}

function resolveSink(): ((text: string) => void) | null {
  // Newest sink for the on-screen scope…
  for (let i = sinks.length - 1; i >= 0; i--) {
    if (sinks[i].scope === targetScope) return sinks[i].deliver;
  }
  // …otherwise a scope-less consumer (a mic button used outside the surfaces).
  for (let i = sinks.length - 1; i >= 0; i--) {
    if (sinks[i].scope === null) return sinks[i].deliver;
  }
  return null;
}

function deliverTranscript(text: string): void {
  const sink = resolveSink();
  if (!sink) {
    // Dropping beats guessing: putting dictated words into a composer the user
    // cannot see is worse than losing them. Surfaces without a composer (the
    // assistant surface, the projects view) have nowhere to put them.
    console.warn('[Voice] Transcript discarded — the active surface has no composer.');
    return;
  }
  sink(text);
}

// ── Whisper ────────────────────────────────────────────────────────────────
// Lazily loaded and shared, because the model is tens of megabytes.

let pipelinePromise: Promise<unknown> | null = null;
let pipelineInstance: unknown = null;
let loadError: string | null = null;

async function getWhisperPipeline(): Promise<unknown> {
  if (pipelineInstance) return pipelineInstance;
  if (loadError) throw new Error(loadError);

  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        const { pipeline } = await import('@huggingface/transformers');
        const pipe = await pipeline(
          'automatic-speech-recognition',
          'onnx-community/whisper-base',
          { dtype: 'q8', device: 'wasm' },
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

/** Start fetching the model before the user needs it. Safe to call repeatedly. */
export function prewarmTranscriber(): void {
  if (!snapshot.isSupported || pipelineInstance || pipelinePromise) return;
  getWhisperPipeline().catch(() => {
    // Silently fail — retried on first use.
  });
}

/** Recorded audio → Float32Array at 16 kHz mono, the format Whisper expects. */
async function audioToFloat32(blob: Blob): Promise<Float32Array> {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new Ctor({ sampleRate: 16000 });
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    return audioBuffer.getChannelData(0); // channel 0 = mono
  } finally {
    audioCtx.close();
  }
}

// ── The session ────────────────────────────────────────────────────────────

let recorder: MediaRecorder | null = null;
let activeStream: MediaStream | null = null;
let chunks: Blob[] = [];
/**
 * Set synchronously, before the first `await`. Two callers in the same tick
 * (mic button and hotkey) would both clear an async status check and open two
 * microphone streams — which is precisely what happened.
 */
let starting = false;
let stopRequestedWhileStarting = false;
let language = 'en';

export function setVoiceLanguage(lang: string): void {
  language = lang;
}

/** Does this renderer have the APIs to record? Cached on the snapshot. */
export function detectVoiceSupport(): boolean {
  const supported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';
  if (supported !== snapshot.isSupported) update({ isSupported: supported });
  return supported;
}

function releaseStream(): void {
  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = null;
}

export async function startRecording(): Promise<void> {
  if (starting || snapshot.status !== 'idle') return;
  if (!detectVoiceSupport()) return;

  starting = true;
  stopRequestedWhileStarting = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeStream = stream;
    chunks = [];

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = () => finishRecording(mediaRecorder.mimeType);

    recorder = mediaRecorder;
    mediaRecorder.start(1000); // 1-second chunks
    starting = false;
    update({ status: 'recording' });

    // A stop that arrived while the mic permission was still resolving.
    if (stopRequestedWhileStarting) {
      stopRequestedWhileStarting = false;
      stopRecording();
    }
  } catch (err) {
    starting = false;
    console.warn('[Voice] Mic access error:', err);
    releaseStream();
    recorder = null;
    update({ status: 'idle' });
  }
}

export function stopRecording(): void {
  if (starting) {
    // getUserMedia has not resolved yet; honour the stop as soon as it does.
    stopRequestedWhileStarting = true;
    return;
  }
  const active = recorder;
  if (!active) {
    if (snapshot.status === 'recording') update({ status: 'idle' });
    return;
  }
  // Optimistic: `MediaRecorder.stop()` fires `onstop` asynchronously, and
  // leaving the status at 'recording' in the meantime would let a second press
  // start a new take on top of the one being finished.
  update({ status: 'transcribing' });
  if (active.state !== 'inactive') active.stop();
  else finishRecording(active.mimeType);
}

/** Called from `onstop`, including when the recorder ends on its own. */
function finishRecording(mimeType: string): void {
  const blob = new Blob(chunks, { type: mimeType });
  chunks = [];
  releaseStream();
  recorder = null;

  if (blob.size === 0) {
    update({ status: 'idle' });
    return;
  }
  update({ status: 'transcribing' });
  void transcribe(blob);
}

async function transcribe(blob: Blob): Promise<void> {
  try {
    const pipe = (await getWhisperPipeline()) as (
      input: Float32Array,
      options?: { language?: string; task?: string },
    ) => Promise<{ text: string }>;

    const float32 = await audioToFloat32(blob);
    // Under half a second at 16 kHz: a stray keypress, not speech.
    if (float32.length < 8000) return;

    const result = await pipe(float32, { language, task: 'transcribe' });
    const text = result.text?.trim();
    if (!text) return;

    deliverTranscript(text);
    import('@/lib/telemetry/events')
      .then(({ sendFeatureAdoptionEvent }) => sendFeatureAdoptionEvent({ feature: 'voice_input' }))
      .catch(() => {});
  } catch (err) {
    console.warn('[Voice] Transcription error:', err);
  } finally {
    update({ status: 'idle' });
  }
}

/**
 * Start or stop — the single entry point both the hotkey and the mic button use.
 *
 * Toggle rather than hold-to-talk because a global keydown/keyup pair is not
 * deliverable on every platform (macOS gives no keyup for a registered global
 * shortcut), so press-to-start / press-to-stop is the behaviour that actually
 * works rather than the one that reads better in a changelog.
 */
export function toggleRecording(): void {
  if (!detectVoiceSupport()) return;
  // A press while Whisper is still working would discard a transcript the user
  // is waiting for.
  if (snapshot.status === 'transcribing') return;
  if (snapshot.status === 'recording' || starting) stopRecording();
  else void startRecording();
}

/**
 * Tear the session down: used by tests, and by anything that needs a hard stop.
 * Module state outlives a React tree, so tests must be able to clear it.
 */
export function resetVoiceSession(): void {
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = null;
    recorder.stop();
  }
  recorder = null;
  releaseStream();
  chunks = [];
  starting = false;
  stopRequestedWhileStarting = false;
  sinks.length = 0;
  targetScope = null;
  language = 'en';
  pipelinePromise = null;
  pipelineInstance = null;
  loadError = null;
  snapshot = SERVER_SNAPSHOT;
  for (const listener of [...listeners]) listener();
}
