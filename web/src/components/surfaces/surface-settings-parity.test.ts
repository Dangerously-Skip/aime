import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every surface must send the settings half of a turn.
 *
 * This has now gone wrong twice, in two different ways, and both were invisible
 * because the missing field degrades to a plausible default rather than an
 * error:
 *
 *   1. Cowork's auto-continue and background-run paths hand-built their payload
 *      and had drifted to omit EIGHT fields, `deckTheme` among them — so a
 *      continued turn ran as a differently-configured user.
 *   2. Chat never sent `deckTheme`, `searchSettings` or `securitySettings` at
 *      all. Every deck it produced came back as an unstyled pptx, because the
 *      HTML-deck steering is gated on a theme being set, and search resolved to
 *      `none`. The server said so on every request and nobody was reading:
 *
 *        [Claude] No deck theme on this request — pptx stays available…
 *        [Claude] aime tools: icloud=yes search=none
 *
 * Only `securitySettings` had a server-side fallback, which is exactly why the
 * other two went unnoticed for days.
 */

const SURFACES = ['chat', 'code', 'cowork'] as const;

/** Settings that are LOST outright if the request omits them. */
const REQUIRED = ['deckTheme', 'searchSettings', 'securitySettings'] as const;

const surfaceSrc = (name: string) =>
  fs.readFileSync(
    path.resolve(process.cwd(), `src/components/surfaces/${name}/${name}-surface.tsx`),
    'utf-8',
  );

describe('surfaces send the same settings', () => {
  const cases = SURFACES.flatMap((s) => REQUIRED.map((f) => [s, f] as const));

  /**
   * Scoped to the `sendMessage` payloads, not the whole file. Searching the file
   * matched the useCallback DEPENDENCY ARRAY, where every one of these names
   * also appears — so removing a field from the request while leaving it in the
   * deps passed, which sabotage caught.
   */
  const payloads = (surface: string): string => {
    const src = surfaceSrc(surface).replace(/\/\*[\s\S]*?\*\//g, '');
    const bodies = [...src.matchAll(/sendMessage\([^)]*?,\s*\{([\s\S]*?)\n\s{6,14}\}\)/g)]
      .map((m) => m[1])
      .join('\n');
    /*
     * Follow the one legitimate indirection. Cowork spreads `...turnContext()`,
     * a single builder shared by its three send sites — the fix for the drift
     * described above — so the fields are genuinely sent, just not inline. A
     * test that could not see that would push someone to un-share the builder
     * to satisfy it, which is the opposite of the point.
     */
    if (!bodies.includes('...turnContext()')) return bodies;
    const builder = /const turnContext = useCallback\(\s*\(\) => \(\{([\s\S]*?)\}\),/.exec(src)?.[1] ?? '';
    return `${bodies}\n${builder}`;
  };

  it.each(cases)('%s sends %s', (surface, field) => {
    const body = payloads(surface);
    expect(body, `no sendMessage payload found in ${surface}`).not.toBe('');
    expect(
      body,
      `${surface} never sends ${field} — the model runs without it and the default looks deliberate`,
    ).toMatch(new RegExp(`\\b${field}\\b\\s*[,:]`));
  });

  /**
   * A theme only reaches the model if the surface resolves one. Reading the
   * store directly would miss the project-level override, which is why there is
   * a hook.
   *
   * Matched on the CALL, not on `useDeckTheme()` exactly: the hook now takes the
   * conversation id, because the project override was keyed on an
   * `activeProjectId` that nothing ever set. Pinning the empty argument list
   * pinned the shape of a signature rather than the rule being enforced.
   */
  it.each(SURFACES)('%s resolves the theme through the shared hook', (surface) => {
    expect(surfaceSrc(surface)).toMatch(/useDeckTheme\(/);
  });

  it.each(SURFACES)('%s resolves search through the shared hook', (surface) => {
    expect(surfaceSrc(surface)).toMatch(/useSearchSettings\(\)/);
  });
});
