import { describe, it, expect, vi } from 'vitest';
import { Tensor } from '@huggingface/transformers';
import { detectSpokenLanguage, type WhisperInternals } from './detect-language';

/**
 * Language detection, against a fake model with the real library's Tensor.
 *
 * What is faked is only the network's output: the logits. Everything detection
 * itself decides — which token prompts the decoder, which slice of audio it
 * sees, which scores it compares, and how a token becomes a language code — is
 * real. Against the real Whisper weights it is exercised (opt-in) by
 * `extractors/audio.real-model.test.ts`: French speech in, 'fr' out.
 */

const VOCAB = 60;
const SOT = 50; // <|startoftranscript|>
const LANG_TO_ID = { '<|en|>': 51, '<|fr|>': 52, '<|de|>': 53, '<|haw|>': 54 };

/** A fake multilingual Whisper whose next-token scores are `scores` (token id → logit). */
function fakeWhisper(scores: Record<number, number>, config: Partial<NonNullable<WhisperInternals['model']['generation_config']>> = {}) {
  const logits = new Float32Array(VOCAB).fill(-5);
  // The highest score overall is a TEXT token: detection must only compare language tokens.
  logits[7] = 100;
  for (const [id, score] of Object.entries(scores)) logits[Number(id)] = score;

  const processor = vi.fn(async (audio: Float32Array) => ({ input_features: { samples: audio.length } }));
  const model = Object.assign(
    vi.fn(async (_inputs: { input_features: unknown; decoder_input_ids: Tensor }) => ({
      logits: new Tensor('float32', logits, [1, 1, VOCAB]),
    })),
    {
      generation_config: {
        decoder_start_token_id: SOT,
        is_multilingual: true,
        lang_to_id: LANG_TO_ID,
        ...config,
      },
    },
  );
  return { processor, model };
}

describe('detectSpokenLanguage', () => {
  it('returns the language token with the highest score, as a bare code', async () => {
    const pipe = fakeWhisper({ 51: 1.5, 52: 9.25, 53: 3 });
    expect(await detectSpokenLanguage(pipe, new Float32Array(16000))).toBe('fr');
  });

  it("handles the one three-letter token (Hawaiian, '<|haw|>')", async () => {
    expect(await detectSpokenLanguage(fakeWhisper({ 54: 20 }), new Float32Array(16000))).toBe('haw');
  });

  it('prompts the decoder with <|startoftranscript|> alone — one int64 token, nothing else', async () => {
    const pipe = fakeWhisper({ 53: 4 });
    await detectSpokenLanguage(pipe, new Float32Array(16000));

    const { decoder_input_ids, input_features } = pipe.model.mock.calls[0][0];
    expect(decoder_input_ids.type).toBe('int64');
    expect(decoder_input_ids.dims).toEqual([1, 1]);
    expect(Array.from(decoder_input_ids.data as BigInt64Array)).toEqual([BigInt(SOT)]);
    expect(input_features).toEqual({ samples: 16000 });
  });

  it('listens to the first 30 seconds only, as Whisper itself does', async () => {
    const pipe = fakeWhisper({ 51: 4 });
    await detectSpokenLanguage(pipe, new Float32Array(16000 * 95));
    expect(pipe.processor.mock.calls[0][0].length).toBe(16000 * 30);
  });

  it('reads the LAST position when the model returns more than one', async () => {
    const pipe = fakeWhisper({});
    const twoPositions = new Float32Array(2 * VOCAB).fill(-5);
    twoPositions[51] = 50; // first position says English…
    twoPositions[VOCAB + 53] = 50; // …the next-token position says German
    pipe.model.mockResolvedValueOnce({ logits: new Tensor('float32', twoPositions, [1, 2, VOCAB]) });
    expect(await detectSpokenLanguage(pipe, new Float32Array(16000))).toBe('de');
  });

  it('declines an English-only model without running it (it has no language slot)', async () => {
    const pipe = fakeWhisper({ 52: 9 }, { is_multilingual: false });
    expect(await detectSpokenLanguage(pipe, new Float32Array(16000))).toBeNull();
    expect(pipe.model).not.toHaveBeenCalled();
  });

  it('declines a pipeline without model internals (a plain function, as in other tests)', async () => {
    const plain = Object.assign(async () => ({ text: '' }), { model: undefined, processor: undefined });
    expect(await detectSpokenLanguage(plain, new Float32Array(16000))).toBeNull();
  });

  it('a model that throws means "no hint", never a failed transcription', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pipe = fakeWhisper({ 52: 9 });
    pipe.model.mockRejectedValueOnce(new Error('session exploded'));
    expect(await detectSpokenLanguage(pipe, new Float32Array(16000))).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Language detection failed'), expect.any(Error));
    warn.mockRestore();
  });
});
