import 'server-only';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The deck theme catalog, read from the vendored theme files.
 *
 * Read from disk rather than hardcoded, because the themes ARE the files: a
 * hardcoded list would be a second source of truth that drifts the first time
 * someone adds or removes one. `html-deck.test.ts` already enforces that the
 * skill's names match the files; this is the same rule applied to the UI.
 *
 * Tokens are parsed out so the picker can render a real preview. A colour swatch
 * grid would be a worse product than showing what a slide actually looks like —
 * the whole reason to have 36 of these is that you choose by eye — and since the
 * themes are pure custom-property files, the preview needs nothing but the
 * values.
 */

export interface ThemeTokens {
  bg: string;
  surface: string;
  text1: string;
  text2: string;
  border: string;
  accent: string;
  fontSans: string;
  fontDisplay: string;
  radius: string;
}

export interface DeckTheme {
  /** File stem — what goes in the stylesheet link and what the model is told. */
  id: string;
  /** Title-cased for display: `swiss-grid` -> `Swiss Grid`. */
  label: string;
  /** Grouping for the picker. Mirrors the groups in `deck-html/SKILL.md`. */
  group: string;
  tokens: ThemeTokens;
}

const THEMES_DIR = path.resolve(
  process.cwd(),
  'resources/html-deck/assets/themes',
);

/**
 * Groups, in the order the picker shows them.
 *
 * Same groupings as the skill, deliberately: the model and the user should be
 * choosing from the same map. A theme in no group falls into "Other" rather
 * than vanishing — a new upstream theme should appear somewhere without anyone
 * having to remember to categorise it first.
 */
const GROUPS: Array<{ name: string; ids: string[] }> = [
  { name: 'Corporate', ids: ['corporate-clean', 'swiss-grid', 'minimal-white', 'arctic-cool'] },
  { name: 'Pitch', ids: ['pitch-deck-vc', 'aurora', 'sunset-warm', 'rainbow-gradient'] },
  { name: 'Editorial', ids: ['editorial-serif', 'magazine-bold', 'midcentury', 'japanese-minimal'] },
  { name: 'Technical', ids: ['blueprint', 'engineering-whiteprint', 'sharp-mono', 'terminal-green', 'academic-paper'] },
  {
    name: 'Developer palettes',
    ids: ['nord', 'dracula', 'tokyo-night', 'gruvbox-dark', 'catppuccin-latte', 'catppuccin-mocha', 'rose-pine', 'solarized-light'],
  },
  {
    name: 'Expressive',
    ids: ['bauhaus', 'memphis-pop', 'neo-brutalism', 'vaporwave', 'y2k-chrome', 'retro-tv', 'cyberpunk-neon'],
  },
  { name: 'Soft', ids: ['soft-pastel', 'glassmorphism', 'xiaohongshu-white', 'news-broadcast'] },
];

/** Pull a custom property's value out of a theme file. */
function token(css: string, name: string, fallback: string): string {
  // Themes declare everything in one `:root{}` block, often several per line.
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([^;}]+)`));
  return m ? m[1].trim() : fallback;
}

function labelFor(id: string): string {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function groupFor(id: string): string {
  return GROUPS.find((g) => g.ids.includes(id))?.name ?? 'Other';
}

/** Every theme on disk, parsed. Empty when the assets are missing. */
export function listDeckThemes(): DeckTheme[] {
  if (!fs.existsSync(THEMES_DIR)) return [];

  const themes = fs
    .readdirSync(THEMES_DIR)
    .filter((f) => f.endsWith('.css'))
    .map((f) => {
      const id = f.replace(/\.css$/, '');
      const css = fs.readFileSync(path.join(THEMES_DIR, f), 'utf-8');
      return {
        id,
        label: labelFor(id),
        group: groupFor(id),
        tokens: {
          bg: token(css, 'bg', '#ffffff'),
          surface: token(css, 'surface', '#ffffff'),
          text1: token(css, 'text-1', '#111111'),
          text2: token(css, 'text-2', '#555555'),
          border: token(css, 'border', '#e5e5e5'),
          accent: token(css, 'accent', '#3b7ea1'),
          fontSans: token(css, 'font-sans', 'system-ui, sans-serif'),
          fontDisplay: token(css, 'font-display', 'system-ui, sans-serif'),
          radius: token(css, 'radius', '8px'),
        },
      };
    });

  // Ordered by group, so the picker reads as a considered list rather than
  // alphabetical noise; unknown themes sort last but are never dropped.
  const order = new Map(GROUPS.map((g, i) => [g.name, i]));
  return themes.sort((a, b) => {
    const ga = order.get(a.group) ?? 99;
    const gb = order.get(b.group) ?? 99;
    return ga === gb ? a.label.localeCompare(b.label) : ga - gb;
  });
}

/** Does this id name a theme that exists? Used to reject a stale stored value. */
export function isKnownTheme(id: string): boolean {
  return fs.existsSync(path.join(THEMES_DIR, `${id}.css`));
}
