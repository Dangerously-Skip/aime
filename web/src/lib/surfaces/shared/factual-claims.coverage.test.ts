import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getSurfaceConfig } from '../index';
import { FACTUAL_CLAIMS_PROMPT } from './factual-claims';

/**
 * EVERY SURFACE THAT RESEARCHES MUST CARRY THE SOURCING RULE.
 *
 * A real run produced a confident table of camera market values recalled from
 * the model's own weights — never searched for, wrong by three to four times —
 * and everything downstream was computed from it. The ROI ranking that was the
 * point of the task was worthless, and nothing in the output said so.
 *
 * It happened on Code, but Browser and Cowork do the same kind of research, so
 * a rule that lives in one prompt is a rule that fails on the other two. The
 * surface list here is DERIVED from the registry rather than typed out, so a new
 * agent surface cannot ship without an answer to this.
 */

const SRC = path.join(process.cwd(), 'src');

/** Surfaces that run a research-capable agent, derived from their tool lists. */
function researchSurfaces(): string[] {
  const dir = path.join(SRC, 'lib/surfaces');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('-config.ts'))
    .map((f) => f.replace('-config.ts', ''))
    .filter((id) => {
      // "Can it reach the web?" is the test — that is when a sourced number is
      // possible, and therefore when an unsourced one is a choice.
      const cfg = getSurfaceConfig(id);
      const tools = (cfg?.allowedTools ?? []) as string[];
      return tools.some((t) => /SearchWeb|web_search|FetchUrl|WebFetch/.test(t));
    });
}

const promptOf = (id: string): string => {
  const sp = getSurfaceConfig(id)?.systemPrompt;
  if (!sp) return '';
  return typeof sp === 'string' ? sp : ((sp as { append?: string }).append ?? '');
};

describe('the sourcing rule reaches every research surface', () => {
  it('finds the surfaces, so the checks below are not vacuous', () => {
    const found = researchSurfaces();
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found).toEqual(expect.arrayContaining(['browser', 'code', 'cowork']));
  });

  it.each(researchSurfaces())('%s carries it', (id) => {
    // The whole fragment, not a paraphrase — one wording, one place to change.
    expect(promptOf(id)).toContain(FACTUAL_CLAIMS_PROMPT);
  });
});

describe('what the rule actually says', () => {
  it('names the categories that go stale', () => {
    for (const word of ['Prices', 'market values', 'statistics', 'version numbers']) {
      expect(FACTUAL_CLAIMS_PROMPT).toContain(word);
    }
  });

  it('asks for the source, not just the number', () => {
    expect(FACTUAL_CLAIMS_PROMPT).toMatch(/say where it came from/i);
  });

  it('gives words for "I could not verify this"', () => {
    /*
     * The load-bearing half. Told only to look things up, a model that fails to
     * find a price will still produce one — it needs a sanctioned way to say it
     * does not know, or it will fill the gap.
     */
    expect(FACTUAL_CLAIMS_PROMPT).toMatch(/unverified/i);
    expect(FACTUAL_CLAIMS_PROMPT).toMatch(/could not (find|source)/i);
  });

  it('extends the doubt to conclusions built on unsourced numbers', () => {
    // The camera failure: the ranking, not just the prices, was the guess.
    expect(FACTUAL_CLAIMS_PROMPT).toMatch(/a ranking built on guesses is a guess/i);
  });

  it('does not claim to be enforced', () => {
    /*
     * This repo's standard: a control is only "enforced" if disabling it fails a
     * test. Nothing here refuses a turn, and the file must not imply otherwise —
     * four security toggles once shipped claiming enforcement they did not have.
     */
    const src = fs.readFileSync(path.join(SRC, 'lib/surfaces/shared/factual-claims.ts'), 'utf8');
    // Tolerant of comment wrapping — the claim matters, not the line breaks.
    expect(src.replace(/\s*\*\s*/g, ' ')).toMatch(/prompt is guidance, not a gate/i);
  });
});
