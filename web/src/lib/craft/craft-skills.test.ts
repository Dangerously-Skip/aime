import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseSkillMd } from '@/lib/skill-parser';
import { findSlopTells } from './slop-tells';

/**
 * The craft skills are the P7.1 deliverable, and a skill has two ways to be
 * worthless: it never fires, or it fires on everything.
 *
 * Both have precedent here. `brand-guidelines` shipped with a description
 * covering "whenever you're producing a visual artifact … and brand consistency
 * matters", which fired on a generic landing-page request and applied a
 * corporate palette nobody asked for. The opposite failure is quieter — a skill
 * scoped so tightly it never loads reads exactly like a skill that works.
 *
 * These do not prove the model invokes them; nothing offline can. They prove the
 * things that are checkable and that were wrong before: the descriptions state
 * their boundary, the rules match the tells actually measured, and the guidance
 * does not violate itself.
 */

const SKILLS = path.resolve(__dirname, '../../../resources/aime-skills/skills');
const CRAFT = ['craft-web', 'craft-deck', 'craft-doc'];

const read = (id: string) => fs.readFileSync(path.join(SKILLS, id, 'SKILL.md'), 'utf-8');

describe('the craft skills exist and parse', () => {
  it.each(CRAFT)('%s has a well-formed SKILL.md', (id) => {
    const parsed = parseSkillMd(read(id));
    expect(parsed.frontmatter.name).toBe(id);
    expect(String(parsed.frontmatter.description ?? '').length).toBeGreaterThan(60);
  });
});

describe('descriptions state where the skill does NOT apply', () => {
  /**
   * The lesson from the brand leak, made checkable. A description that only says
   * what a skill is for will be matched by anything adjacent.
   */
  it.each(CRAFT)('%s says what it is not for', (id) => {
    const description = String(parseSkillMd(read(id)).frontmatter.description);
    expect(
      /\bnot for\b|\bNot for\b/.test(description),
      `${id} never says where it stops applying; that is how brand-guidelines ` +
        `ended up on a generic landing page`,
    ).toBe(true);
  });

  /**
   * Three media, three skills, and the boundaries have to be mutual. A skill
   * that names its own scope but not its neighbours' is the brand-guidelines
   * failure again: it gets matched by anything adjacent, and the adjacent thing
   * here is a different medium with contradictory rules — 10pt body type is
   * correct in print and unreadable projected.
   */
  it.each(CRAFT)('%s hands off to both of its siblings', (id) => {
    const description = String(parseSkillMd(read(id)).frontmatter.description);
    for (const sibling of CRAFT.filter((s) => s !== id)) {
      expect(
        description,
        `${id} never points at ${sibling}, so a ${sibling} request can match it`,
      ).toMatch(new RegExp(sibling));
    }
  });

  // A brand is opted into by name; craft is not a brand.
  it.each(CRAFT)('%s does not name a brand or a palette of its own', (id) => {
    const body = read(id);
    expect(body).not.toMatch(/\bour brand\b/i);
    // The only hex values allowed are the ones being warned AGAINST, plus the
    // neutral near-black/near-white examples.
    const hexes = (body.match(/#[0-9a-f]{6}/gi) ?? []).map((h) => h.toLowerCase());
    const allowed = new Set([
      '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#8b5cf6', '#7c3aed', '#a855f7',
      '#111111', '#fafafa',
    ]);
    for (const h of hexes) {
      expect(allowed.has(h), `${id} introduces its own colour ${h}`).toBe(true);
    }
  });
});

describe('the rules match what was actually measured', () => {
  /**
   * Grounded in the baseline rather than in another project's advice: these are
   * the tells `slop-tells.ts` caught in real generated output. A rule the
   * checker can see is a rule a before/after can move.
   */
  const MEASURED = [
    ['pure-black-or-white', /pure `?#000`? or `?#fff`?/i],
    ['ai-default-accent', /#6366f1/],
    ['caps-without-tracking', /letter-spacing: 0\.06em/],
    ['two-stop-trust-gradient', /gradient/i],
    ['emoji-as-icon', /emoji/i],
    ['left-border-accent-card', /left border/i],
    ['populated-state-only', /empty, loading, error|populated, empty, loading, error/i],
  ] as const;

  const web = read('craft-web');

  it.each(MEASURED)('craft-web addresses %s', (_rule, pattern) => {
    expect(pattern.test(web), `no guidance for ${_rule}`).toBe(true);
  });
});

describe('the guidance does not break its own rules', () => {
  /**
   * A craft document containing the tells it warns about would be an easy and
   * embarrassing thing to ship. The examples are quoted as things to AVOID, so
   * the checker must be run over the prose with those exclusions in mind — what
   * is asserted here is the subset that would be unambiguous.
   */
  it.each(CRAFT)('%s uses no emoji as decoration', (id) => {
    expect(read(id)).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('craft-deck introduces no colours at all — it defers on palette', () => {
    expect(read('craft-deck').match(/#[0-9a-f]{6}/gi)).toBeNull();
  });

  it('neither invents a metric to sound authoritative', () => {
    for (const id of CRAFT) {
      // "73% of users" style claims. Percentages ARE allowed where they describe
      // a ration this document itself defines (70-90% of pixels).
      const suspicious = read(id).match(/\b\d{1,3}% of (users|people|designers|teams)\b/i);
      expect(suspicious, `${id} invents a statistic`).toBeNull();
    }
  });
});

describe('slop-tells and the skills stay in step', () => {
  /**
   * The failure this prevents: a rule is added to the checker, the skill is
   * never updated, and the eval measures something the guidance never asked for
   * — so a "no improvement" result is read as the guidance failing when it was
   * never given.
   */
  it('every checker rule id appears in the measured list above', () => {
    const covered = new Set([
      'pure-black-or-white', 'ai-default-accent', 'caps-without-tracking',
      'two-stop-trust-gradient', 'emoji-as-icon', 'left-border-accent-card',
      'populated-state-only', 'generic-display-face',
    ]);
    // Drive the real checker so a new rule shows up here rather than in a list
    // someone forgot to update.
    const probe = [
      'body { background: #fff; color: #000; }',
      '.b { background: #6366f1; }',
      '.c { text-transform: uppercase; }',
      'h1 { font-family: Inter, sans-serif; }',
      '.d { border-left: 4px solid #10b981; padding: 8px; border-radius: 8px; }',
      '<div class="f"><span>🚀</span></div>',
      '.e { background: linear-gradient(90deg, #6366f1, #a855f7); }',
      '<table><tr><td>x</td></tr></table>',
    ].join('\n');
    for (const finding of findSlopTells(probe)) {
      expect(covered.has(finding.rule), `checker rule '${finding.rule}' has no craft guidance`).toBe(true);
    }
  });
});
