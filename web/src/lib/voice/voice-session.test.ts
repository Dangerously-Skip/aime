// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  detectVoiceSupport,
  getTranscriptTarget,
  getVoiceSnapshot,
  registerTranscriptSink,
  releaseTranscriptTarget,
  resetVoiceSession,
  setTranscriptTarget,
  startRecording,
  stopRecording,
  toggleRecording,
} from './voice-session';
import { installFakeMediaStack, type FakeMediaStack } from './__fixtures__/fake-media';

/**
 * The single recording session, driven directly.
 *
 * The React-facing behaviour is covered in `hooks/use-voice-input.test.tsx`;
 * this file pins the state machine itself, including the paths a UI test cannot
 * reach easily — a denied microphone, a transcription that throws, a stop that
 * arrives while the permission prompt is still open.
 *
 * Real: the state machine, the too-short-audio guard, the decode call, sink
 * resolution. Faked: the browser media APIs and the Whisper model, neither of
 * which exists under vitest (see __fixtures__/fake-media).
 */

const transcribe = vi.fn(async (_input: Float32Array) => ({ text: ' hello there ' }));
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(async () => (input: Float32Array) => transcribe(input)),
}));
vi.mock('@/lib/telemetry/events', () => ({ sendFeatureAdoptionEvent: vi.fn() }));

let media: FakeMediaStack;
let delivered: string[];

/** Let the recorder's onstop → decode → transcribe → idle chain settle. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  transcribe.mockResolvedValue({ text: ' hello there ' });
  resetVoiceSession();
  media = installFakeMediaStack();
  delivered = [];
  registerTranscriptSink(null, (text) => delivered.push(text));
  detectVoiceSupport();
});

afterEach(() => {
  resetVoiceSession();
  vi.unstubAllGlobals();
});

describe('voice session — the state machine', () => {
  it('records, transcribes, and returns to idle', async () => {
    await startRecording();
    expect(getVoiceSnapshot().status).toBe('recording');

    stopRecording();
    // Transcribing immediately, not after onstop lands: otherwise a fast second
    // press would start a new take on top of the one being finished.
    expect(getVoiceSnapshot().status).toBe('transcribing');

    await settle();
    expect(getVoiceSnapshot().status).toBe('idle');
    expect(delivered).toEqual(['hello there']);
  });

  it('a second start is refused while one is already running', async () => {
    await startRecording();
    await startRecording();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(media.recorders()).toHaveLength(1);
  });

  it('two starts in the same tick open one microphone', async () => {
    // The claim has to be synchronous: both callers would otherwise clear an
    // async status check before either had set it.
    await Promise.all([startRecording(), startRecording()]);
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('honours a stop that arrives while the mic permission is pending', async () => {
    let grant: ((stream: unknown) => void) | undefined;
    media.getUserMedia.mockReturnValueOnce(
      new Promise((resolve) => {
        grant = resolve;
      }),
    );

    const started = startRecording();
    stopRecording(); // user changed their mind before the prompt resolved
    grant?.({ getTracks: () => [{ stop: () => {} }] });
    await started;
    await settle();

    expect(media.liveRecorders()).toHaveLength(0);
    expect(getVoiceSnapshot().status).toBe('idle');
  });

  it('releases the microphone when the take ends', async () => {
    await startRecording();
    stopRecording();
    await settle();
    expect(media.tracks).toHaveLength(1);
    expect(media.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('stays idle when the microphone is denied', async () => {
    media.getUserMedia.mockRejectedValueOnce(new Error('NotAllowedError'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await startRecording();
    expect(getVoiceSnapshot().status).toBe('idle');
    expect(media.recorders()).toHaveLength(0);

    // …and a later attempt is not blocked by the failed one.
    await startRecording();
    expect(getVoiceSnapshot().status).toBe('recording');
    warn.mockRestore();
  });

  it('never gets stuck in transcribing when Whisper throws', async () => {
    transcribe.mockRejectedValueOnce(new Error('wasm exploded'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await startRecording();
    stopRecording();
    await settle();

    // A stuck 'transcribing' would refuse every later press — the mic button
    // would spin forever with no way back.
    expect(getVoiceSnapshot().status).toBe('idle');
    expect(delivered).toEqual([]);
    warn.mockRestore();
  });

  it('discards audio shorter than half a second', async () => {
    media.setDecodedSamples(4000); // 0.25s at 16 kHz
    await startRecording();
    stopRecording();
    await settle();

    expect(delivered).toEqual([]);
    expect(getVoiceSnapshot().status).toBe('idle');
  });

  it('does nothing when the renderer cannot record', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    detectVoiceSupport();
    expect(getVoiceSnapshot().isSupported).toBe(false);

    await startRecording();
    expect(getVoiceSnapshot().status).toBe('idle');
  });
});

describe('voice session — the toggle', () => {
  it('alternates start and stop', async () => {
    toggleRecording();
    await settle();
    expect(getVoiceSnapshot().status).toBe('recording');

    toggleRecording();
    expect(getVoiceSnapshot().status).toBe('transcribing');
    await settle();
    expect(delivered).toEqual(['hello there']);
  });

  it('ignores a press while the previous take is still transcribing', async () => {
    let finish: ((value: { text: string }) => void) | undefined;
    transcribe.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    await startRecording();
    stopRecording();
    await settle();
    expect(getVoiceSnapshot().status).toBe('transcribing');

    toggleRecording();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);

    finish?.({ text: 'kept' });
    await settle();
    expect(delivered).toEqual(['kept']);
  });

  it('stops a take whose mic prompt has not resolved yet', async () => {
    media.getUserMedia.mockReturnValueOnce(new Promise(() => {})); // never resolves
    toggleRecording();
    await Promise.resolve();

    toggleRecording(); // must not queue a second recording behind the first
    await settle();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe('voice session — where the transcript goes', () => {
  beforeEach(() => {
    resetVoiceSession();
    detectVoiceSupport();
    delivered = [];
  });

  async function dictate() {
    await startRecording();
    stopRecording();
    await settle();
  }

  it('delivers to the sink of the scope that is on screen', async () => {
    const chat: string[] = [];
    const cowork: string[] = [];
    registerTranscriptSink('chat', (t) => chat.push(t));
    registerTranscriptSink('cowork', (t) => cowork.push(t));

    setTranscriptTarget('cowork');
    await dictate();
    expect(cowork).toEqual(['hello there']);
    expect(chat).toEqual([]);

    setTranscriptTarget('chat');
    await dictate();
    expect(chat).toEqual(['hello there']);
    expect(cowork).toHaveLength(1);
  });

  it('prefers the newest sink for a scope, so a re-mounted composer wins', async () => {
    const first: string[] = [];
    const second: string[] = [];
    registerTranscriptSink('chat', (t) => first.push(t));
    registerTranscriptSink('chat', (t) => second.push(t));
    setTranscriptTarget('chat');

    await dictate();
    // Both would mean the duplicate-transcript bug all over again.
    expect(second).toEqual(['hello there']);
    expect(first).toEqual([]);
  });

  it('falls back to a scope-less consumer when the target has no sink', async () => {
    const loose: string[] = [];
    registerTranscriptSink(null, (t) => loose.push(t));
    setTranscriptTarget('assistant');

    await dictate();
    expect(loose).toEqual(['hello there']);
  });

  it('discards rather than guessing when nothing on screen can take it', async () => {
    const offscreen: string[] = [];
    registerTranscriptSink('chat', (t) => offscreen.push(t));
    setTranscriptTarget('assistant'); // a surface with no composer
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await dictate();
    // Text appearing in a composer the user cannot see is worse than losing it.
    expect(offscreen).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('discarded'));
    warn.mockRestore();
  });

  it('unregisters cleanly', async () => {
    const gone: string[] = [];
    const unregister = registerTranscriptSink('chat', (t) => gone.push(t));
    registerTranscriptSink(null, (t) => gone.push(`fallback:${t}`));
    setTranscriptTarget('chat');
    unregister();

    await dictate();
    expect(gone).toEqual(['fallback:hello there']);
  });

  it('releasing a target only clears it if it is still the one set', () => {
    // Surface switches run every cleanup before any new effect, so a stale
    // release must not wipe the target the incoming surface just claimed.
    setTranscriptTarget('chat');
    releaseTranscriptTarget('cowork');
    expect(getTranscriptTarget()).toBe('chat');

    releaseTranscriptTarget('chat');
    expect(getTranscriptTarget()).toBeNull();
  });
});
