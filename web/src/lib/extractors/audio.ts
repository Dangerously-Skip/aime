/**
 * Audio transcription using @huggingface/transformers Whisper pipeline
 * (onnxruntime-node, server side).
 *
 * The loaded pipeline is kept on globalThis so it survives dev-server module
 * reloads. The weights are cached on disk in the app data dir
 * (`getModelCacheDir`, ~/.aime/models/transformers) — not the library's
 * default, `.cache/` inside the installed package, which an app update or an
 * `npm ci` deletes. A cache already there is moved, not re-downloaded (see
 * `model-cache-migration.ts`).
 *
 * The spoken language is detected per file (`lib/whisper/detect-language.ts`);
 * left to transformers.js, every file is assumed English and anything else
 * comes back TRANSLATED into English.
 */
import * as path from 'path';
import { getModelCacheDir } from '@/lib/app-paths';
import { detectSpokenLanguage, type WhisperInternals } from '@/lib/whisper/detect-language';
import { moveModelCache } from './model-cache-migration';
import type { ExtractionResult } from './types';

/**
 * The slice of the ASR pipeline used here. The real pipeline is ASSIGNED to it
 * (not cast), so an upgrade that changes the call shape fails `tsc`.
 */
type Transcriber = ((
  audio: Float32Array,
  options?: {
    chunk_length_s?: number;
    stride_length_s?: number;
    return_timestamps?: boolean;
    language?: string;
    task?: 'transcribe';
  },
) => Promise<{ text: string }>) &
  WhisperInternals;

interface LoadStarted {
  /** Where the weights are (or are going). */
  dir: string;
  /** Whether this load has to download them first. */
  downloading: boolean;
  /** The one model load in flight — from disk, or a first-use download. */
  loading: Promise<Transcriber>;
}

interface WhisperState {
  transcriber?: Transcriber;
  /** Cache settled and load started; shared, so concurrent requests start ONE load. */
  started?: Promise<LoadStarted>;
  /** Present while the weights are downloading; percent done once known. */
  download?: { progress: number | null };
  /** Why the last background download failed, until the next request reports it. */
  downloadError?: string;
}

declare global {
  var __whisper: WhisperState | undefined;
}

export const WHISPER_MODEL = 'Xenova/whisper-small';
const WHISPER_DTYPE = 'fp32';
/** What the user is told to expect: the fp32 encoder + merged decoder + configs. */
const WHISPER_DOWNLOAD_SIZE = '~950 MB';

function whisperState(): WhisperState {
  return (globalThis.__whisper ??= {});
}

/**
 * Point transformers.js at the app data dir, first moving a model that the
 * library's default location already holds. Runs before the first load.
 */
async function adoptAppModelCache(): Promise<string> {
  const { env } = await import('@huggingface/transformers');
  const dir = getModelCacheDir();
  const legacy = env.cacheDir; // <package>/.cache/ until we change it
  if (legacy && path.resolve(legacy) !== path.resolve(dir)) {
    await moveModelCache({ from: path.join(legacy, WHISPER_MODEL), to: path.join(dir, WHISPER_MODEL) });
  }
  env.cacheDir = dir;
  return dir;
}

async function startLoad(state: WhisperState): Promise<LoadStarted> {
  const dir = await adoptAppModelCache();
  const { pipeline, ModelRegistry } = await import('@huggingface/transformers');
  const cached = await ModelRegistry.is_pipeline_cached('automatic-speech-recognition', WHISPER_MODEL, {
    dtype: WHISPER_DTYPE,
  }).catch(() => false);

  if (!cached) {
    state.download = { progress: null };
    console.log(`[Whisper] Downloading ${WHISPER_MODEL} (${WHISPER_DOWNLOAD_SIZE}, first use only) to ${dir}`);
  }
  let reported = 0;
  const load = async (): Promise<Transcriber> => {
    const transcriber: Transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      dtype: WHISPER_DTYPE,
      progress_callback: (info) => {
        if (info.status !== 'progress_total' || !state.download) return;
        state.download.progress = Math.floor(info.progress);
        if (info.progress >= reported + 10) {
          reported = Math.floor(info.progress / 10) * 10;
          console.log(`[Whisper] Downloading ${WHISPER_MODEL}: ${reported}%`);
        }
      },
    });
    return transcriber;
  };
  const loading = load().then(
    (transcriber) => {
      if (state.download) console.log(`[Whisper] ${WHISPER_MODEL} downloaded to ${dir}`);
      state.transcriber = transcriber;
      state.download = undefined;
      return transcriber;
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (state.download) {
        console.warn(`[Whisper] Download of ${WHISPER_MODEL} failed: ${msg}`);
        state.downloadError = msg;
      }
      state.download = undefined;
      state.started = undefined; // the next request tries again
      throw err;
    },
  );
  // A download nobody awaits must not surface as an unhandled rejection; its
  // failure reaches the next request through `downloadError`.
  loading.catch(() => {});
  return { dir, downloading: !cached, loading };
}

/**
 * The loaded transcriber — or, while the model downloads, what to say instead.
 * The download is ~950 MB and the chat route gives extraction 30 seconds, so
 * waiting would only end in "timed out" with the download running unseen.
 *
 * How big the model is and where it goes is said ONCE, by the request that
 * started the download; requests during it only say it is still going.
 */
async function whisperOrNotice(): Promise<Transcriber | ExtractionResult> {
  const state = whisperState();
  if (state.transcriber) return state.transcriber;

  const first = !state.started;
  const previousFailure = first ? state.downloadError : undefined;
  if (!state.started) {
    state.downloadError = undefined;
    state.started = startLoad(state).catch((err: unknown) => {
      state.started = undefined;
      throw err;
    });
  }
  const { dir, downloading, loading } = await state.started;

  if (state.download) {
    const retry = previousFailure ? `The last download failed (${previousFailure}); trying again. ` : '';
    const progress = state.download.progress === null ? '' : ` (${state.download.progress}% done)`;
    const text =
      first && downloading
        ? `[Not transcribed yet: ${retry}the speech-recognition model (Whisper, ${WHISPER_DOWNLOAD_SIZE}) is downloading — once, on first use — to ${dir}. Attach the file again when it finishes.]`
        : `[Not transcribed yet: the speech-recognition model is still downloading${progress}. Attach the file again when it finishes.]`;
    return { text, metadata: { type: 'audio', error: 'model-downloading' } };
  }
  return state.transcriber ?? (await loading);
}

export async function extractAudio(buffer: Buffer, name: string): Promise<ExtractionResult> {
  try {
    const transcriber = await whisperOrNotice();
    if (typeof transcriber !== 'function') return transcriber;

    // Convert buffer to Float32Array (WAV PCM expected by Whisper)
    // For non-WAV formats, we need to decode the audio first
    const audioData = await decodeAudioBuffer(buffer, name);

    const language = await detectSpokenLanguage(transcriber, audioData);
    const result = await transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      // Without a language transformers.js assumes English — and translates.
      ...(language ? { language, task: 'transcribe' as const } : {}),
    });

    return {
      text: result.text.trim(),
      metadata: { type: 'audio', format: name.split('.').pop(), ...(language ? { language } : {}) },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[Audio transcription failed: ${msg}]`,
      metadata: { type: 'audio', error: msg },
    };
  }
}

/**
 * Decode audio buffer to Float32Array PCM.
 * WAV is parsed here; anything else, or a WAV encoding the parser does not
 * read (ADPCM, µ-law…), goes through ffmpeg.
 */
async function decodeAudioBuffer(buffer: Buffer, name: string): Promise<Float32Array> {
  const ext = name.split('.').pop()?.toLowerCase();

  let wavError: Error | null = null;
  if (ext === 'wav') {
    try {
      return decodeWav(buffer);
    } catch (err) {
      // Not fatal yet: ffmpeg reads the encodings we do not, and a file named
      // .wav is not always one.
      wavError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // For MP3/M4A/OGG/WebM — try to use ffmpeg to convert to WAV first
  try {
    const { execFileSync } = await import('child_process');
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');

    // A private directory per call: concurrent uploads cannot collide, and the
    // extension (from a user-supplied filename) is reduced to something that
    // cannot carry a path. ffmpeg probes the content; the suffix is only a hint.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-audio-'));
    const safeExt = ext && /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
    const tmpInput = path.join(dir, `input.${safeExt}`);
    const tmpOutput = path.join(dir, 'output.wav');

    try {
      fs.writeFileSync(tmpInput, buffer);
      execFileSync('ffmpeg', [
        '-loglevel', 'error',
        '-i', tmpInput,
        '-ar', String(WHISPER_SAMPLE_RATE),
        '-ac', '1',
        '-f', 'wav',
        '-y', tmpOutput,
      ], { timeout: 60000, stdio: 'pipe' });

      return decodeWav(fs.readFileSync(tmpOutput));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    if (wavError) throw new Error(`${wavError.message}, and ffmpeg could not convert it (is ffmpeg installed?)`);
    throw new Error(`Cannot decode ${ext} audio. Install ffmpeg for non-WAV format support.`);
  }
}

/** Whisper's one input format: 16 kHz, mono, float samples in -1..1. */
const WHISPER_SAMPLE_RATE = 16000;

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/**
 * Parse a WAV file into what Whisper expects: 16 kHz mono Float32.
 *
 * Walks the RIFF chunks rather than assuming the canonical 44-byte header —
 * recorders routinely put JUNK/LIST/bext chunks before `fmt ` or `data` — then
 * downmixes and resamples. Whisper does neither for us: given 44.1 kHz samples
 * it hears speech 2.76x too slow, and transcribes nonsense with confidence.
 */
export function decodeWav(buffer: Buffer): Float32Array {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataStart = -1;
  let dataEnd = -1;

  for (let offset = 12; offset + 8 <= buffer.length; ) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= buffer.length) {
      format = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bits = buffer.readUInt16LE(body + 14);
      // The real format tag is the first two bytes of the sub-format GUID.
      if (format === WAVE_FORMAT_EXTENSIBLE && size >= 40 && body + 26 <= buffer.length) {
        format = buffer.readUInt16LE(body + 24);
      }
    } else if (id === 'data') {
      dataStart = body;
      // A streaming writer that never came back to patch the header leaves 0
      // or 0xFFFFFFFF here; either way the samples run to the end of the file.
      dataEnd = size === 0 || body + size > buffer.length ? buffer.length : body + size;
      break;
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }

  if (!channels || !sampleRate || dataStart < 0) throw new Error('Malformed WAV file: no fmt or data chunk');

  const read = sampleReader(buffer, format, bits);
  if (!read) throw new Error(`Unsupported WAV encoding (format ${format}, ${bits}-bit)`);

  const bytesPerFrame = (bits / 8) * channels;
  const frameCount = Math.floor((dataEnd - dataStart) / bytesPerFrame);
  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    const base = dataStart + frame * bytesPerFrame;
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) sum += read(base + ch * (bits / 8));
    mono[frame] = sum / channels;
  }

  return resample(mono, sampleRate, WHISPER_SAMPLE_RATE);
}

function sampleReader(buffer: Buffer, format: number, bits: number): ((offset: number) => number) | null {
  if (format === WAVE_FORMAT_IEEE_FLOAT && bits === 32) return (o) => buffer.readFloatLE(o);
  if (format === WAVE_FORMAT_IEEE_FLOAT && bits === 64) return (o) => buffer.readDoubleLE(o);
  if (format !== WAVE_FORMAT_PCM) return null;
  switch (bits) {
    case 8: return (o) => (buffer[o] - 128) / 128; // 8-bit WAV is unsigned
    case 16: return (o) => buffer.readInt16LE(o) / 0x8000;
    case 24: return (o) => buffer.readIntLE(o, 3) / 0x800000;
    case 32: return (o) => buffer.readInt32LE(o) / 0x80000000;
    default: return null;
  }
}

/**
 * Change sample rate. Downsampling averages each output sample's window of
 * input (a box filter: crude, but enough to keep content above the new Nyquist
 * from folding back as audible noise); upsampling interpolates linearly.
 */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input;
  const ratio = from / to;
  const output = new Float32Array(Math.round(input.length / ratio));

  if (ratio > 1) {
    for (let i = 0; i < output.length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j];
      output[i] = sum / (end - start);
    }
  } else {
    for (let i = 0; i < output.length; i++) {
      const pos = i * ratio;
      const j = Math.floor(pos);
      const next = Math.min(j + 1, input.length - 1);
      output[i] = input[j] + (input[next] - input[j]) * (pos - j);
    }
  }
  return output;
}
