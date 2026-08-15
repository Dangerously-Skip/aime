/**
 * The image models we are willing to put in front of a user.
 *
 * WHY A CURATED LIST rather than "everything OpenRouter reports". The catalog is
 * long, it churns, and a meaningful share of its image entries are deprecated,
 * region-locked, or answer 200 with no image at all — `generate.ts` already
 * carries defensive code for two different response shapes because of it.
 * Offering the raw list makes the user the one who discovers which entries are
 * broken, one failed deck at a time.
 *
 * WHY IT IS NOT A HARDCODED DEFAULT. `DEFAULT_IMAGE_MODEL` used to be a constant
 * the call site could not override, so every image AIME has ever generated used
 * one model and Settings had no say. That is the same defect
 * `single-setup-point.test.ts` was written to stop for chat models — surfaces
 * shipped PINNED, so the user's configuration never got a look in. This list is
 * the menu; the user's pick lives in settings; the constant below is only what
 * we fall back to before they have picked.
 *
 * KEEPING IT HONEST. A list of ids asserted to work is a claim, and claims rot.
 * `catalog.test.ts` checks shape and self-consistency offline; `npm run
 * verify:image-models` (see scripts/) probes each id against the live API and is
 * how the list gets refreshed. Do not add an entry you have not run.
 */

export type ImageModelKind = 'fast' | 'quality' | 'edit';

export interface ImageModelOption {
  /** OpenRouter model id, exactly as the API expects it. */
  id: string;
  label: string;
  /** One line the user can choose on — not marketing. */
  note: string;
  kind: ImageModelKind;
  /** Rough US cents per image, for ordering and for showing cost honestly. */
  centsPerImage: number;
}

export const IMAGE_MODELS: readonly ImageModelOption[] = [
  {
    id: 'google/gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image',
    note: 'Fast and cheap. Good enough for slide furniture; weak on text in images.',
    kind: 'fast',
    centsPerImage: 4,
  },
  {
    id: 'google/gemini-3-pro-image-preview',
    label: 'Gemini 3 Pro Image',
    note: 'Much stronger prompt adherence and legible text. Several times the cost.',
    kind: 'quality',
    centsPerImage: 24,
  },
  {
    id: 'openai/gpt-image-1',
    label: 'GPT Image 1',
    note: 'Best at following a long, specific brief. Slower.',
    kind: 'quality',
    centsPerImage: 19,
  },
  {
    id: 'openai/gpt-image-1-mini',
    label: 'GPT Image 1 Mini',
    note: 'The cheap end of the OpenAI family; fine for backgrounds and texture.',
    kind: 'fast',
    centsPerImage: 5,
  },
  {
    id: 'black-forest-labs/flux-1.1-pro',
    label: 'FLUX 1.1 Pro',
    note: 'Photographic and illustrative work. No text rendering to speak of.',
    kind: 'quality',
    centsPerImage: 4,
  },
  {
    id: 'black-forest-labs/flux-schnell',
    label: 'FLUX Schnell',
    note: 'The fastest here. Use when you want many drafts, not one keeper.',
    kind: 'fast',
    centsPerImage: 1,
  },
];

/**
 * Used only until the user chooses. Cheap on purpose: a 14-slide deck that
 * generates a picture per slide should cost cents rather than dollars.
 */
export const FALLBACK_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

export function findImageModel(id: string | null | undefined): ImageModelOption | null {
  if (!id) return null;
  return IMAGE_MODELS.find((m) => m.id === id) ?? null;
}

/**
 * Resolve what to actually call.
 *
 * An id we do not recognise is still HONOURED — the list is a menu, not a
 * whitelist, and a user who types a new OpenRouter id should not be silently
 * downgraded to the fallback. Refusing unknown ids here would make this a second
 * gate on model choice, which is the thing being removed.
 */
export function resolveImageModel(chosen: string | null | undefined): string {
  return chosen && chosen.trim() ? chosen.trim() : FALLBACK_IMAGE_MODEL;
}
