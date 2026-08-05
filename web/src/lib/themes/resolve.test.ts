import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { resolveDeckTheme, themeInstruction } from './resolve';

/**
 * Precedence, and the wiring that makes a silent default acceptable.
 *
 * Two things had to be true at once: the design applies without being asked for
 * (the explicit request), and the user can always tell which one was used and
 * where to change it (the condition that makes the first one honest rather than
 * the app having an opinion you cannot see).
 */

describe('resolveDeckTheme', () => {
  it('is null when nothing is set — the skill then picks per brief', () => {
    expect(resolveDeckTheme({})).toBeNull();
    expect(resolveDeckTheme({ projectTheme: null, globalTheme: null })).toBeNull();
  });

  it('uses the global default when that is all there is', () => {
    expect(resolveDeckTheme({ globalTheme: 'swiss-grid' })).toEqual({
      id: 'swiss-grid',
      source: 'global',
    });
  });

  /**
   * The reason both scopes exist. Someone with a project per client should get
   * that client's look without saying so each time — a project silently
   * inheriting another one's design is the failure this prevents.
   */
  it('a project beats the global default', () => {
    const r = resolveDeckTheme({ projectTheme: 'bauhaus', globalTheme: 'swiss-grid' });
    expect(r).toEqual({ id: 'bauhaus', source: 'project' });
  });

  it('an explicit request beats both', () => {
    const r = resolveDeckTheme({
      requestTheme: 'nord',
      projectTheme: 'bauhaus',
      globalTheme: 'swiss-grid',
    });
    expect(r).toEqual({ id: 'nord', source: 'request' });
  });

  it('treats blank strings as unset rather than as a theme named ""', () => {
    expect(resolveDeckTheme({ projectTheme: '  ', globalTheme: 'nord' })?.id).toBe('nord');
    expect(resolveDeckTheme({ globalTheme: '   ' })).toBeNull();
  });
});

describe('themeInstruction', () => {
  it('says nothing when no theme is resolved', () => {
    expect(themeInstruction(null)).toBe('');
  });

  it('names the theme and the exact stylesheet to point at', () => {
    const out = themeInstruction({ id: 'swiss-grid', source: 'global' });
    expect(out).toContain('swiss-grid');
    expect(out).toContain('~/.claude/plugins/html-deck/assets/themes/swiss-grid.css');
    expect(out).toContain('theme-link');
  });

  /**
   * The half that makes "applies silently" defensible. A default the user never
   * chose has to be traceable, so the model is told to say which design it used
   * and where to change it.
   */
  it('asks the model to disclose the design and where to change it', () => {
    for (const source of ['global', 'project'] as const) {
      const out = themeInstruction({ id: 'nord', source });
      expect(out, source).toMatch(/Customize → Design/);
      expect(out, source).toMatch(/which design was used/i);
    }
  });

  /** Once, not every reply — the user asked for a message, not a running commentary. */
  it('tells it to say so once rather than repeatedly', () => {
    expect(themeInstruction({ id: 'nord', source: 'global' })).toMatch(/once, not on every reply/i);
  });

  /**
   * No disclosure when the user named the theme themselves — telling someone
   * what they just asked for, and where to change it, is noise.
   */
  it('stays quiet about provenance when the request named the theme', () => {
    const out = themeInstruction({ id: 'nord', source: 'request' });
    expect(out).toContain('nord');
    expect(out).not.toMatch(/Customize → Design/);
  });

  it('distinguishes a project design from the global one', () => {
    expect(themeInstruction({ id: 'a', source: 'project' })).toMatch(/this project's design/);
    expect(themeInstruction({ id: 'a', source: 'global' })).toMatch(/the default design/);
  });
});

describe('the resolved theme actually reaches the agent', () => {
  /**
   * `searchSettings` was plumbed through the route and the provider while no
   * client populated it, so the feature was inert and only the Settings "Test"
   * button — which built its own payload — appeared to work. Same shape of
   * mistake is available here, so it is checked rather than remembered.
   */
  const read = (p: string) => readFileSync(resolvePath(process.cwd(), p), 'utf-8');

  it.each([
    'src/components/surfaces/cowork/cowork-surface.tsx',
    'src/components/surfaces/code/code-surface.tsx',
  ])('%s sends deckTheme with the turn', (file) => {
    const src = read(file);
    expect(src, 'surface does not resolve the theme').toContain('useDeckTheme');
    expect(src, 'surface resolves it but never sends it').toMatch(/deckTheme,/);
  });

  it('the stream hook forwards it to the route', () => {
    expect(read('src/hooks/use-sse-stream.ts')).toMatch(/deckTheme: extra\.deckTheme/);
  });

  it('the provider turns it into a system-prompt instruction', () => {
    expect(read('src/lib/providers/claude-provider.ts')).toMatch(/themeInstruction\(/);
  });
});

describe('Design is reachable in the UI', () => {
  /**
   * Customize has TWO entry points — landing cards and a persistent left rail —
   * and the first version of this only touched the cards. The rail is what
   * someone uses after their first visit, so a section missing from it is a
   * feature you can only find by going back to a page you have already left.
   */
  const read = (p: string) =>
    readFileSync(resolvePath(process.cwd(), p), 'utf-8');

  it('appears in the Customize left rail', () => {
    expect(read('src/components/layout/sidebar-customize.tsx')).toMatch(
      /setCustomizeSection\("design"\)/,
    );
  });

  it('appears on the Customize landing page', () => {
    expect(read('src/components/customize/customize-view.tsx')).toMatch(/section: "design"/);
  });

  it('renders the panel when selected', () => {
    expect(read('src/components/customize/customize-view.tsx')).toMatch(
      /customizeSection === "design"[\s\S]{0,80}DesignPanel/,
    );
  });
});
