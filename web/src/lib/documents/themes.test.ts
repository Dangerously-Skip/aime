import { describe, it, expect } from 'vitest';
import { getTheme, DOCUMENT_THEMES, DEFAULT_THEME, themeIds } from './themes';

/**
 * `getTheme` is the only entry point, and its caller — the DocumentCreate tool —
 * declares `theme` as a free-form `z.string()`. So it receives whatever the model
 * emits, and "anything unknown falls back to report" has to be literally true.
 */
describe('getTheme', () => {
  it('returns the requested theme', () => {
    for (const id of themeIds()) expect(getTheme(id).id).toBe(id);
  });

  it('falls back to the default for an unknown or non-string id', () => {
    for (const id of ['nonsense', '', undefined, null, 42, {}, [], Symbol('x')]) {
      expect(getTheme(id).id, String(id)).toBe(DEFAULT_THEME);
    }
  });

  /**
   * The guard was `id in DOCUMENT_THEMES`, and `in` walks the prototype chain. So
   * 'constructor' resolved to Object's constructor and 'toString' to a function,
   * both returned as if they were themes: `renderDocument({ theme: 'constructor' })`
   * threw "Cannot read properties of undefined (reading 'size')" reading
   * `theme.page.size`, and `printOptionsForTheme` threw on `marginMm`.
   */
  it.each(['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf'])(
    'treats the prototype key %s as unknown, not as a theme',
    (key) => {
      const theme = getTheme(key);
      expect(theme.id).toBe(DEFAULT_THEME);
      // The shape every caller depends on, which the prototype leak did not have.
      expect(typeof theme.page.size).toBe('string');
      expect(typeof theme.page.marginMm).toBe('number');
      expect(typeof theme.css).toBe('string');
      expect(typeof theme.pageNumbers).toBe('boolean');
      expect(theme).toBe(DOCUMENT_THEMES[DEFAULT_THEME]);
    },
  );

  it('is not fooled by a case variant or surrounding whitespace either', () => {
    // Not a bug being fixed — just pinning that the lookup is exact, so the
    // fallback is the only other outcome.
    expect(getTheme(' report').id).toBe(DEFAULT_THEME);
    expect(getTheme('REPORT').id).toBe(DEFAULT_THEME);
  });
});
