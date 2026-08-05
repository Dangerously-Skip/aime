import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseSkillMd } from '@/lib/skill-parser';

/**
 * Same guard as `html-deck.test.ts`, for a set vendored under a DIFFERENT
 * licence — and that difference is the first thing worth protecting.
 *
 * `design-templates/html-ppt` carries its own MIT file. These directories carry
 * none, so they fall under the repository's Apache-2.0. Filing both under one
 * LICENSE would misstate both, so they live apart and each ships the licence
 * that actually applies. A future tidy-up that merges the two directories would
 * be a licensing error dressed as housekeeping, which is exactly the kind of
 * change a test should be standing in front of.
 */

const ROOT = path.resolve(__dirname, '../../../resources/web-templates');
const SKILLS = path.resolve(__dirname, '../../../resources/aime-skills/skills');

const readSkill = (name: string) =>
  fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf-8');

const WIREFRAMES = ['greybox', 'sketch', 'annotated', 'mobile-flow'];
const TASTES = ['brutalist', 'editorial', 'soft'];

describe('provenance and licence', () => {
  it('ships the Apache-2.0 licence these were taken under', () => {
    const licence = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf-8');
    expect(licence).toMatch(/Apache License/);
    expect(licence).toMatch(/Version 2\.0/);
  });

  /**
   * The two vendored sets must not be conflated. If html-deck ever stops
   * carrying MIT, or this one stops carrying Apache, someone has merged them.
   */
  it('is licensed separately from the MIT html-deck set', () => {
    const mit = fs.readFileSync(
      path.resolve(__dirname, '../../../resources/html-deck/LICENSE'),
      'utf-8',
    );
    expect(mit).toMatch(/MIT License/);
    expect(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf-8')).not.toMatch(/MIT License/);
  });

  it('records the source, the modifications, and the onward attribution', () => {
    const prov = fs.readFileSync(path.join(ROOT, 'PROVENANCE.md'), 'utf-8');
    expect(prov).toMatch(/nexu-io\/open-design/);
    expect(prov).toMatch(/Apache-2\.0/);
    expect(prov, 'Apache-2.0 requires stating changes').toMatch(/Modification/i);
    // The brutalist taste credits Leonxlnx upstream of open-design; attribution
    // that stops at the most recent hand is not attribution.
    expect(prov).toMatch(/Leonxlnx/);
  });
});

describe('every file the skills promise exists', () => {
  it.each(WIREFRAMES)('wireframe-%s ships an example', (mode) => {
    expect(fs.existsSync(path.join(ROOT, `wireframe-${mode}/example.html`))).toBe(true);
  });

  it.each(TASTES)('taste-%s ships an example', (taste) => {
    expect(fs.existsSync(path.join(ROOT, `taste-${taste}/example.html`))).toBe(true);
  });

  it.each([
    'web-prototype/assets/template.html',
    'web-prototype/references/layouts.md',
    'web-prototype/references/checklist.md',
  ])('%s is present', (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel)), `missing ${rel}`).toBe(true);
  });

  /**
   * These are standalone by design — unlike html-deck, nothing here links a
   * shared stylesheet. A relative reference to a sibling would break the moment
   * the file is copied somewhere else, which is the entire usage pattern.
   */
  it('every example is self-contained', () => {
    const htmls = [
      ...WIREFRAMES.map((m) => `wireframe-${m}/example.html`),
      ...TASTES.map((t) => `taste-${t}/example.html`),
      'web-prototype/assets/template.html',
    ];
    for (const rel of htmls) {
      const html = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      expect(html, `${rel} links a sibling file`).not.toMatch(/(?:href|src)="\.\.\//);
    }
  });
});

describe('the skills describe what is actually there', () => {
  it.each(['wireframe', 'web-prototype'])('%s is well formed and bounded', (name) => {
    const fm = parseSkillMd(readSkill(name)).frontmatter;
    expect(fm.name).toBe(name);
    // The brand-guidelines lesson: a description that only says what a skill is
    // for gets matched by anything adjacent.
    expect(String(fm.description)).toMatch(/Not for/);
  });

  it('wireframe names every mode that exists, and none that does not', () => {
    const text = readSkill('wireframe');
    for (const m of WIREFRAMES) expect(text, `does not offer ${m}`).toMatch(new RegExp(m));
  });

  it('web-prototype names every taste that exists', () => {
    const text = readSkill('web-prototype');
    for (const t of TASTES) expect(text, `does not offer ${t}`).toMatch(new RegExp(t));
  });

  /**
   * The expectation-setting that stops this being reported as broken: these are
   * three fixed designs, not the deck system's 36 swappable token files. Someone
   * arriving from `deck-html` will look for a theme file and there isn't one.
   */
  it('web-prototype says plainly that it is not the deck theme system', () => {
    const text = readSkill('web-prototype');
    expect(text).toMatch(/not the deck system|are NOT/i);
    expect(text).toMatch(/deck-html/);
  });

  it.each(['wireframe', 'web-prototype'])('%s points at the installed path', (name) => {
    expect(readSkill(name)).toMatch(/~\/\.claude\/plugins\/web-templates/);
  });

  /**
   * Fidelity is the whole distinction between these two skills. If either stops
   * saying when NOT to use it, they will be picked interchangeably and the
   * wireframe will be used for things meant to look finished.
   */
  it('the two skills hand off to each other', () => {
    expect(readSkill('wireframe')).toMatch(/web-prototype|craft-web/);
    expect(readSkill('web-prototype')).toMatch(/wireframe/);
  });
});
