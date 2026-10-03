/**
 * Spoken-language detection for Whisper — the step transformers.js skips.
 *
 * A multilingual Whisper decoder is prompted `<|startoftranscript|> <|xx|>
 * <|transcribe|>`, and `xx` decides what comes out. transformers.js 4.x fills
 * that slot with English whenever no `language` is passed ("TODO: Implement
 * language detection" in `WhisperForConditionalGeneration._retrieve_init_tokens`).
 * English is not a neutral default: told the speech is English, Whisper
 * TRANSLATES. Measured on the server extractor with macOS `say`:
 *
 *   French "Aujourd'hui, il fait beau. Nous allons au parc…"
 *     → "Today, it's beautiful. We're going to the park to picnic with our friends."
 *
 * — a fluent English paraphrase, indistinguishable from a correct transcript
 * unless you already know what was said.
 *
 * Detection is what OpenAI's and Hugging Face's Python implementations do: one
 * decoder step from `<|startoftranscript|>` alone, and the most likely language
 * token wins. Here that is a single forward pass of the model the pipeline has
 * already loaded, on the first 30 s window (Whisper's own detection window).
 *
 * Shared by the server extractor (`lib/extractors/audio.ts`) and renderer voice
 * input (`lib/voice/voice-session.ts`), so it must stay free of Node APIs.
 */
import type { Tensor } from '@huggingface/transformers';

/** Whisper's one input format is 16 kHz; it reads 30 s at a time. */
const DETECTION_WINDOW_SAMPLES = 30 * 16000;

/**
 * What detection needs from a loaded ASR pipeline. Callers ASSIGN the real
 * pipeline to a type including this (never cast), so a transformers.js upgrade
 * that moves any of it fails `tsc` rather than silently disabling detection.
 */
export interface WhisperInternals {
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
  model: ((inputs: { input_features: unknown; decoder_input_ids: Tensor }) => Promise<{ logits: Tensor }>) & {
    generation_config: {
      decoder_start_token_id?: number | null;
      is_multilingual?: boolean | null;
      lang_to_id?: Record<string, number> | null;
    } | null;
  };
}

/**
 * The language spoken in `audio` (16 kHz mono) as a Whisper code (`'fr'`), or
 * null when it cannot be told: an English-only model, a pipeline without the
 * internals above (test fakes), or any failure. Null means "let the library
 * decide", which is English — the old behaviour, never a broken transcription.
 */
export async function detectSpokenLanguage(
  pipe: Partial<WhisperInternals>,
  audio: Float32Array,
): Promise<string | null> {
  const config = pipe.model?.generation_config;
  const langToId = config?.lang_to_id;
  const start = config?.decoder_start_token_id;
  if (!pipe.model || !pipe.processor || !config?.is_multilingual || !langToId || start == null) return null;

  try {
    const { Tensor } = await import('@huggingface/transformers');
    const { input_features } = await pipe.processor(audio.subarray(0, DETECTION_WINDOW_SAMPLES));
    const { logits } = await pipe.model({
      input_features,
      decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(start)]), [1, 1]),
    });

    // logits: [batch=1, positions=1, vocab]. The one position is the next token.
    const vocab = logits.dims[logits.dims.length - 1];
    const scores = logits.data as ArrayLike<number>;
    const offset = scores.length - vocab;
    let best: string | null = null;
    let bestScore = -Infinity;
    for (const [token, id] of Object.entries(langToId)) {
      const score = scores[offset + id];
      if (score > bestScore) {
        bestScore = score;
        best = token;
      }
    }
    // Tokens look like `<|fr|>` (and one `<|haw|>`); the pipeline takes the bare code.
    return best?.match(/^<\|([a-z]+)\|>$/)?.[1] ?? null;
  } catch (err) {
    console.warn('[Whisper] Language detection failed; transcribing without a language hint:', err);
    return null;
  }
}
