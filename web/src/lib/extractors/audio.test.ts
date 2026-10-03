import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { extractAudio, WHISPER_MODEL } from './audio';

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
