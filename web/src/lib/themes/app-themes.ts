/**
 * The app's colour themes, in one place.
 *
 * There were four descriptions of the same fact scattered around — the `Theme`
 * union, the `applyTheme` branch, the inline pre-hydration script in
 * `layout.tsx`, and the Settings picker — plus one straggler in `diff-viewer`
 * that classified Emma as DARK when Emma is a light pink theme, so its diffs
 * rendered inverted for anyone using it. Four descriptions, one already wrong:
 * the usual arithmetic.
 *
 * `THEMES` is the single description. Adding one now means adding an entry and
 * a CSS block, and `app-themes.test.ts` fails if those two disagree.
 */

export type ThemeId = 'light' | 'dark' | 'system' | 'zara' | 'max';

export interface ThemeSpec {
  id: ThemeId;
  label: string;
  /**
   * The class put on <html>. `null` for light (the bare default) and for
   * system, which resolves to light or dark at runtime.
   */
  className: string | null;
  /**
   * Whether syntax highlighting, diffs and embedded editors should use their
   * dark variants. `'auto'` follows the OS.
   */
  dark: boolean | 'auto';
}

export const THEMES: readonly ThemeSpec[] = [
  { id: 'light', label: 'Light', className: null, dark: false },
  { id: 'dark', label: 'Dark', className: 'dark', dark: true },
  { id: 'system', label: 'System', className: null, dark: 'auto' },
  // Formerly "The Emma". Light, despite the saturation — which is exactly what
  // the diff viewer got wrong.
  { id: 'zara', label: 'Zara', className: 'zara', dark: false },
  // The deep navy the Code surface was accidentally showing: dockview's own
  // "abyss" palette, which it fell back to because every themed variable was
  // invalid CSS. Adopted deliberately here rather than left as an accident.
  { id: 'max', label: 'Max', className: 'max', dark: true },
] as const;

/** Every class a theme may put on <html> — what to strip before applying one. */
export const THEME_CLASSES = THEMES.map((t) => t.className).filter((c): c is string => c !== null);

export function themeSpec(id: string | null | undefined): ThemeSpec {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/**
 * Should dark variants be used right now?
 *
 * @param prefersDark what the OS says, for the `system` case. Passed in rather
 *   than read here so this stays usable during SSR and in tests.
 */
export function isDarkTheme(id: string | null | undefined, prefersDark: boolean): boolean {
  const spec = themeSpec(id);
  return spec.dark === 'auto' ? prefersDark : spec.dark;
}

/**
 * Themes renamed after they shipped, old id → new id.
 *
 * `aime:app` is persisted with no migration of its own, so without this a user
 * on `emma` would silently land back on light — a theme they never chose, with
 * nothing to explain it.
 */
export const RENAMED_THEMES: Record<string, ThemeId> = {
  emma: 'zara',
};

export function migrateThemeId(id: unknown): ThemeId {
  if (typeof id !== 'string') return 'light';
  if (id in RENAMED_THEMES) return RENAMED_THEMES[id];
  return THEMES.some((t) => t.id === id) ? (id as ThemeId) : 'light';
}

/**
 * Is the currently-applied theme dark, judged from <html>'s classes?
 *
 * For code that watches the DOM rather than the store — the dockview theme
 * switcher does, so it can react to a theme change without a prop drill. It
 * checked for `.dark` literally, which meant Max (dark navy) would have been
 * handed the LIGHT editor theme: the same class of miss the diff viewer already
 * had with Zara, in the opposite direction.
 */
export function isDarkFromClasses(classes: DOMTokenList | string[], prefersDark: boolean): boolean {
  const has = (c: string) =>
    Array.isArray(classes) ? classes.includes(c) : classes.contains(c);
  for (const t of THEMES) {
    if (t.className && has(t.className)) return t.dark === 'auto' ? prefersDark : t.dark;
  }
  // No theme class at all means light, or system-resolved-to-light.
  return false;
}

/**
 * The pre-hydration script, generated from this table.
 *
 * `layout.tsx` inlines a snippet that reads the persisted theme and sets the
 * class BEFORE React runs, so the app does not flash the wrong colours. It was
 * a fifth hand-written copy of the rules here — and the one most likely to be
 * forgotten, being a string. Generating it means a new theme cannot miss it.
 */
export function preHydrationThemeScript(): string {
  const classFor = Object.fromEntries(
    THEMES.filter((t) => t.className).map((t) => [t.id, t.className]),
  );
  const autoDark = THEMES.filter((t) => t.dark === 'auto').map((t) => t.id);
  return (
    `(function(){try{` +
    `var h=document.documentElement;h.classList.add('no-transition');` +
    `var d=JSON.parse(localStorage.getItem('aime:app')||localStorage.getItem('nibcowork:app')||'{}');` +
    `var t=(d.state||{}).theme||'light';` +
    `var R=${JSON.stringify(RENAMED_THEMES)};if(R[t])t=R[t];` +
    `var C=${JSON.stringify(classFor)};var A=${JSON.stringify(autoDark)};` +
    `if(C[t]){h.classList.add(C[t])}` +
    `else if(A.indexOf(t)>=0&&window.matchMedia('(prefers-color-scheme: dark)').matches){h.classList.add('dark')}` +
    `requestAnimationFrame(function(){requestAnimationFrame(function(){h.classList.remove('no-transition')})});` +
    `}catch(e){}})();`
  );
}
