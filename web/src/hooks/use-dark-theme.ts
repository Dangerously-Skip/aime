'use client';

import { useEffect, useState } from 'react';
import { isDarkFromClasses } from '@/lib/themes/app-themes';

/**
 * Is the app currently showing a dark theme?
 *
 * Reads the class on <html> rather than the store, because that is what these
 * callers need: they hand a light/dark flag to a third-party widget (dockview,
 * highlight.js, a diff view) and must react when the class changes, including
 * the pre-hydration script setting it before React exists.
 *
 * Extracted because the same `MutationObserver` effect was written twice, and
 * both copies tested `classList.contains('dark')` literally. That is right for
 * exactly the themes that existed when it was written: Max is dark and carries
 * its own class, so both would have handed it the LIGHT widget theme —
 * light-on-navy syntax highlighting and a light editor chrome. The registry
 * knows which themes are dark; the DOM only knows which class is set.
 */
export function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;

    /**
     * `matchMedia` is not universal. jsdom does not implement it, and the code
     * this hook replaced never called it — so reaching for it unguarded turned
     * a theme refactor into six failing tests in an unrelated renderer. An
     * environment without it still has a class on <html>, which answers the
     * question for every theme except `system`; treating that as "not dark" is
     * the same answer the old code gave.
     */
    const media =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const compute = () => setIsDark(isDarkFromClasses(html.classList, media?.matches ?? false));
    compute();

    // The class changes when the user picks a theme; the media query changes
    // when the OS flips and the theme is `system`, which sets no class of its
    // own — so watching only the class would miss it.
    const obs = new MutationObserver(compute);
    obs.observe(html, { attributes: true, attributeFilter: ['class'] });
    media?.addEventListener('change', compute);
    return () => {
      obs.disconnect();
      media?.removeEventListener('change', compute);
    };
  }, []);

  return isDark;
}
