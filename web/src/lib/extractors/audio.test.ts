import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decodeWav, extractAudio, WHISPER_MODEL } from './audio';

/**
 * Server-side Whisper transcription (attachments, and video via ffmpeg).
 *
 * Real: WAV parsing, the call into the pipeline, the error path, the cache
 * move (real files in a tmpdir) — and the actual transformers.js `env`, which
 * the mock below passes through so `env.cacheDir` is the library's own. Faked:
 * the model itself, and the cache-presence check that decides whether it must
 * download. A real Whisper run downloads ~950 MB on first use, so it is not a
 * unit test: `audio.real-model.test.ts` is, opt-in.
 */

const transcribe = vi.fn(async (_audio: Float32Array, _opts?: unknown) => ({ text: '  hello there  ' }));
const pipeline = vi.fn(async (..._args: unknown[]): Promise<unknown> => transcribe);
const isPipelineCached = vi.fn(async (..._args: unknown[]) => true);
vi.mock('@huggingface/transformers', async (importOriginal) => {
  const real = await importOriginal<typeof import('@huggingface/transformers')>();
  return {
    env: real.env,
    pipeline: (...args: unknown[]) => pipeline(...args),
    ModelRegistry: { is_pipeline_cached: (...args: unknown[]) => isPipelineCached(...args) },
  };
});

/** Stand-ins for ~/.aime/models/transformers and the in-package `.cache/`. */
const dirs = vi.hoisted(() => ({ root: '', appCache: '', legacyCache: '' }));
vi.mock('@/lib/app-paths', () => ({ getModelCacheDir: () => dirs.appCache }));

/** A canonical 44-byte-header PCM16 WAV, from raw int16 sample values. */
function pcm16Wav(samples: number[], sampleRate = 16000): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

interface WavSpec {
  format?: 1 | 3 | 0xfffe; // PCM, IEEE float, WAVE_FORMAT_EXTENSIBLE
  subFormat?: 1 | 3;
  sampleRate: number;
  bits: 8 | 16 | 24 | 32;
  /** One array per frame, one value per channel, in -1..1. */
  frames: number[][];
  /** Chunks written before `fmt `, and between `fmt ` and `data`. */
  before?: Array<[string, Buffer]>;
  between?: Array<[string, Buffer]>;
  /** Override for the data chunk's size field (streaming writers leave it unset). */
  dataSize?: number;
}

function chunk(id: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  // RIFF chunks are word-aligned: an odd-sized body is followed by a pad byte.
  return Buffer.concat([head, body, Buffer.alloc(body.length % 2)]);
}

/** Any WAV the parser claims to read, built field by field. */
function wav(spec: WavSpec): Buffer {
  const format = spec.format ?? 1;
  const channels = spec.frames[0]?.length ?? 1;
  const bytes = spec.bits / 8;
  const float = format === 3 || spec.subFormat === 3;
  const fmt = Buffer.alloc(format === 0xfffe ? 40 : 16);
  fmt.writeUInt16LE(format, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(spec.sampleRate, 4);
  fmt.writeUInt32LE(spec.sampleRate * channels * bytes, 8);
  fmt.writeUInt16LE(channels * bytes, 12);
  fmt.writeUInt16LE(spec.bits, 14);
  if (format === 0xfffe) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(spec.subFormat ?? 1, 24);
  }
  const data = Buffer.alloc(spec.frames.length * channels * bytes);
  let o = 0;
  for (const frame of spec.frames) {
    for (const v of frame) {
      if (float) data.writeFloatLE(v, o);
      else if (spec.bits === 8) data.writeUInt8(Math.round(v * 127) + 128, o);
      else if (spec.bits === 16) data.writeInt16LE(Math.round(v * 32767), o);
      else if (spec.bits === 24) data.writeIntLE(Math.round(v * 8388607), o, 3);
      else data.writeInt32LE(Math.round(v * 2147483647), o);
      o += bytes;
    }
  }
  const dataChunk = chunk('data', data);
  if (spec.dataSize !== undefined) dataChunk.writeUInt32LE(spec.dataSize, 4);
  const body = Buffer.concat([
    Buffer.from('WAVE', 'ascii'),
    ...(spec.before ?? []).map(([id, b]) => chunk(id, b)),
    chunk('fmt ', fmt),
    ...(spec.between ?? []).map(([id, b]) => chunk(id, b)),
    dataChunk,
  ]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/** Run the real extractor with the model faked; return what Whisper was handed. */
async function samplesSentToWhisper(buffer: Buffer): Promise<Float32Array> {
  transcribe.mockClear();
  const result = await extractAudio(buffer, 'clip.wav');
  expect(result.metadata?.error).toBeUndefined();
  return transcribe.mock.calls[0][0];
}

const frames = (n: number, ...channels: number[]) => Array.from({ length: n }, () => channels);

const realEnv = vi.hoisted(() => ({ cacheDir: undefined as string | null | undefined }));

beforeEach(async () => {
  globalThis.__whisper = undefined;
  pipeline.mockReset();
  pipeline.mockImplementation(async () => transcribe);
  transcribe.mockClear();
  isPipelineCached.mockReset();
  isPipelineCached.mockResolvedValue(true);

  dirs.root = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-audio-test-'));
  dirs.appCache = path.join(dirs.root, 'home', '.aime', 'models', 'transformers');
  dirs.legacyCache = path.join(dirs.root, 'pkg', '.cache');
  // The library's default, pointed at a tmpdir: a real cache in the shared
  // node_modules must never be what a unit test moves.
  const { env } = await vi.importActual<typeof import('@huggingface/transformers')>('@huggingface/transformers');
  realEnv.cacheDir ??= env.cacheDir;
  env.cacheDir = dirs.legacyCache;
});

afterEach(() => {
  globalThis.__whisper = undefined;
  fs.rmSync(dirs.root, { recursive: true, force: true });
});

afterAll(async () => {
  const { env } = await vi.importActual<typeof import('@huggingface/transformers')>('@huggingface/transformers');
  env.cacheDir = realEnv.cacheDir ?? null;
});

/** A promise settled from outside, for a download that is still running. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('extractAudio', () => {
  it('transcribes a 16 kHz WAV: samples in, trimmed text out', async () => {
    const result = await extractAudio(pcm16Wav([0, 16384, -32768, 8192]), 'note.wav');

    expect(result).toEqual({ text: 'hello there', metadata: { type: 'audio', format: 'wav' } });
    expect(pipeline).toHaveBeenCalledWith(
      'automatic-speech-recognition',
      WHISPER_MODEL,
      expect.objectContaining({ dtype: 'fp32' }),
    );
    const [audio, opts] = transcribe.mock.calls[0];
    expect(Array.from(audio)).toEqual([0, 0.5, -1, 0.25]);
    expect(opts).toEqual({ chunk_length_s: 30, stride_length_s: 5, return_timestamps: false });
  });

  it('loads the model once and reuses it', async () => {
    await extractAudio(pcm16Wav([100]), 'a.wav');
    await extractAudio(pcm16Wav([200]), 'b.wav');
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('two attachments in the same moment start ONE load', async () => {
    const [a, b] = await Promise.all([
      extractAudio(pcm16Wav([100]), 'a.wav'),
      extractAudio(pcm16Wav([200]), 'b.wav'),
    ]);
    expect([a.text, b.text]).toEqual(['hello there', 'hello there']);
    expect(pipeline).toHaveBeenCalledTimes(1);
  });

  it('a failed model load comes back as text, not a thrown error, and is retried next time', async () => {
    pipeline.mockRejectedValueOnce(new Error('onnxruntime could not create a session'));
    const failed = await extractAudio(pcm16Wav([100]), 'a.wav');
    expect(failed.text).toBe('[Audio transcription failed: onnxruntime could not create a session]');
    expect(failed.metadata).toEqual({ type: 'audio', error: 'onnxruntime could not create a session' });

    const retried = await extractAudio(pcm16Wav([100]), 'a.wav');
    expect(retried.text).toBe('hello there');
    expect(pipeline).toHaveBeenCalledTimes(2);
  });

  it('an undecodable file says what failed — not that a model is downloading', async () => {
    const result = await extractAudio(Buffer.from('RIFF....WAVEjunk'), 'x.wav');
    expect(result.text).toMatch(/^\[Audio transcription failed: /);
    expect(result.text).not.toMatch(/950|download/i);
  });
});

/**
 * Where the weights live. The library default — `.cache/` inside the installed
 * package — is inside the app bundle when packaged, so an update deleted
 * ~950 MB of weights and the next attachment downloaded them again unseen.
 */
describe('model cache: the app data dir, not node_modules', () => {
  it('points transformers.js at the app cache before the pipeline loads', async () => {
    const { env } = await vi.importActual<typeof import('@huggingface/transformers')>('@huggingface/transformers');
    let cacheDirAtLoad: string | null = null;
    pipeline.mockImplementation(async () => {
      cacheDirAtLoad = env.cacheDir;
      return transcribe;
    });

    await extractAudio(pcm16Wav([1]), 'a.wav');
    expect(cacheDirAtLoad).toBe(dirs.appCache);
  });

  it('moves a model the old in-package cache holds instead of downloading it again', async () => {
    const legacyModel = path.join(dirs.legacyCache, WHISPER_MODEL);
    fs.mkdirSync(path.join(legacyModel, 'onnx'), { recursive: true });
    fs.writeFileSync(path.join(legacyModel, 'config.json'), '{}');
    fs.writeFileSync(path.join(legacyModel, 'onnx', 'encoder_model.onnx'), 'weights');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    let presentAtLoad = false;
    pipeline.mockImplementation(async () => {
      presentAtLoad = fs.existsSync(path.join(dirs.appCache, WHISPER_MODEL, 'onnx', 'encoder_model.onnx'));
      return transcribe;
    });
    const result = await extractAudio(pcm16Wav([1]), 'a.wav');

    expect(result.text).toBe('hello there');
    expect(presentAtLoad).toBe(true);
    expect(fs.existsSync(legacyModel)).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Moved the cached model'));
    log.mockRestore();
  });
});

/**
 * First use. The chat route gives extraction 30 seconds; a ~950 MB download
 * does not fit, so waiting for it only ever produced "Extraction timed out"
 * while the download carried on with nobody told.
 */
describe('first use: the model is downloading', () => {
  it('says so at once — size and destination, ONCE — then transcribes when it lands', async () => {
    isPipelineCached.mockResolvedValue(false);
    const download = deferred<typeof transcribe>();
    let onProgress: ((info: { status: string; progress: number }) => void) | undefined;
    pipeline.mockImplementation(async (...args: unknown[]) => {
      onProgress = (args[2] as { progress_callback: typeof onProgress }).progress_callback;
      return download.promise;
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const first = await extractAudio(pcm16Wav([1]), 'a.wav');
    expect(first.metadata).toEqual({ type: 'audio', error: 'model-downloading' });
    expect(first.text).toContain('~950 MB');
    expect(first.text).toContain(dirs.appCache);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`~950 MB.*${dirs.appCache}`)));

    onProgress?.({ status: 'progress_total', progress: 42.7 });
    const second = await extractAudio(pcm16Wav([1]), 'a.wav');
    expect(second.metadata).toEqual({ type: 'audio', error: 'model-downloading' });
    expect(second.text).toContain('still downloading (42% done)');
    expect(second.text).not.toContain('950');
    expect(second.text).not.toContain(dirs.appCache);

    download.resolve(transcribe);
    await vi.waitFor(() => expect(globalThis.__whisper?.transcriber).toBeDefined());
    const third = await extractAudio(pcm16Wav([1]), 'a.wav');
    expect(third.text).toBe('hello there');
    expect(pipeline).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('a failed download is reported to the next request, which starts it again', async () => {
    isPipelineCached.mockResolvedValue(false);
    const download = deferred<typeof transcribe>();
    pipeline.mockImplementationOnce(async () => download.promise);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await extractAudio(pcm16Wav([1]), 'a.wav');
    download.reject(new Error('fetch failed'));
    await vi.waitFor(() => expect(globalThis.__whisper?.started).toBeUndefined());

    const pending = deferred<typeof transcribe>();
    pipeline.mockImplementationOnce(async () => pending.promise);
    const next = await extractAudio(pcm16Wav([1]), 'a.wav');
    expect(next.text).toContain('The last download failed (fetch failed); trying again.');
    expect(next.text).toContain(dirs.appCache);
    expect(pipeline).toHaveBeenCalledTimes(2);
    log.mockRestore();
    warn.mockRestore();
  });
});

/**
 * Whisper is fed 16 kHz mono and nothing else. The parser used to read the
 * channel count and bit depth from fixed offsets 22/34, find the samples with
 * `indexOf('data')`, and never look at the sample rate at all — so a 44.1 kHz
 * recording, the most common WAV there is, reached the model 2.76x too slow.
 * Measured on a real `say` clip: "The quick brown fox jumps over the lazy dog."
 * came back as "The hip, wide, fruit, scratch, or the belly as a bird."
 */
describe('WAV decoding: whatever the file, Whisper gets 16 kHz mono', () => {
  it('resamples 44.1 kHz to 16 kHz', async () => {
    const audio = await samplesSentToWhisper(wav({ sampleRate: 44100, bits: 16, frames: frames(4410, 0.5) }));
    expect(audio.length).toBe(1600); // 100 ms either way
    for (const v of audio) expect(v).toBeCloseTo(0.5, 3);
  });

  it('upsamples 8 kHz telephony audio to 16 kHz', async () => {
    const audio = await samplesSentToWhisper(wav({ sampleRate: 8000, bits: 16, frames: frames(800, -0.25) }));
    expect(audio.length).toBe(1600);
    for (const v of audio) expect(v).toBeCloseTo(-0.25, 3);
  });

  it('keeps the shape of the signal through resampling, not just its level', async () => {
    // 440 Hz at 48 kHz in; the same 440 Hz must come out at 16 kHz. Counting
    // rising zero crossings is a frequency measurement that needs no FFT.
    const input = Array.from({ length: 48000 }, (_, i) => [0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000)]);
    const audio = await samplesSentToWhisper(wav({ sampleRate: 48000, bits: 16, frames: input }));
    expect(audio.length).toBe(16000);
    let rising = 0;
    for (let i = 1; i < audio.length; i++) if (audio[i - 1] < 0 && audio[i] >= 0) rising++;
    expect(rising).toBeGreaterThanOrEqual(439);
    expect(rising).toBeLessThanOrEqual(441);
  });

  it('downmixes stereo by averaging the channels rather than keeping the left one', async () => {
    const audio = await samplesSentToWhisper(wav({ sampleRate: 16000, bits: 16, frames: frames(160, 0.6, 0.2) }));
    expect(audio.length).toBe(160);
    for (const v of audio) expect(v).toBeCloseTo(0.4, 3);
  });

  it.each([
    ['8-bit PCM', { bits: 8 as const }],
    ['24-bit PCM', { bits: 24 as const }],
    ['32-bit integer PCM', { bits: 32 as const }],
    ['32-bit float', { bits: 32 as const, format: 3 as const }],
    ['WAVE_FORMAT_EXTENSIBLE, 24-bit PCM', { bits: 24 as const, format: 0xfffe as const, subFormat: 1 as const }],
    ['WAVE_FORMAT_EXTENSIBLE, float', { bits: 32 as const, format: 0xfffe as const, subFormat: 3 as const }],
  ])('%s', async (_label, encoding) => {
    const audio = await samplesSentToWhisper(wav({ sampleRate: 16000, frames: frames(32, 0.5), ...encoding }));
    expect(audio.length).toBe(32);
    for (const v of audio) expect(v).toBeCloseTo(0.5, 2);
  });

  it('walks the chunks: JUNK before fmt, and a LIST chunk that contains the word "data"', async () => {
    const audio = await samplesSentToWhisper(
      wav({
        sampleRate: 16000,
        bits: 16,
        frames: frames(16, 0.75),
        before: [['JUNK', Buffer.alloc(27)]], // odd size: exercises the pad byte too
        between: [['LIST', Buffer.from('INFOICMT\u000b\u0000\u0000\u0000raw data!\u0000', 'latin1')]],
      }),
    );
    expect(audio.length).toBe(16);
    for (const v of audio) expect(v).toBeCloseTo(0.75, 3);
  });

  it('reads a data chunk whose size a streaming writer left unset', async () => {
    const audio = await samplesSentToWhisper(
      wav({ sampleRate: 16000, bits: 16, frames: frames(40, 0.5), dataSize: 0xffffffff }),
    );
    expect(audio.length).toBe(40);
  });

  it('refuses an encoding it cannot read instead of handing Whisper noise', () => {
    const adpcm = wav({ sampleRate: 16000, bits: 16, frames: frames(8, 0.5) });
    adpcm.writeUInt16LE(2, 20); // fmt's format tag -> MS ADPCM
    expect(() => decodeWav(adpcm)).toThrow(/Unsupported WAV encoding \(format 2, 16-bit\)/);
    expect(() => decodeWav(Buffer.from('not a wav file at all'))).toThrow(/Not a WAV file/);
  });

  it('survives a corrupt chunk size instead of reading past the buffer', () => {
    const broken = wav({ sampleRate: 16000, bits: 16, frames: frames(8, 0.5), before: [['JUNK', Buffer.alloc(4)]] });
    broken.writeUInt32LE(0x7fffffff, 16); // JUNK claims 2 GB
    expect(() => decodeWav(broken)).toThrow(/Malformed WAV/);
  });
});

/**
 * The library defaults this code still depends on. Neither is where the server
 * keeps weights any more, but each matters: the server default is where an
 * existing install's model is MOVED FROM (a library that changed it would
 * strand ~950 MB and download it again), and the renderer's Cache API key is
 * where voice input's ~80 MB lives — in the Electron profile, not the app
 * bundle, so an update never touched it and it is deliberately left alone.
 * 3.8.1 and 4.3.0 agree on both; this pins them so the next major is a decision.
 */
describe('transformers.js defaults this depends on (real library, not the mock)', () => {
  it('server side: the default is <package>/.cache/ — the migration source', () => {
    // realpath: Node resolves ESM through symlinks, and worktrees symlink node_modules.
    const pkgDir = fs.realpathSync(path.join(__dirname, '..', '..', '..', 'node_modules', '@huggingface', 'transformers'));
    expect(path.resolve(realEnv.cacheDir ?? '')).toBe(path.join(pkgDir, '.cache'));
  });

  it('server side: the filesystem cache is on, and the browser one is not', async () => {
    const { env } = await vi.importActual<typeof import('@huggingface/transformers')>('@huggingface/transformers');
    expect(env.useFSCache).toBe(true);
    expect(env.useBrowserCache).toBe(false);
  });

  it("renderer: the Cache API store voice input has always used ('transformers-cache')", async () => {
    const { env } = await vi.importActual<typeof import('@huggingface/transformers')>('@huggingface/transformers');
    expect(env.cacheKey).toBe('transformers-cache');
  });

  it('renderer: voice input leaves the cache settings alone', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'voice', 'voice-session.ts'), 'utf-8');
    expect(source).not.toMatch(/\benv\s*\.\s*(cacheDir|cacheKey|useBrowserCache|useFSCache)\b/);
  });
});
