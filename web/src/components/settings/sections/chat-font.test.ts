import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every chat font must exist in all three places, derived from source.
 *
 * OpenDyslexic shipped once as an `@font-face` in `globals.css` and nothing
 * else: no `font-family: OpenDyslexic` anywhere, and Settings offered only
 * default/sans/mono/system. Browsers do not download a family nobody
 * references, so the rule was unreachable — an accessibility option that looked
 * present in the stylesheet and did nothing in the app. It was deleted rather
 * than left looking functional.
 *
 * The gap it left is the one this checks: a font is a `ChatFont` union member,
 * a `.chat-font-*` CSS class, a `FONT_CLASS_MAP` entry and a Settings option,
 * and three-out-of-four is invisible at runtime. Read from source so a new font
 * is covered without anyone remembering this file exists.
 */
const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');

const STORE = read('src/stores/settings-store.ts');
const CSS = read('src/app/globals.css');
const MAP = read('src/components/shared/message-list.tsx');
const SETTINGS = read('src/components/settings/sections/appearance-section.tsx');

/** The `ChatFont` union, which is the definition the other three answer to. */
const FONTS = (() => {
  const line = /export type ChatFont =([^;]+);/.exec(STORE)?.[1] ?? '';
  return [...line.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
})();

describe('chat fonts are wired end to end', () => {
  it('found the union, so the rest of this file can fail', () => {
    expect(FONTS.length).toBeGreaterThan(1);
    expect(FONTS).toContain('default');
  });

  it.each(FONTS)('%s has a CSS class', (font) => {
    expect(CSS, `.chat-font-${font} is missing from globals.css`).toContain(`.chat-font-${font} {`);
  });

  it.each(FONTS)('%s is in FONT_CLASS_MAP', (font) => {
    expect(MAP, `${font} is not mapped, so choosing it does nothing`).toMatch(
      new RegExp(`\\b${font}:\\s*"chat-font-${font}"`),
    );
  });

  it.each(FONTS)('%s is offered in Settings', (font) => {
    expect(SETTINGS, `${font} exists but is unreachable — no way to choose it`).toContain(
      `value: '${font}'`,
    );
  });

  /* The reverse: a class with no font is the dead rule that started this. */
  it('has no orphan .chat-font-* class', () => {
    const declared = [...CSS.matchAll(/\.chat-font-([a-z-]+)\s*\{/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...FONTS].sort());
  });
});

/**
 * The bundling promise specifically. A CDN reference would work on the
 * developer's machine and fail for someone offline — and the person who needs
 * this face is exactly the one for whom that is a real failure rather than a
 * cosmetic one.
 */
describe('OpenDyslexic is bundled, not fetched', () => {
  const FILES = [
    'OpenDyslexic-Regular.woff',
    'OpenDyslexic-Bold.woff',
    'OpenDyslexic-Italic.woff',
    'OpenDyslexic-BoldItalic.woff',
  ];

  it.each(FILES)('%s ships in public/', (file) => {
    const p = path.resolve(process.cwd(), 'public/fonts/opendyslexic', file);
    expect(fs.existsSync(p), `${file} is referenced by globals.css but not vendored`).toBe(true);
    expect(fs.statSync(p).size).toBeGreaterThan(1000);
  });

  it('references only local paths', () => {
    const faces = CSS.slice(CSS.indexOf("font-family: 'OpenDyslexic'"));
    const urls = [...faces.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
    expect(urls.length).toBe(FILES.length);
    for (const u of urls) {
      expect(u, 'a remote font URL would fail offline').toMatch(/^\/fonts\/opendyslexic\//);
    }
  });

  /* Bitstream Vera permits redistribution on one condition: the notice ships
   * with the files. That condition is the only thing making this legal. */
  it('ships the licence beside the files', () => {
    const licence = path.resolve(process.cwd(), 'public/fonts/opendyslexic/LICENSE.txt');
    expect(fs.existsSync(licence)).toBe(true);
    const text = fs.readFileSync(licence, 'utf-8');
    expect(text).toContain('Bitstream');
    expect(text).toMatch(/permission notice shall be included/i);
  });

  it('does not prefer a locally installed copy over the bundled one', () => {
    const faces = CSS.slice(CSS.indexOf("font-family: 'OpenDyslexic'"));
    expect(faces, 'local() makes rendering differ per machine').not.toContain('local(');
  });
});
