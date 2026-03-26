/**
 * Video transcription: extract audio track via ffmpeg, then pass to Whisper.
 */
import type { ExtractionResult } from './types';
import { extractAudio } from './audio';

export async function extractVideo(buffer: Buffer, name: string): Promise<ExtractionResult> {
  try {
    const { execFileSync } = await import('child_process');
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');

    const ext = name.split('.').pop()?.toLowerCase() || 'mp4';
    const tmpInput = path.join(os.tmpdir(), `video_input_${Date.now()}.${ext}`);
    const tmpOutput = path.join(os.tmpdir(), `video_audio_${Date.now()}.wav`);

    fs.writeFileSync(tmpInput, buffer);
    try {
      execFileSync('ffmpeg', [
        '-i', tmpInput,
        '-vn',              // no video
        '-ar', '16000',     // 16kHz sample rate for Whisper
        '-ac', '1',         // mono
        '-f', 'wav',
        '-y', tmpOutput,
      ], { timeout: 300000 }); // 5 min timeout for large videos

      const wavBuffer = fs.readFileSync(tmpOutput);
      const result = await extractAudio(Buffer.from(wavBuffer), 'extracted.wav');
      return {
        ...result,
        metadata: { ...result.metadata, type: 'video', originalFormat: ext },
      };
    } finally {
      try { fs.unlinkSync(tmpInput); } catch { /* ignore */ }
      try { fs.unlinkSync(tmpOutput); } catch { /* ignore */ }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      return {
        text: '[Video transcription requires ffmpeg. Install it with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)]',
        metadata: { type: 'video', error: 'ffmpeg not installed' },
      };
    }
    return {
      text: `[Video transcription failed: ${msg}]`,
      metadata: { type: 'video', error: msg },
    };
  }
}
