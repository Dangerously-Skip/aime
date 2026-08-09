import { themeArtDirection } from './art-direction';

/**
 * Generate an image through OpenRouter, for any surface that needs one.
 *
 * Decks were the prompt for this, but the need is general — a mockup, a landing
 * page and a document all want a real picture rather than a grey box, and all of
 * them currently get either nothing or an invented URL that renders broken.
 *
 * OpenRouter exposes image models through the ordinary chat-completions shape
 * with `modalities: ['image','text']`; the image comes back as a data URL on the
 * message. That is why this does not use an "images" endpoint — there isn't one.
 *
 * Bounded, like every other outbound call the agent can make: an image model can
 * take a while, but it must not be able to stall a turn (see `fetch-url.ts` for
 * the same reasoning and the incident behind it).
 */

/** Generous — image models are slower than text — but far under the tool deadline. */
export const IMAGE_TIMEOUT_MS = 90_000;

/**
 * Cheap, fast, and good enough for slide furniture. Callers may override; this
 * is the default because a 14-slide deck generating a picture per slide should
 * cost cents rather than dollars.
 */
export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

export type ImageFailure = 'not-configured' | 'timeout' | 'upstream' | 'no-image' | 'refused';

export type ImageResult =
  | { ok: true; base64: string; mimeType: string; model: string }
  | { ok: false; kind: ImageFailure; message: string };

export interface GenerateOptions {
  prompt: string;
  apiKey: string | null;
  /** Applied as art direction so the image matches the deck it lands in. */
  themeId?: string | null;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** `data:image/png;base64,AAA` → its parts. */
function parseDataUrl(url: string): { mimeType: string; base64: string } | null {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(url);
  return m ? { mimeType: m[1], base64: m[2] } : null;
}

/**
 * Find the image in a completion response.
 *
 * Written defensively across two shapes because they are both in the wild and
 * the difference is not something we control: some models return
 * `message.images[]`, others put an `image_url` part in `message.content[]`.
 * Handling only the documented one produces "no image was returned" against a
 * model that returned one.
 */
export function extractImage(payload: unknown): { mimeType: string; base64: string } | null {
  const msg = (payload as { choices?: Array<{ message?: Record<string, unknown> }> })?.choices?.[0]
    ?.message;
  if (!msg) return null;

  const images = msg.images as Array<{ image_url?: { url?: string }; url?: string }> | undefined;
  for (const img of images ?? []) {
    const url = img?.image_url?.url ?? img?.url;
    const parsed = url ? parseDataUrl(url) : null;
    if (parsed) return parsed;
  }

  const content = msg.content;
  if (Array.isArray(content)) {
    for (const part of content as Array<{ type?: string; image_url?: { url?: string } }>) {
      const url = part?.image_url?.url;
      const parsed = url ? parseDataUrl(url) : null;
      if (parsed) return parsed;
    }
  }
  return null;
}

export async function generateImage(opts: GenerateOptions): Promise<ImageResult> {
  if (!opts.apiKey) {
    return {
      ok: false,
      kind: 'not-configured',
      message: 'No OpenRouter credential is available to generate images.',
    };
  }

  const direction = themeArtDirection(opts.themeId);
  const prompt = direction ? `${opts.prompt}\n\n${direction.instruction}` : opts.prompt;
  const model = opts.model ?? DEFAULT_IMAGE_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(opts.timeoutMs ?? IMAGE_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      return {
        ok: false,
        kind: 'timeout',
        message: `No image within ${Math.round((opts.timeoutMs ?? IMAGE_TIMEOUT_MS) / 1000)}s.`,
      };
    }
    return { ok: false, kind: 'upstream', message: e instanceof Error ? e.message : 'Request failed' };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return {
      ok: false,
      // A refusal is not a fault to retry — the model declined the subject, and
      // rewording is the only thing that helps.
      kind: res.status === 400 && /safety|policy|refus/i.test(detail) ? 'refused' : 'upstream',
      message: `HTTP ${res.status}: ${detail.slice(0, 300)}`,
    };
  }

  const payload: unknown = await res.json().catch(() => null);
  const image = extractImage(payload);
  if (!image) {
    return {
      ok: false,
      kind: 'no-image',
      message: `${model} returned no image. It may not be an image-capable model.`,
    };
  }

  return { ok: true, base64: image.base64, mimeType: image.mimeType, model };
}

/**
 * What the agent is told when an image cannot be made.
 *
 * Always ends at the placeholder. A slide with a labelled gap keeps its
 * composition and tells the user what to drop in; a slide with a broken `<img>`
 * looks like a bug, and a slide with the visual silently removed looks like the
 * design was always that empty.
 */
export function describeImageFailure(kind: ImageFailure, message: string): string {
  const advice: Record<ImageFailure, string> = {
    'not-configured': 'Image generation is not set up.',
    timeout: 'The image model did not respond in time.',
    upstream: 'The image model failed.',
    'no-image': 'The model returned no image.',
    refused: 'The model declined this subject — try describing it differently, once.',
  };
  return `${advice[kind]} (${message}) Do not retry more than once, and do not invent an image URL — use the .img-placeholder markup instead so the slide keeps its layout.`;
}
