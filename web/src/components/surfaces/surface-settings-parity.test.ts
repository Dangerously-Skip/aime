import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every surface must send the settings half of a turn.
 *
 * This has gone wrong twice, in two different ways, and both were invisible
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
 * The fix is structural: ONE builder (`useTurnSettings`) makes the settings
 * half, every surface spreads it into its request, and the ONE turn path sends
 * every request it is given. The behavioural halves are in the surfaces'
 * stream tests; this pins the structure so a surface cannot quietly build its
 * own again.
 */

const SURFACES = ['chat', 'code', 'cowork', 'browser'] as const;

/** Settings that are LOST outright if the request omits them. */
const REQUIRED = ['deckTheme', 'searchSettings', 'securitySettings'] as const;

const read = (rel: string) =>
  fs.readFileSync(path.resolve(process.cwd(), 'src', rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
const surfaceSrc = (name: string) => read(`components/surfaces/${name}/${name}-surface.tsx`);

describe('surfaces send the same settings', () => {
  const builder = read('hooks/use-turn-settings.ts');

  it.each(REQUIRED)('the shared builder carries %s', (field) => {
    const returned = /return useMemo\(\s*\(\) => \(\{([\s\S]*?)\}\),/.exec(builder)?.[1] ?? '';
    expect(returned, 'useTurnSettings no longer returns its object literal').not.toBe('');
    expect(returned).toMatch(new RegExp(`\\b${field}\\b\\s*[,:]`));
  });

  /**
   * A theme only reaches the model if one is resolved — reading the store
   * directly would miss the project-level override, which is why there is a
   * hook — and search the same.
   */
  it('the builder resolves the theme and search through the shared hooks', () => {
    expect(builder).toMatch(/useDeckTheme\(chatId\)/);
    expect(builder).toMatch(/useSearchSettings\(\)/);
  });

  it.each(SURFACES)('%s builds its request on the shared settings', (surface) => {
    const src = surfaceSrc(surface);
    expect(src).toMatch(/const settings = useTurnSettings\(chatId/);
    // Spread in the request builder, not re-listed field by field.
    const request = /\brequest:\s*(async\s*)?\([^)]*\)\s*=>[\s\S]*?\n {4}\},?\n|\brequest:\s*(async\s*)?\([^)]*\)\s*=>\s*\(\{[\s\S]*?\}\),/.exec(src)?.[0] ?? '';
    expect(request, `${surface} has no request builder`).not.toBe('');
    expect(request).toContain('...settings');
    for (const field of REQUIRED) {
      expect(request, `${surface} re-lists ${field}, which is how one site forgets it`).not.toMatch(
        new RegExp(`^\\s*${field}[,:]`, 'm'),
      );
    }
  });

  it('the shared turn sends the whole request it was given', () => {
    const hook = read('hooks/use-surface-turn.tsx');
    expect(hook).toMatch(/const base = cfg\.request \? await cfg\.request\(input\) : \{\};/);
    expect(hook).toMatch(/extra: \{ \.\.\.base, \.\.\.extra \}/);
    expect(hook).toMatch(/\{\s*\.\.\.turn\.extra,/);
  });
});
