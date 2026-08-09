import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import * as fs from 'fs';
import { NextRequest } from 'next/server';
import * as path from 'path';
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

describe('the panel can be scrolled', () => {
  /**
   * The parent is `absolute inset-0 flex flex-col`, so a panel taller than the
   * viewport needs `flex-1 overflow-y-auto min-h-0`. `min-h-0` is the part that
   * is easy to omit and impossible to notice in a diff: without it a flex
   * child's implied `min-height: auto` holds it at content height, it grows past
   * the viewport, and `overflow-y-auto` never engages. The panel renders
   * perfectly and simply will not scroll — which is how it shipped, with 36
   * themes and only the first six reachable.
   */
  it('has the full trio, not just overflow-y-auto', () => {
    const src = readFileSync(
      resolvePath(process.cwd(), 'src/components/customize/design-panel.tsx'),
      'utf-8',
    );
    const scroller = src.match(/className="([^"]*overflow-y-auto[^"]*)"/);
    expect(scroller, 'no scroll container at all').toBeTruthy();
    expect(scroller![1], 'needs flex-1 to fill the column').toMatch(/flex-1/);
    expect(scroller![1], 'needs min-h-0 or overflow never engages').toMatch(/min-h-0/);
  });
});

describe('previews show the theme, not a redrawing of it', () => {
  /**
   * The first preview reimplemented a slide in React from parsed tokens and
   * used bg/text/border/accent/radius only — discarding `--grad` and
   * `--shadow`, which is where the character lives. `neo-brutalism` is a
   * `6px 6px 0 #000` offset shadow, `cyberpunk-neon` is a triple neon glow.
   * None of it survived, so 36 designs rendered as one layout in different
   * colours and were reported, correctly, as boring and samey.
   *
   * The fix is to stop redrawing: render the real base.css and the real theme
   * file. These assert that, because "looks varied" is not something a unit
   * test can see but "uses the actual stylesheet" is.
   */
  const panel = () =>
    readFileSync(
      resolvePath(process.cwd(), 'src/components/customize/design-panel.tsx'),
      'utf-8',
    );

  it('loads the real base and theme stylesheets', () => {
    const src = panel();
    expect(src).toMatch(/base\.css/);
    expect(src).toMatch(/themes\/\$\{id\}\.css/);
  });

  it('uses the deck’s own class names rather than bespoke markup', () => {
    const src = panel();
    for (const cls of ['deck', 'slide', 'kicker', 'h1', 'lede', 'card']) {
      expect(src, `preview does not use .${cls}`).toMatch(new RegExp(`class="[^"]*\\b${cls}\\b`));
    }
  });

  /**
   * Scaling rather than re-sizing: a preview that shrinks the type instead of
   * the slide is not showing you the theme's type scale.
   */
  /**
   * Scaling rather than re-sizing: a preview that shrinks the type instead of
   * the slide is not showing you the theme's type scale.
   *
   * And it must scale by a NUMBER. The obvious CSS-only version,
   * `transform:scale(calc(100vw / 1280))`, is invalid — scale() takes a
   * unitless number and calc() on a viewport unit yields a length, so the
   * declaration is dropped silently and the deck renders unscaled. The card
   * then shows the top-left corner of a 1280x720 slide whose content is
   * vertically centred, i.e. blank.
   */
  it('scales the deck by a measured number, not a CSS length', () => {
    const src = panel();
    // Strip comments first: the one explaining this bug necessarily quotes it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(code, 'scale() cannot take a length').not.toMatch(/scale\(calc\([^)]*vw/);
    expect(src, 'needs a measured factor').toMatch(/scale\(\$\{scale\}\)/);
    expect(src, 'cards are a responsive grid, so the factor must be observed').toMatch(
      /ResizeObserver/,
    );
  });

  /**
   * Driven through the REAL handler rather than asserted against its source.
   *
   * The previous version matched the literal string `endsWith('.css')`, which
   * pinned one implementation of the rule instead of the rule: widening the
   * route to also serve `runtime.js` — needed by the in-app deck viewer — broke
   * the test without changing anything it existed to protect. This is a
   * path-containment boundary, so it is worth exercising for real.
   */
  it.each([
    ['base.css', 200],
    ['themes/neo-brutalism.css', 200],
    // The viewer needs the deck's runtime for keyboard navigation.
    ['runtime.js', 200],
    // Still an allowlist, not a general file reader.
    ['../../../package.json', 404],
    ['../../package.json', 404],
    ['%2e%2e%2fpackage.json', 404],
    ['../../../../etc/passwd', 404],
    ['PROVENANCE.md', 404],
    /*
     * The case that isolates CONTAINMENT from the extension allowlist. Every
     * traversal above ends in a disallowed extension, so the allowlist catches
     * them and the containment check could be deleted with every test still
     * green — verified by sabotage, which is how this line came to exist.
     * `src/app/globals.css` is a real, readable .css OUTSIDE the assets tree:
     * only containment refuses it.
     */
    ['../../../src/app/globals.css', 404],
  ])('GET ?file=%s → %i', async (file, status) => {
    const { GET } = await import('@/app/api/themes/asset/route');
    const req = new NextRequest(
      `http://localhost/api/themes/asset?file=${encodeURIComponent(file)}`,
    );
    const res = await GET(req);
    expect(res.status, `${file} should be ${status}`).toBe(status);
  });
});

describe('the preview slide is actually visible', () => {
  /**
   * base.css ships `.slide{opacity:0}` and reveals the current slide with
   * `.slide.is-active`, which `runtime.js` adds. The preview does not load the
   * runtime — the iframe is sandboxed and scripts are blocked — so without the
   * class every card rendered as an empty coloured rectangle: the theme's
   * background and no content at all.
   *
   * Asserted against base.css rather than as a literal, so if upstream renames
   * the class this fails instead of silently going blank again.
   */
  it('carries whatever class base.css uses to reveal a slide', () => {
    const base = readFileSync(
      resolvePath(process.cwd(), 'resources/html-deck/assets/base.css'),
      'utf-8',
    );
    const reveal = base.match(/\.slide\.([a-z-]+)\s*\{[^}]*opacity\s*:\s*1/);
    expect(reveal, 'base.css no longer reveals slides via a class — preview needs rechecking').toBeTruthy();

    const panel = readFileSync(
      resolvePath(process.cwd(), 'src/components/customize/design-panel.tsx'),
      'utf-8',
    );
    expect(
      panel,
      `preview slide must carry .${reveal![1]} or it renders invisible`,
    ).toContain(`slide ${reveal![1]}`);
  });
});

/**
 * A theme that is chosen and then silently discarded.
 *
 * The user picked "Magazine Bold" in Customize → Design, asked for a deck, and
 * got a blank white pptx — "Double-click to edit" placeholders, no styling, and
 * Keynote warning that unsupported media had been removed. Nothing was broken in
 * the theme plumbing: `resolveDeckTheme` resolved it and the instruction reached
 * the model.
 *
 * The instruction just assumed the format. It said to point a
 * `<link id="theme-link">` at a CSS file, which means nothing unless an HTML deck
 * is what gets built — and the `ppt` plugin skill is a strong attractor for "make
 * me a deck". When it won, the theme applied to nothing and no one was told.
 *
 * So the instruction now steers the FORMAT, because that is the decision the
 * theme actually depends on.
 */
describe('a theme decides the format, not just the colours', () => {
  const withTheme = () => themeInstruction({ id: 'magazine-bold', source: 'global' });

  it('sends the model to the HTML deck skill', () => {
    expect(withTheme()).toMatch(/deck-html/);
  });

  it('says not to use pptx unless asked, and why', () => {
    const t = withTheme();
    expect(t).toMatch(/do NOT reach for the pptx/i);
    expect(t, 'does not explain that a theme cannot survive pptx').toMatch(
      /cannot be applied|silently discards/i,
    );
  });

  it('still names the theme file, so the deck is actually styled', () => {
    expect(withTheme()).toContain('magazine-bold.css');
  });

  it('says nothing at all when no theme is set', () => {
    // The `null` case is a real answer — the skill picks by brief. It must not
    // start steering format on the strength of a theme nobody chose.
    expect(themeInstruction(null)).toBe('');
  });
});

/**
 * "I would also like the system to add pictures or placeholders if a picture
 * isn't available." The placeholder half is the load-bearing one: an invented
 * image URL renders as a broken <img>, which reads as a bug rather than a gap.
 */
describe('pictures, or an honest gap', () => {
  const t = () => themeInstruction({ id: 'aurora', source: 'global' });

  it('points at the image layouts that already exist', () => {
    expect(t()).toMatch(/image-hero/);
    expect(t()).toMatch(/image-grid/);
  });

  it('forbids inventing an image URL', () => {
    expect(t()).toMatch(/never invent an image url/i);
  });

  it('gives the placeholder markup rather than describing it', () => {
    expect(t()).toContain('img-placeholder');
    // An unlabelled box tells the user nothing about what is missing.
    expect(t(), 'no aria-label in the example').toMatch(/aria-label/);
  });
});

/**
 * The prompt names a CSS class. If it does not exist, this is one more claim
 * with nothing behind it — the model emits the markup, the deck renders an
 * unstyled div, and everything still "passes".
 */
describe('the placeholder the prompt promises is real', () => {
  const base = fs.readFileSync(
    path.resolve(__dirname, '../../../resources/html-deck/assets/base.css'),
    'utf-8',
  );

  it('is defined in base.css', () => {
    expect(base, '.img-placeholder is referenced in the prompt but not defined').toMatch(
      /\.img-placeholder\s*\{/,
    );
  });

  /**
   * It has to inherit the deck's design, or a "themed" deck grows a grey box
   * that matches none of its 36 themes. Every token used here is asserted to
   * exist in every theme file — `--fg` was used first and exists in none.
   */
  it('is built only from tokens every theme defines', () => {
    const block = /\.img-placeholder\s*\{[\s\S]*?\}/.exec(base)?.[0] ?? '';
    const used = [...block.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]);
    expect(used.length, 'uses no theme tokens at all').toBeGreaterThan(2);

    const themeDir = path.resolve(__dirname, '../../../resources/html-deck/assets/themes');
    const themes = fs.readdirSync(themeDir).filter((f) => f.endsWith('.css'));
    for (const token of new Set(used)) {
      const defined = themes.filter((f) =>
        fs.readFileSync(path.join(themeDir, f), 'utf-8').includes(`--${token}:`),
      );
      expect(
        defined.length,
        `--${token} is used by .img-placeholder but defined in only ${defined.length}/${themes.length} themes`,
      ).toBe(themes.length);
    }
  });
});

/**
 * "Is there a way that I can from the chat select a different design, or have
 * the UI suggest alternatives — use the one from settings, suggestion 1,
 * suggestion 2?"
 *
 * There is: `AskUserQuestion` is in PLUMBING_TOOLS, so it is never withheld by a
 * tool profile. What was missing was any instruction to USE it — so when asked
 * to restyle, the model asked an open question back ("what settings did you
 * change?") and then regenerated the same unstyled deck.
 */
describe('changing the design from the conversation', () => {
  const t = () => themeInstruction({ id: 'magazine-bold', source: 'global' });

  it('tells the model to offer choices rather than ask an open question', () => {
    expect(t()).toMatch(/AskUserQuestion/);
    expect(t(), 'still sends the user to Settings to restyle one deck').toMatch(
      /do NOT ask them to open Settings/i,
    );
  });

  it('includes the current setting as one of the options', () => {
    const text = t();
    const idx = text.indexOf('AskUserQuestion');
    // The offer has to contain their existing theme, or "keep what I have" is
    // not on the menu and the picker becomes a forced change.
    expect(text.slice(idx, idx + 400)).toContain('magazine-bold');
  });

  it('asks for genuinely different alternatives, not three of the same kind', () => {
    expect(t()).toMatch(/differ from the current one in KIND|rather than three neighbours/i);
  });

  /**
   * A per-deck choice is not a settings change. Conflating them is how a user
   * ends up with a new house style they picked once for one deck.
   */
  it('says a one-off choice does not change their default', () => {
    expect(t()).toMatch(/does not change their default/i);
  });
});
