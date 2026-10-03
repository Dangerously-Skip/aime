import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { decodeWav, extractAudio, WHISPER_MODEL } from './audio';

/**
 * Server-side Whisper transcription (attachments, and video via ffmpeg).
 *
 * Real: WAV parsing, the call into the pipeline, the error path — and, in the
 * cache block, the actual transformers.js `env`. Faked: the model itself. A
 * real Whisper run downloads ~950 MB on first use, so it is not a unit test;
 * the upgrade to transformers 4.x was smoke-tested against real speech (see the
 * commit message).
 */

const transcribe = vi.fn(async (_audio: Float32Array, _opts?: unknown) => ({ text: '  hello there  ' }));
const pipeline = vi.fn(async (..._args: unknown[]) => transcribe);
vi.mock('@huggingface/transformers', () => ({ pipeline: (...args: unknown[]) => pipeline(...args) }));

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

beforeEach(() => {
  globalThis.__whisperPipeline = undefined;
  pipeline.mockClear();
  transcribe.mockClear();
});

afterEach(() => {
  globalThis.__whisperPipeline = undefined;
});

describe('extractAudio', () => {
  it('transcribes a 16 kHz WAV: samples in, trimmed text out', async () => {
    const result = await extractAudio(pcm16Wav([0, 16384, -32768, 8192]), 'note.wav');

    expect(result).toEqual({ text: 'hello there', metadata: { type: 'audio', format: 'wav' } });
    expect(pipeline).toHaveBeenCalledWith('automatic-speech-recognition', WHISPER_MODEL, { dtype: 'fp32' });
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

  it('a failed model load comes back as text, not a thrown error, and is retried next time', async () => {
    pipeline.mockRejectedValueOnce(new Error('fetch failed'));
    const failed = await extractAudio(pcm16Wav([100]), 'a.wav');
    expect(failed.text).toMatch(/^\[Audio transcription failed: fetch failed\./);
    expect(failed.metadata).toEqual({ type: 'audio', error: 'fetch failed' });

    const retried = await extractAudio(pcm16Wav([100]), 'a.wav');
    expect(retried.text).toBe('hello there');
    expect(pipeline).toHaveBeenCalledTimes(2);
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
 * Where the weights live. Both are library defaults rather than settings of
 * ours, so an upgrade can move them silently — and a moved cache is a fresh
 * ~950 MB (server) / ~80 MB (voice input) download for every existing user, or
 * a dead feature for one who is offline. 3.8.1 and 4.3.0 agree on both values;
 * this pins them so the next major has to be a decision.
 */
describe('transformers.js model cache location (real library, not the mock)', () => {
  it('server side: <package>/.cache/, where 3.x put it', async () => {
    const { env } = await vi.importActual<typeof import('@huggingface/transformers')>('@huggingface/transformers');
    // realpath: Node resolves ESM through symlinks, and worktrees symlink node_modules.
    const pkgDir = fs.realpathSync(path.join(__dirname, '..', '..', '..', 'node_modules', '@huggingface', 'transformers'));
    expect(path.resolve(env.cacheDir ?? '')).toBe(path.join(pkgDir, '.cache'));
    expect(env.useFSCache).toBe(true);
  });

  it("renderer: the Cache API store voice input has always used ('transformers-cache')", async () => {
    const { env } = await vi.importActual<typeof import('@huggingface/transformers')>('@huggingface/transformers');
    expect(env.cacheKey).toBe('transformers-cache');
  });
});
