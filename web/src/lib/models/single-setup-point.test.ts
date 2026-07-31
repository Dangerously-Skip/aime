import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Models are set up in exactly ONE place: the tier grid in Settings.
 *
 * They used to be set up in four. Settings alone had three separate model
 * dropdowns — "Default Model per Surface" in Capabilities, plus a "Default
 * model" in each of the Code and Cowork sections — and each surface store also
 * carried a hardcoded built-in (`sonnet`, `opus`, `sonnet`). That default is not
 * a harmless fallback: it meant every surface shipped PINNED, so the tier grid
 * the user actually configured never got a say, and a BYOK-only user (no
 * Anthropic key) found surfaces reaching for a provider they had not set up.
 *
 * Two properties, both derived from source so a new file cannot quietly
 * reintroduce the problem:
 *
 *   1. no surface store exposes a per-surface model or `setModel`
 *   2. the tier grid is the only Settings section that renders a model chooser
 */

const SRC = path.resolve(__dirname, '../..');
const STORES = path.join(SRC, 'stores');
const SETTINGS_SECTIONS = path.join(SRC, 'components/settings/sections');

const read = (p: string) => fs.readFileSync(p, 'utf-8');
const sources = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f))
    .map((f) => ({ name: f, text: read(path.join(dir, f)) }));

const SURFACE_STORES = [
  'chat-store.ts',
  'cowork-store.ts',
  'code-store.ts',
  'browser-store.ts',
];

describe('no surface store carries a model of its own', () => {
  it.each(SURFACE_STORES)('%s exposes neither `model` nor `setModel`', (file) => {
    const text = read(path.join(STORES, file));

    // `modelRoute` / `setModelRoute` are the ONE representation and must survive;
    // these patterns are written to match the bare names only.
    expect(/^\s*model:\s/m.test(text), `${file} declares a per-surface model`).toBe(false);
    expect(/\bsetModel\b(?!Route)/.test(text), `${file} still has setModel`).toBe(false);
  });

  /**
   * The surfaces with a composer picker keep `modelRoute` — one representation
   * for every selection (tier, built-in, or a BYOK provider's model), so an
   * unset route means "follow Settings" rather than a hidden default.
   */
  it.each(['chat-store.ts', 'cowork-store.ts', 'code-store.ts'])(
    '%s keeps modelRoute — the replacement, not a deletion',
    (file) => {
      expect(/\bmodelRoute\b/.test(read(path.join(STORES, file)))).toBe(true);
    },
  );

  /**
   * Browser is the strictest case and deliberately different: no picker, no
   * route, no stored model. It follows Settings and nothing else. It is also the
   * surface that regressed, so its having NO local model state is worth pinning
   * down rather than leaving as an accident of the current UI.
   */
  it('browser-store holds no model state at all', () => {
    const text = read(path.join(STORES, 'browser-store.ts'));
    expect(/\bmodelRoute\b/.test(text)).toBe(false);
    expect(/^\s*model:\s/m.test(text)).toBe(false);
  });
});

describe('the tier grid is the only model chooser in Settings', () => {
  // A <select> or dropdown whose options are model names. The built-in aliases
  // are the tell: a section listing them is offering its own model choice.
  const OFFERS_MODELS = /<option value="(sonnet|opus|haiku)"/;

  const sections = sources(SETTINGS_SECTIONS);

  it('found the settings sections (so this cannot pass on an empty set)', () => {
    expect(sections.length).toBeGreaterThan(5);
    expect(sections.map((s) => s.name)).toContain('tier-grid.tsx');
  });

  it.each(
    sources(SETTINGS_SECTIONS)
      .filter((s) => s.name !== 'tier-grid.tsx')
      .map((s) => [s.name, s.text] as const),
  )('%s does not offer its own model dropdown', (name, text) => {
    expect(
      OFFERS_MODELS.test(text),
      `${name} renders its own model chooser. Models are configured in the tier ` +
        `grid so one setting governs every surface; a second chooser here means ` +
        `the user sets a model and some surfaces ignore it.`,
    ).toBe(false);
  });
});
