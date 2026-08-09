import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  THEMES,
  THEME_CLASSES,
  themeSpec,
  isDarkTheme,
  isDarkFromClasses,
  migrateThemeId,
  preHydrationThemeScript,
} from './app-themes';

/**
 * A theme was described in five places and one description was already wrong.
 *
 * The `Theme` union, `applyTheme`, the pre-hydration script inlined in
 * `layout.tsx`, the Settings picker, and `diff-viewer` — which classified the
 * light pink theme as DARK, so its diffs rendered inverted for anyone using it.
 * Nobody had noticed, because the only way to notice is to use that theme and
 * open a diff.
 *
 * These tests exist so adding a sixth theme cannot repeat it.
 */

const css = () => fs.readFileSync(path.resolve(process.cwd(), 'src/app/globals.css'), 'utf-8');
const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');

describe('every theme is completely defined', () => {
  /** A class with no CSS block is a theme that renders as light with a name. */
  it.each(THEMES.filter((t) => t.className))('$id has a CSS block', ({ className }) => {
    expect(css(), `.${className} has no block in globals.css`).toMatch(
      new RegExp(`^\\.${className}\\s*\\{`, 'm'),
    );
  });

  /**
   * Every block must define the SAME tokens. A theme missing one inherits it
   * from :root, which for a dark theme means a light value on a dark surface —
   * invisible text, and only on that theme.
   */
  it('defines the same token set as light and dark', () => {
    const tokensOf = (sel: string) => {
      const m = new RegExp(`^\\${sel}\\s*\\{([\\s\\S]*?)^\\}`, 'm').exec(css());
      return new Set([...(m?.[1] ?? '').matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((x) => x[1]));
    };
    const baseline = tokensOf('.dark');
    expect(baseline.size, 'could not read .dark tokens').toBeGreaterThan(20);

    for (const t of THEMES) {
      if (!t.className || t.className === 'dark') continue;
      const mine = tokensOf(`.${t.className}`);
      const missing = [...baseline].filter((x) => !mine.has(x));
      expect(missing, `.${t.className} is missing ${missing.join(', ')}`).toEqual([]);
    }
  });

  /**
   * Syntax highlighting is themed separately from the token set, so a dark
   * theme without its own `.hljs` rule shows the LIGHT highlight palette on a
   * dark background.
   */
  it.each(THEMES.filter((t) => t.className && t.dark === true))(
    '$id themes code blocks too',
    ({ className }) => {
      expect(css(), `.${className} .hljs is missing — code blocks would render light`).toMatch(
        new RegExp(`\\.${className}\\s+\\.hljs\\s*\\{`),
      );
    },
  );

  it('is offered in Settings', () => {
    const picker = read('src/components/settings/sections/appearance-section.tsx');
    for (const t of THEMES) {
      expect(picker, `${t.id} is not in the Settings picker`).toContain(`'${t.id}'`);
    }
  });
});

describe('light or dark', () => {
  it('knows Zara is light despite being vivid', () => {
    // The bug this replaces: the diff viewer called it dark.
    expect(isDarkTheme('zara', false)).toBe(false);
    expect(isDarkTheme('zara', true)).toBe(false);
  });

  it('knows Max is dark', () => {
    expect(isDarkTheme('max', false)).toBe(true);
  });

  it('follows the OS only for system', () => {
    expect(isDarkTheme('system', true)).toBe(true);
    expect(isDarkTheme('system', false)).toBe(false);
    expect(isDarkTheme('light', true)).toBe(false);
  });

  it('falls back to light for anything unrecognised', () => {
    expect(themeSpec('nonsense').id).toBe('light');
    expect(isDarkTheme(null, true)).toBe(false);
  });
});

describe('reading the theme off <html>', () => {
  it('recognises each theme by its class', () => {
    expect(isDarkFromClasses(['max'], false)).toBe(true);
    expect(isDarkFromClasses(['zara'], true)).toBe(false);
    expect(isDarkFromClasses(['dark'], false)).toBe(true);
  });

  it('treats no theme class as light', () => {
    expect(isDarkFromClasses([], false)).toBe(false);
  });
});

/**
 * `aime:app` had no migration path, so a renamed value would have silently
 * dropped the user onto light — a theme they never chose.
 */
describe('the Emma → Zara rename', () => {
  it('carries an existing Emma user across', () => {
    expect(migrateThemeId('emma')).toBe('zara');
  });

  it('leaves every other theme alone', () => {
    for (const t of THEMES) expect(migrateThemeId(t.id)).toBe(t.id);
  });

  it('sends a corrupt or unknown value to light rather than nowhere', () => {
    expect(migrateThemeId(undefined)).toBe('light');
    expect(migrateThemeId(42)).toBe('light');
    expect(migrateThemeId('purple')).toBe('light');
  });

  it('is wired into the store, not just available', () => {
    const store = read('src/stores/app-store.ts');
    expect(store, 'app-store has no version — migrate never runs').toMatch(/version:\s*1/);
    expect(store).toMatch(/migrateThemeId/);
  });
});

/**
 * The pre-hydration script sets the class before React runs, so the app does
 * not flash the wrong colours. It was a hand-written fifth copy of these rules
 * and, being a string, the one most likely to be missed.
 */
describe('the pre-hydration script', () => {
  const script = preHydrationThemeScript();

  it.each(THEMES.filter((t) => t.className))('knows about $id', ({ id, className }) => {
    expect(script).toContain(`"${id}":"${className}"`);
  });

  it('applies the rename before looking up the class', () => {
    expect(script).toContain('"emma":"zara"');
    expect(script.indexOf('R[t]')).toBeLessThan(script.indexOf('C[t]'));
  });

  it('still resolves system against the OS', () => {
    expect(script).toContain('prefers-color-scheme: dark');
  });

  it('is generated, not hand-written into layout.tsx', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toContain('preHydrationThemeScript()');
    expect(layout, 'a second hand-written copy of the theme rules').not.toMatch(
      /classList\.add\('emma'\)/,
    );
  });

  /** It runs as inline JS; a stray backtick or newline would break the page. */
  it('is valid JavaScript', () => {
    expect(() => new Function(script)).not.toThrow();
    expect(script).not.toContain('`');
  });
});

/**
 * The Code surface looked like a different product because every one of its
 * dockview variables was `hsl(var(--token))` against HEX tokens — invalid CSS,
 * discarded by the browser, leaving dockview's own palette showing. Nothing
 * errored; it just quietly wore someone else's colours.
 */
describe('the Code surface inherits the app theme', () => {
  const dv = () =>
    read('src/components/surfaces/code/workspace/workspace-dockview.css').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );

  it('never wraps a hex token in hsl()', () => {
    expect(dv(), 'hsl(var(--token)) is invalid against hex tokens').not.toMatch(/hsl\(\s*var\(--/);
  });

  it('still references the app tokens rather than hardcoding colours', () => {
    const src = dv();
    expect((src.match(/var\(--/g) ?? []).length).toBeGreaterThan(30);
    expect(src, 'dockview vars were hardcoded instead of inheriting').not.toMatch(
      /--dv-[a-z-]+:\s*#[0-9a-f]{3,6}/i,
    );
  });

  it('uses color-mix for translucency, since hex cannot carry alpha', () => {
    expect(dv()).toMatch(/color-mix\(in srgb, var\(--/);
  });
});

describe('the class list used to reset the theme', () => {
  it('covers every theme that has a class', () => {
    for (const t of THEMES) {
      if (t.className) expect(THEME_CLASSES).toContain(t.className);
    }
  });

  it('is what store-hydration strips, so switching never leaves two applied', () => {
    const h = read('src/components/store-hydration.tsx');
    expect(h).toMatch(/classList\.remove\(\.\.\.THEME_CLASSES\)/);
  });
});

/**
 * Consolidation, asserted rather than asserted-to.
 *
 * The rename was done by following every file that mentioned "emma" — which is
 * not the same as every file that decides light-vs-dark. Two did not mention it
 * and were missed on the first pass: `code-renderer` (which picks the
 * highlight.js stylesheet) and `workspace-layout` (the editor chrome). Both
 * tested `classList.contains('dark')` literally, so Max — dark, with its own
 * class — would have got light syntax highlighting on a navy background.
 *
 * These fail if a third copy appears.
 */
describe('light-vs-dark is decided in one place', () => {
  const sourceFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(full);
      }
    };
    walk(path.resolve(process.cwd(), 'src'));
    return out;
  };

  const withoutComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

  /** The DOM knows which class is set; only the registry knows which are dark. */
  it('nothing tests for the .dark class directly', () => {
    const offenders = sourceFiles().filter((f) => {
      if (f.endsWith('app-themes.ts') || f.endsWith('use-dark-theme.ts')) return false;
      return /classList\.contains\(\s*["']dark["']\s*\)/.test(withoutComments(fs.readFileSync(f, 'utf-8')));
    });
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it('nothing compares the theme id to a literal', () => {
    const offenders = sourceFiles().filter((f) => {
      if (f.endsWith('app-themes.ts')) return false;
      const code = withoutComments(fs.readFileSync(f, 'utf-8'));
      // `theme` here is the APP theme; deck themes are a different concept and
      // are compared by id legitimately elsewhere, hence the narrow pattern.
      return /\btheme\s*===\s*["'](dark|light|max|zara)["']/.test(code);
    });
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  /**
   * One watcher that DECIDES light-vs-dark, not one per consumer — each copy is
   * a place that can miss the OS-change case for `system`, which sets no class
   * of its own.
   *
   * Watching the class for other reasons is fine and `terminal.tsx` does it
   * legitimately: it re-derives xterm's palette by resolving `var(--background)`
   * and friends, so it never classifies anything and is correct for any theme,
   * including ones that do not exist yet. The first version of this test failed
   * on it, which was the test being wrong rather than the code.
   */
  it('only one watcher turns the class into a light/dark decision', () => {
    const deciders = sourceFiles().filter((f) => {
      const code = withoutComments(fs.readFileSync(f, 'utf-8'));
      if (!/attributeFilter:\s*\[\s*["']class["']\s*\]/.test(code)) return false;
      // A watcher that also decides light-vs-dark, rather than merely
      // re-reading whatever the tokens now say.
      return /isDark|contains\(\s*["']dark["']/.test(code);
    });
    expect(
      deciders.map((f) => path.basename(f)),
      'a second light/dark watcher appeared — use useIsDarkTheme()',
    ).toEqual(['use-dark-theme.ts']);
  });
});
