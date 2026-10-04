import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decodeWav, extractAudio } from './audio';
import { detectSpokenLanguage } from '@/lib/whisper/detect-language';

/**
 * The REAL Whisper models, on real speech in three languages. Opt-in, because
 * it downloads ~1 GB on first run and needs macOS `say` to produce the speech:
 *
 *   AIME_REAL_WHISPER=1 npx vitest run src/lib/extractors/audio.real-model.test.ts
 *
 * Weights go to AIME_REAL_WHISPER_CACHE (default: <tmpdir>/aime-real-whisper),
 * which is kept between runs; delete it when done.
 *
 * What it proves that the unit tests cannot: that the decoder really scores
 * language tokens the way detection assumes, for both models the app ships
 * (server: whisper-small fp32; voice input: whisper-base q8). Before detection,
 * the French clip came back as "Today, it's beautiful. We're going to the park
 * to picnic with our friends." — translated, not transcribed.
 */

const ENABLED = process.env.AIME_REAL_WHISPER === '1' && process.platform === 'darwin';
const cacheDir = process.env.AIME_REAL_WHISPER_CACHE || path.join(os.tmpdir(), 'aime-real-whisper');

vi.mock('@/lib/app-paths', () => ({
  getModelCacheDir: () => process.env.AIME_REAL_WHISPER_CACHE || path.join(os.tmpdir(), 'aime-real-whisper'),
}));

const SPEECH = {
  en: { voice: 'Samantha', text: 'The weather today is sunny, and we are going to the park to have a picnic with our friends.', expect: /picnic/i },
  fr: { voice: 'Thomas', text: "Aujourd'hui, il fait beau. Nous allons au parc pour pique-niquer avec nos amis.", expect: /parc.*amis/i },
  de: { voice: 'Anna', text: 'Heute ist das Wetter schön, und wir gehen mit unseren Freunden in den Park zum Picknick.', expect: /Wetter.*Freunden/i },
} as const;

let workDir: string;
const wavs: Partial<Record<keyof typeof SPEECH, Buffer>> = {};

describe.skipIf(!ENABLED)('real Whisper, real speech', () => {
  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-real-speech-'));
    for (const [lang, { voice, text }] of Object.entries(SPEECH) as Array<[keyof typeof SPEECH, (typeof SPEECH)['en']]>) {
      const aiff = path.join(workDir, `${lang}.aiff`);
      const wav = path.join(workDir, `${lang}.wav`);
      execFileSync('say', ['-v', voice, '-o', aiff, text]);
      execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', aiff, wav]);
      wavs[lang] = fs.readFileSync(wav);
    }
  });

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('server extractor (whisper-small): each language transcribed in that language', async () => {
    let first = await extractAudio(wavs.en!, 'en.wav');
    if (first.metadata?.error === 'model-downloading') {
      // First run: the download notice, then the download itself.
      expect(first.text).toContain(cacheDir);
      await (await globalThis.__whisper!.started)!.loading;
      first = await extractAudio(wavs.en!, 'en.wav');
    }
    expect(first.metadata?.language).toBe('en');
    expect(first.text).toMatch(SPEECH.en.expect);

    for (const lang of ['fr', 'de'] as const) {
      const result = await extractAudio(wavs[lang]!, `${lang}.wav`);
      expect(result.metadata?.language).toBe(lang);
      expect(result.text).toMatch(SPEECH[lang].expect);
    }
  }, 1_800_000);

  it('voice input model (whisper-base q8): detection picks the right language', async () => {
    const { env, pipeline } = await vi.importActual<typeof import('@huggingface/transformers')>('@huggingface/transformers');
    env.cacheDir = cacheDir;
    const pipe = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', { dtype: 'q8' });
    for (const lang of ['en', 'fr', 'de'] as const) {
      const audio = decodeWav(wavs[lang]!);
      expect(await detectSpokenLanguage(pipe, audio)).toBe(lang);
    }
    const fr = await pipe(decodeWav(wavs.fr!), { language: 'fr', task: 'transcribe' });
    expect(fr.text).toMatch(/parc/i);
  }, 1_800_000);
});
