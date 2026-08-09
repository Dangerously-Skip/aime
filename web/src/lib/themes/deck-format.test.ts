import { describe, it, expect } from 'vitest';
import { allowedPluginPaths, asksForPptx } from './deck-format';

/**
 * The fourth attempt at one bug, and the first that is a mechanism.
 *
 * Reported symptom, three times over: pick a design in Customize → Design, ask
 * for a deck, receive a plain unstyled `.pptx`. Three real causes were found and
 * each was genuinely fixed —
 *
 *   1. the instruction described a stylesheet link but never steered the FORMAT
 *   2. the auto-continue path hand-copied the request and dropped `deckTheme`
 *   3. a fall-through in the prompt assembly discarded the note when there was
 *      no prompt to append it to
 *
 * — and it still happened, because what remained was prose. The system prompt
 * said "do NOT reach for the pptx workflow" while the `ppt` plugin sat there
 * offering `ppt:generate-ppt`, and the model, reached through OpenRouter, was
 * under no obligation to read carefully.
 *
 * This codebase has drawn the same conclusion twice before — the security
 * toggles that filtered an auto-approve list, and the rule telling the model not
 * to guess URLs. A claim with no mechanism behind it is not a control.
 */

const PLUGINS = [
  '/Users/x/.claude/plugins/aime-skills',
  '/Users/x/.claude/plugins/html-deck',
  '/Users/x/.claude/plugins/ppt',
  '/Users/x/.claude/plugins/web-templates',
];

const names = (paths: string[]) => paths.map((p) => p.split('/').pop());

describe('a chosen theme withholds the pptx plugin', () => {
  it('removes it, rather than discouraging it', () => {
    const got = allowedPluginPaths(PLUGINS, 'magazine-bold', 'build me a slide deck');
    expect(names(got), 'ppt is still on offer').not.toContain('ppt');
  });

  it('keeps everything else, including the HTML deck assets', () => {
    const got = allowedPluginPaths(PLUGINS, 'magazine-bold', 'build me a slide deck');
    expect(names(got)).toEqual(['aime-skills', 'html-deck', 'web-templates']);
  });

  /**
   * The exact request that has been failing. If the phrase "slide deck" were
   * read as asking for PowerPoint, the mechanism would switch itself off for the
   * one case it exists to handle.
   */
  it.each([
    'search for the best burger places in western sydney and build me a slide deck presenting the results',
    'make me a deck about pizza',
    'I want the same deck but styled to my new settings',
    'build a presentation of the results',
  ])('treats %s as a deck request, not a PowerPoint request', (prompt) => {
    expect(asksForPptx(prompt), 'read as a pptx request').toBe(false);
    expect(names(allowedPluginPaths(PLUGINS, 'magazine-bold', prompt))).not.toContain('ppt');
  });
});

/**
 * Naming the format is the one case where the user's words should win. Refusing
 * an explicit "make me a PowerPoint" because a theme happens to be set would
 * trade one wrong default for another.
 */
describe('asking for PowerPoint by name still works', () => {
  it.each([
    'make me a PowerPoint of these results',
    'export it as a pptx',
    'I need an editable presentation for the team to update',
    'can you do it in Keynote format',
  ])('%s keeps the plugin', (prompt) => {
    expect(asksForPptx(prompt)).toBe(true);
    expect(names(allowedPluginPaths(PLUGINS, 'magazine-bold', prompt))).toContain('ppt');
  });
});

/**
 * No theme means the user has expressed no preference, so the model choosing
 * pptx is a legitimate choice rather than a discarded one. Withholding it here
 * would be this feature overreaching.
 */
describe('no theme, no opinion', () => {
  it('leaves the plugin list alone', () => {
    expect(allowedPluginPaths(PLUGINS, null, 'build me a deck')).toEqual(PLUGINS);
    expect(allowedPluginPaths(PLUGINS, undefined, 'build me a deck')).toEqual(PLUGINS);
  });
});

describe('edges', () => {
  it('survives a missing prompt', () => {
    expect(names(allowedPluginPaths(PLUGINS, 'aurora', null))).not.toContain('ppt');
    expect(names(allowedPluginPaths(PLUGINS, 'aurora', undefined))).not.toContain('ppt');
  });

  it('matches the directory name, not a path that merely contains it', () => {
    // `/plugins/ppt-helper` is a different plugin and must survive.
    const withDecoy = [...PLUGINS, '/Users/x/.claude/plugins/ppt-helper'];
    expect(names(allowedPluginPaths(withDecoy, 'aurora', 'a deck'))).toContain('ppt-helper');
  });

  it('tolerates a trailing slash on a plugin path', () => {
    expect(
      names(allowedPluginPaths(['/Users/x/.claude/plugins/ppt/'], 'aurora', 'a deck')),
    ).toEqual([]);
  });

  it('does not mutate the list it was given', () => {
    const copy = [...PLUGINS];
    allowedPluginPaths(PLUGINS, 'aurora', 'a deck');
    expect(PLUGINS).toEqual(copy);
  });
});
