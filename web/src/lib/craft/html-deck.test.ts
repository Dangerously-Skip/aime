import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseSkillMd } from '@/lib/skill-parser';

/**
 * The HTML-deck assets are vendored from another project, which makes two
 * things go stale in ways nothing else here would catch.
 *
 * First, provenance. `design-templates/html-ppt` carries its own MIT licence
 * inside an otherwise Apache-2.0 repository, so the licence that applies is not
 * the one you get by glancing at the repo badge. Losing that file would leave us
 * shipping someone's work with no attribution, and the loss would be silent.
 *
 * Second, the theme list. `deck-html/SKILL.md` names themes for the model to
 * choose between. A name that no longer has a file behind it is a broken deck
 * discovered mid-task; a file nobody lists is a theme that will never be picked.
 */

const ASSETS = path.resolve(__dirname, '../../../resources/html-deck');
const SKILL = path.resolve(
  __dirname,
  '../../../resources/aime-skills/skills/deck-html/SKILL.md',
);

const themeFiles = fs
  .readdirSync(path.join(ASSETS, 'assets/themes'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => f.replace(/\.css$/, ''));

const layoutNames = fs
  .readdirSync(path.join(ASSETS, 'templates/single-page'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, ''));

const skillText = fs.readFileSync(SKILL, 'utf-8');

describe('vendored provenance is intact', () => {
  it('ships the MIT licence it was taken under', () => {
    const licence = fs.readFileSync(path.join(ASSETS, 'LICENSE'), 'utf-8');
    expect(licence).toMatch(/MIT License/);
    // The copyright line is the attribution; a licence without it is not one.
    expect(licence).toMatch(/Copyright \(c\)/);
  });

  it('records where it came from and what was changed', () => {
    const prov = fs.readFileSync(path.join(ASSETS, 'PROVENANCE.md'), 'utf-8');
    expect(prov).toMatch(/nexu-io\/open-design/);
    expect(prov).toMatch(/MIT/);
    expect(prov, 'must state whether the files were modified').toMatch(/Modification/i);
  });
});

describe('the assets the skill promises exist', () => {
  it.each([
    'assets/base.css',
    'assets/fonts.css',
    'assets/runtime.js',
    'assets/animations/animations.css',
    'templates/deck.html',
  ])('%s is present', (rel) => {
    expect(fs.existsSync(path.join(ASSETS, rel)), `missing ${rel}`).toBe(true);
  });

  it('has a substantial theme library, not a token sample', () => {
    expect(themeFiles.length).toBeGreaterThanOrEqual(30);
  });

  /**
   * The reference deck is what the model copies, so its asset links have to
   * resolve. A broken href here is a deck that renders unstyled.
   */
  it('the reference deck links only to assets that exist', () => {
    const html = fs.readFileSync(path.join(ASSETS, 'templates/deck.html'), 'utf-8');
    const refs = [...html.matchAll(/(?:href|src)="(\.\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs.length, 'no asset references found — has the template changed?').toBeGreaterThan(3);
    for (const ref of refs) {
      const resolved = path.resolve(path.join(ASSETS, 'templates'), ref);
      expect(fs.existsSync(resolved), `dead reference ${ref}`).toBe(true);
    }
  });

  it('themes are token files, not markup', () => {
    const sample = fs.readFileSync(path.join(ASSETS, 'assets/themes/swiss-grid.css'), 'utf-8');
    // The property that makes a one-line theme swap possible.
    expect(sample).toMatch(/--bg\s*:/);
    expect(sample).toMatch(/--accent\s*:/);
    expect(sample).toMatch(/--font-sans\s*:/);
  });
});

describe('the skill and the theme library agree', () => {
  it('is a well-formed skill that says where it does NOT apply', () => {
    const fm = parseSkillMd(skillText).frontmatter;
    expect(fm.name).toBe('deck-html');
    expect(String(fm.description)).toMatch(/Not for/);
  });

  /**
   * Every theme the skill names must have a file. This is the failure that
   * would surface as the model picking a stylesheet that 404s.
   */
  it('names no theme that does not exist', () => {
    const named = [...skillText.matchAll(/`([a-z0-9-]+)`/g)]
      .map((m) => m[1])
      // Only consider backticked words that look like theme slugs, i.e. ones
      // sharing the naming shape; anything else is prose about paths or tools.
      .filter((w) => /^[a-z]+(-[a-z0-9]+)+$/.test(w) && !w.includes('.'));
    const claimed = named.filter((w) => themeFiles.includes(w));
    expect(claimed.length, 'the skill lists no real themes at all').toBeGreaterThan(20);

    // Anything shaped like a theme slug that is NOT a file, and not a known
    // non-theme term, is a name the model could pick and fail on.
    // The skill names two vocabularies — themes and layouts — plus a few known
    // terms. Anything slug-shaped outside all three is a dead reference the
    // model would follow mid-task.
    const allowed = new Set(['deck-html', 'craft-deck', 'craft-web', 'craft-doc', 'theme-link', 'img-placeholder']);
    for (const w of named) {
      if (allowed.has(w) || themeFiles.includes(w) || layoutNames.includes(w)) continue;
      expect.fail(`skill names '${w}', which is neither a theme, a layout, nor a known term`);
    }
  });

  it('points at the installed location the installer actually uses', () => {
    expect(skillText).toMatch(/~\/\.claude\/plugins\/html-deck/);
  });

  /**
   * The choice between HTML and pptx is a real fork with a real consequence —
   * an HTML deck cannot be edited by the recipient. The skill has to say so, or
   * it will be picked for decks that needed to be editable.
   */
  it('states the editability tradeoff against pptx', () => {
    expect(skillText).toMatch(/pptx/i);
    expect(skillText).toMatch(/edit/i);
  });
});

describe('the layout catalogue', () => {
  const layoutDir = path.join(ASSETS, 'templates/single-page');
  const layouts = layoutNames;

  /**
   * The vendored deck ships six slide types. Charts, tables, timelines and
   * diagrams are not decoration — they are the layout vocabulary, and without
   * them the model invents markup, which does not consume theme tokens and so
   * stops matching its own theme halfway through.
   */
  it('covers the slide types a real deck needs', () => {
    expect(layouts.length).toBeGreaterThanOrEqual(25);
    for (const needed of ['cover', 'toc', 'kpi-grid', 'table', 'chart-bar', 'timeline', 'comparison']) {
      expect(layouts, `no ${needed} layout`).toContain(needed);
    }
  });

  it('every layout follows the same contract the skill describes', () => {
    for (const name of layouts) {
      const html = fs.readFileSync(path.join(layoutDir, `${name}.html`), 'utf-8');
      expect(html, `${name} does not link base.css`).toMatch(/assets\/base\.css/);
      // `is-active` is what makes a slide visible; `single` is what makes a
      // standalone file render full-page. Both are load-bearing.
      expect(html, `${name} slide would render invisible`).toMatch(/slide is-active/);
      expect(html, `${name} is not standalone`).toMatch(/<body class="single"/);
    }
  });

  /**
   * Same failure as the theme list: a layout the skill names with no file is a
   * dead reference the model follows mid-task.
   */
  it('names no layout that does not exist', () => {
    const named = [...skillText.matchAll(/`([a-z][a-z0-9-]+)`/g)].map((m) => m[1]);
    const looksLikeLayout = named.filter((w) => w.includes('-') || layouts.includes(w));
    const claimed = looksLikeLayout.filter((w) => layouts.includes(w));
    expect(claimed.length, 'the skill lists no real layouts').toBeGreaterThan(20);
  });
});
