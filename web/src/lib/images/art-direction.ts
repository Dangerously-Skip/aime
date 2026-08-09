import * as fs from 'fs';
import * as path from 'path';

/**
 * Turn a deck theme into art direction for an image model.
 *
 * The point is consistency. An image that is merely PRESENT fights the design —
 * a stock photo with a blue-grey cast dropped into `neo-brutalism` reads as
 * clip-art someone pasted in, and the deck stops looking authored. So the
 * generator is told the palette the slide will actually use.
 *
 * Read from the theme's own CSS rather than a hand-written table of 36 entries.
 * A table would be a second description of each theme, free to drift from the
 * file that decides what the slide really looks like — and 36 of them would be
 * wrong within a release. The tokens are the source of truth for the deck, so
 * they are the source of truth here too.
 */

const THEMES = path.resolve(process.cwd(), 'resources/html-deck/assets/themes');

export interface ArtDirection {
  /** Hex/rgb values lifted from the theme, in prompt-ready form. */
  palette: string[];
  /** The sentence appended to an image prompt. */
  instruction: string;
}

/** Pull a custom property's value out of a theme stylesheet. */
function token(css: string, name: string): string | null {
  const m = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css);
  return m ? m[1].trim() : null;
}

/**
 * Character cues that cannot be read off a colour.
 *
 * Keyed on substrings of the theme id, so a new theme with a familiar word gets
 * sensible direction without an entry. Deliberately short: this is a nudge on
 * top of the palette, not a second design system. Anything unmatched falls back
 * to the palette alone, which is the honest answer for a theme nobody has
 * characterised.
 */
const CUES: Array<[RegExp, string]> = [
  [/brutal|bauhaus|memphis|pop/, 'bold flat shapes, hard edges, high contrast, no gradients'],
  [/editorial|serif|magazine|midcentury|academic/, 'photographic, warm, documentary, shallow depth of field'],
  [/blueprint|engineering|sharp-mono|terminal|code/, 'technical line-work, schematic, restrained'],
  [/cyberpunk|vaporwave|y2k|neon|retro-tv|rainbow/, 'saturated neon, glow, synthetic, high energy'],
  [/pastel|soft|glass|arctic|xiaohongshu/, 'soft light, gentle gradients, airy, minimal'],
  [/nord|dracula|tokyo|gruvbox|catppuccin|rose-pine|solarized/, 'muted low-contrast tones, calm, developer-desktop mood'],
  [/japanese|minimal|swiss|corporate|clean/, 'clean negative space, simple geometry, understated'],
];

/**
 * @returns direction for `themeId`, or `null` when the theme has no file — in
 * which case the caller must NOT invent a look. Silently substituting a default
 * aesthetic is how the model's own taste becomes the house style.
 */
export function themeArtDirection(themeId: string | null | undefined): ArtDirection | null {
  if (!themeId || !/^[a-z0-9-]+$/.test(themeId)) return null;

  const file = path.join(THEMES, `${themeId}.css`);
  // The id is regex-checked above, so this cannot escape THEMES; the existence
  // check is what turns an unknown theme into `null` rather than a throw.
  if (!fs.existsSync(file)) return null;

  let css: string;
  try {
    css = fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }

  const palette = ['bg', 'accent', 'text-1', 'accent-2']
    .map((t) => token(css, t))
    .filter((v): v is string => !!v && !v.startsWith('linear-gradient'));

  const cue = CUES.find(([re]) => re.test(themeId))?.[1];

  const parts = [
    `Match this deck's design system (theme: ${themeId}).`,
    palette.length ? `Use this palette: ${palette.join(', ')}.` : '',
    cue ? `Visual character: ${cue}.` : '',
    // The two failure modes that make a generated image unusable on a slide,
    // both of which models produce by default unless told otherwise.
    'No text, words, letters or numbers anywhere in the image.',
    'No borders, frames, drop shadows or mockup chrome — it will be placed inside an existing layout.',
  ].filter(Boolean);

  return { palette, instruction: parts.join(' ') };
}
