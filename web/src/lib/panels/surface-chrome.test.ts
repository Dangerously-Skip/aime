import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * One visual language across five surfaces, checked rather than remembered.
 *
 * Cowork and Code were rebuilt around panels as recessed wells — rounded,
 * inset, separated by gaps. Chat, Browser and Assistant still divided their
 * columns with `border-l border-border`: full-bleed slabs ruled off from each
 * other, which is the older idiom and read as dated the moment the other two
 * improved.
 *
 * That is the inconsistency INVERTED rather than removed. `workspace-dockview.
 * css` opens by noting the Code surface "looked like a different product"; after
 * it was fixed, it looked better than its neighbours. Same problem, other
 * direction, and the reason DR-20 D-4 promotes these values into the theme.
 *
 * The rule everything here enforces: A SEAM IS A GAP, NOT A STROKE.
 */

const src = (...p: string[]) => readFileSync(resolve(__dirname, '../..', ...p), 'utf8');

const SURFACES = {
  chat: src('components/surfaces/chat/chat-surface.tsx'),
  browser: src('components/surfaces/browser/browser-surface.tsx'),
  assistant: src('components/surfaces/assistant/assistant-surface.tsx'),
} as const;

const globals = src('app/globals.css');
const dockview = src('components/surfaces/code/workspace/workspace-dockview.css');

describe('the panel surface is a theme token, defined once', () => {
  it('exists in both themes', () => {
    /*
     * A token defined only for dark falls back to nothing in light, which
     * renders a transparent panel rather than an obviously broken one.
     *
     * Anchored on the BLOCK openers, not the bare strings. The first version
     * sliced between `indexOf(':root')` and `indexOf('.dark')` and failed
     * against a correct stylesheet, because the first `.dark` in the file is
     * `@custom-variant dark (&:is(.dark *))` on line 5 — before `:root` — so
     * the range was inverted and empty.
     */
    const block = (opener: string) => {
      const start = globals.indexOf(opener);
      expect(start, `${opener} block not found — did the theme move?`).toBeGreaterThan(-1);
      return globals.slice(start, globals.indexOf('\n}', start));
    };
    expect(block('\n:root {'), '--panel-surface missing from light').toContain('--panel-surface');
    expect(block('\n.dark {'), '--panel-surface missing from dark').toContain('--panel-surface');
  });

  it('dockview aliases the shared token rather than defining a rival', () => {
    /*
     * It had its own `--dv-panel-surface: color-mix(...)`. Two definitions of
     * "the panel colour" is how the Code surface came to look like a different
     * product in the first place.
     */
    expect(dockview).toContain('--dv-panel-surface: var(--panel-surface)');
    expect(dockview).not.toMatch(/--dv-panel-surface:\s*color-mix/);
  });

  it('`.surface-well` draws no border', () => {
    // The whole point. A well with a border is a slab with rounded corners.
    const rule = /\.surface-well\s*\{([^}]*)\}/.exec(globals)?.[1] ?? '';
    expect(rule, '.surface-well rule not found — did it move?').toBeTruthy();
    expect(rule).toContain('var(--panel-surface)');
    expect(rule).toMatch(/border:\s*none/);
  });
});

describe('no surface rules off its columns with a full-bleed stroke', () => {
  it.each(Object.entries(SURFACES))('%s uses gaps, not border-l/border-r', (name, source) => {
    const strokes = [
      ...source.matchAll(/border-[lr] border-border(?![/\w-])/g),
    ].map((m) => m[0]);
    expect(
      strokes,
      `${name} divides a column with a rule — use \`surface-well\` and a margin so the seam is a gap`,
    ).toEqual([]);
  });

  it.each(Object.entries(SURFACES))('%s actually adopts the well', (name, source) => {
    // The absence of strokes could equally mean the column vanished.
    expect(source, `${name} has no surface-well — did the panel chrome regress?`).toContain(
      'surface-well',
    );
  });
});
