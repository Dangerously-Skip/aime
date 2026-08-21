import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getSurfaceConfig } from '../index';
import { FACTUAL_CLAIMS_PROMPT, browserToolsPrompt } from './factual-claims';

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

describe('the browser note appears only when the browser does', () => {
  /*
   * OBSERVED, not theorised: a Code run with the preview panel open was offered
   * the browser tools and barely used them — 5 navigate against 83 Bash and 19
   * FetchUrl, on a task entirely about reading listing pages. Registered,
   * permitted, working, and never mentioned in the prompt.
   *
   * The other half matters more. Naming a tool that is NOT registered is the
   * DR-21 loop: an agent told it can navigate, on a run with no webview, cannot
   * discover the step is impossible and repeats it until the turn dies.
   */
  it('says nothing when there is no browser', () => {
    expect(browserToolsPrompt(false)).toBe('');
  });

  it('names the tools when there is one', () => {
    const p = browserToolsPrompt(true);
    for (const t of ['navigate', 'snapshot', 'click', 'extract_content']) expect(p).toContain(t);
  });

  it('says WHEN the browser beats a fetch', () => {
    // Without this it reads as "a slower FetchUrl" and stays unused.
    const p = browserToolsPrompt(true);
    expect(p).toMatch(/login|session/i);
    expect(p).toMatch(/filter|sort|pagination/i);
    expect(p).toMatch(/scripts run/i);
  });

  it('says when to prefer a fetch, so the browser is not overused either', () => {
    // No `s` flag — the project's TS target predates it. `[\s\S]` does the same.
    expect(browserToolsPrompt(true)).toMatch(/prefer[\s\S]*FetchUrl[\s\S]*static/i);
  });

  it('teaches snapshot-then-act, which is the only order that works', () => {
    const p = browserToolsPrompt(true);
    expect(p).toMatch(/snapshot.*first/i);
    expect(p).toMatch(/ref/);
    expect(p).toMatch(/expire/i);
  });

  it('is gated on the SAME flag that mounts the tools', () => {
    /*
     * Emitted in the provider, not per surface, so the note and the tools cannot
     * disagree — the failure would be silent in both directions.
     */
    const provider = fs.readFileSync(path.join(SRC, 'lib/providers/claude-provider.ts'), 'utf8');
    expect(provider).toContain('browserToolsPrompt(browserToolsServable)');
    expect(provider).toContain('hasWebview: browserToolsServable');
  });
});
