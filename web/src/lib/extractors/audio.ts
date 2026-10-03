/**
 * Audio transcription using @huggingface/transformers Whisper pipeline
 * (onnxruntime-node, server side).
 *
 * The loaded pipeline is kept on globalThis so it survives dev-server module
 * reloads. The weights themselves are cached on disk by transformers.js, in
 * `env.cacheDir` — `.cache/` inside the installed package, the same directory
 * in 3.x and 4.x (see audio.test.ts), so an upgrade does not re-download them.
 */
import type { ExtractionResult } from './types';

/**
 * The slice of the ASR pipeline used here. The real pipeline is ASSIGNED to it
 * (not cast), so an upgrade that changes the call shape fails `tsc`.
 */
type Transcriber = (
  audio: Float32Array,
  options?: { chunk_length_s?: number; stride_length_s?: number; return_timestamps?: boolean },
) => Promise<{ text: string }>;

declare global {
  var __whisperPipeline: Transcriber | undefined;
}

export const WHISPER_MODEL = 'Xenova/whisper-small';

async function getWhisperPipeline(): Promise<Transcriber> {
  if (globalThis.__whisperPipeline) return globalThis.__whisperPipeline;

  const { pipeline } = await import('@huggingface/transformers');
  const transcriber: Transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
    dtype: 'fp32',
  });
  globalThis.__whisperPipeline = transcriber;
  return transcriber;
}

export async function extractAudio(buffer: Buffer, name: string): Promise<ExtractionResult> {
  try {
    const transcriber = await getWhisperPipeline();

    // Convert buffer to Float32Array (WAV PCM expected by Whisper)
    // For non-WAV formats, we need to decode the audio first
    const audioData = await decodeAudioBuffer(buffer, name);

    const result = await transcriber(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });

    return {
      text: result.text.trim(),
      metadata: { type: 'audio', format: name.split('.').pop() },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[Audio transcription failed: ${msg}. The Whisper model downloads on first use (~950 MB), which needs a network connection.]`,
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
