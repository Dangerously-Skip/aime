import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  IMAGE_MODELS,
  FALLBACK_IMAGE_MODEL,
  findImageModel,
  resolveImageModel,
} from './catalog';

describe('the image catalog', () => {
  it('has entries, with unique ids and a real provider prefix', () => {
    expect(IMAGE_MODELS.length).toBeGreaterThan(2);
    const ids = IMAGE_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of IMAGE_MODELS) {
      // OpenRouter ids are `vendor/model`. A bare name is a typo that would only
      // show up as a failed generation.
      expect(m.id, `${m.id} is not vendor/model`).toMatch(/^[a-z0-9-]+\/[a-z0-9.\-]+$/);
      expect(m.label.trim()).not.toBe('');
      expect(m.note.trim()).not.toBe('');
      expect(m.centsPerImage).toBeGreaterThan(0);
    }
  });

  it('the fallback is one of the listed models', () => {
    // A fallback outside the menu is a model the user can never choose or
    // un-choose, which is the defect this file exists to remove.
    expect(findImageModel(FALLBACK_IMAGE_MODEL)).not.toBeNull();
  });

  it('the fallback is a cheap one, since it runs before anyone has chosen', () => {
    /*
     * Not "the cheapest" — that would have quietly re-pointed the shipped
     * default at a different model, changing every existing user's output as a
     * side effect of a refactor. The property that matters is that an unattended
     * 14-slide deck costs cents: a `fast` model, in the cheaper half.
     */
    const fallback = findImageModel(FALLBACK_IMAGE_MODEL)!;
    expect(fallback.kind).toBe('fast');
    const median = [...IMAGE_MODELS].sort((a, b) => a.centsPerImage - b.centsPerImage)[
      Math.floor(IMAGE_MODELS.length / 2)
    ];
    expect(fallback.centsPerImage).toBeLessThanOrEqual(median.centsPerImage);
  });
});

describe('resolveImageModel', () => {
  it('uses the fallback only when nothing is chosen', () => {
    expect(resolveImageModel(null)).toBe(FALLBACK_IMAGE_MODEL);
    expect(resolveImageModel(undefined)).toBe(FALLBACK_IMAGE_MODEL);
    expect(resolveImageModel('   ')).toBe(FALLBACK_IMAGE_MODEL);
  });

  it('honours a chosen model', () => {
    const other = IMAGE_MODELS.find((m) => m.id !== FALLBACK_IMAGE_MODEL)!;
    expect(resolveImageModel(other.id)).toBe(other.id);
  });

  it('honours an id that is not in the catalog', () => {
    // The list is a menu, not a whitelist. Silently downgrading an unrecognised
    // id would reintroduce a second gate on model choice.
    expect(resolveImageModel('some/new-model')).toBe('some/new-model');
  });
});

describe('the image model is no longer pinned', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

  it('generate.ts does not hardcode a model id', () => {
    const src = read('lib/images/generate.ts');
    // The literal that used to be the only model AIME could ever use.
    expect(src).not.toMatch(/=\s*'google\/gemini-2\.5-flash-image'/);
    expect(src).toContain('resolveImageModel');
  });

  it('the call site passes the user’s choice through', () => {
    const src = read('lib/providers/claude-provider.ts');
    const call = /generateImage\(\{[\s\S]*?\n\s*\}\);/.exec(src)?.[0] ?? '';
    expect(call, 'generateImage is called without a model — the user’s pick is ignored').toContain(
      'model:',
    );
    expect(call).toContain('imageModel');
  });

  it('the turn payload carries imageModel, or the server never sees the choice', () => {
    expect(read('hooks/use-search-settings.ts')).toContain('imageModel');
  });

  it('settings expose it, and default to unchosen rather than to a model', () => {
    const store = read('stores/settings-store.ts');
    expect(store).toContain('imageModel');
    expect(store).toContain('setImageModel');
    // `null` is what makes "not chosen" distinguishable from "chose the default".
    expect(store).toMatch(/imageModel:\s*null/);
  });

  it('exactly one Settings component renders an image-model chooser', () => {
    const dir = path.join(process.cwd(), 'src', 'components', 'settings', 'sections');
    const offenders = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
      .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('IMAGE_MODELS'));
    expect(offenders).toEqual(['image-model-chooser.tsx']);
  });
});
