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
 * For WAV files, parse directly. For other formats, attempt raw decode.
 */
async function decodeAudioBuffer(buffer: Buffer, name: string): Promise<Float32Array> {
  const ext = name.split('.').pop()?.toLowerCase();

  if (ext === 'wav') {
    return decodeWav(buffer);
  }

  // For MP3/M4A/OGG/WebM — try to use ffmpeg to convert to WAV first
  try {
    const { execFileSync } = await import('child_process');
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');

    const tmpInput = path.join(os.tmpdir(), `audio_input_${Date.now()}.${ext}`);
    const tmpOutput = path.join(os.tmpdir(), `audio_output_${Date.now()}.wav`);

    fs.writeFileSync(tmpInput, buffer);
    try {
      execFileSync('ffmpeg', [
        '-i', tmpInput,
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        '-y', tmpOutput,
      ], { timeout: 60000 });

      const wavBuffer = fs.readFileSync(tmpOutput);
      return decodeWav(Buffer.from(wavBuffer));
    } finally {
      try { fs.unlinkSync(tmpInput); } catch { /* ignore */ }
      try { fs.unlinkSync(tmpOutput); } catch { /* ignore */ }
    }
  } catch {
    throw new Error(`Cannot decode ${ext} audio. Install ffmpeg for non-WAV format support.`);
  }
}

/** Parse WAV file to Float32Array of PCM samples at 16kHz mono. */
function decodeWav(buffer: Buffer): Float32Array {
  // WAV header: first 44 bytes
  const dataOffset = buffer.indexOf('data') + 8;
  const bitsPerSample = buffer.readUInt16LE(34);
  const numChannels = buffer.readUInt16LE(22);

  const samples: number[] = [];
  const bytesPerSample = bitsPerSample / 8;

  for (let i = dataOffset; i < buffer.length; i += bytesPerSample * numChannels) {
    let sample: number;
    if (bitsPerSample === 16) {
      sample = buffer.readInt16LE(i) / 32768;
    } else if (bitsPerSample === 32) {
      sample = buffer.readFloatLE(i);
    } else {
      sample = (buffer[i] - 128) / 128;
    }
    samples.push(sample);
  }

  return new Float32Array(samples);
}
