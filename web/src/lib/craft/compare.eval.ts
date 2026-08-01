import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { EVAL_BRIEFS } from './eval-briefs';
import { findSlopTells, summariseTells } from './slop-tells';
import {
  buildJudgePrompt,
  parseVerdict,
  resolvePair,
  aggregate,
  summarisePairwise,
  type PairOutcome,
} from './pairwise-judge';
import { RUBRIC_IDS } from './rubric';

/**
 * P7 — compare two stored runs with the pairwise metric.
 *
 * `npm run eval:compare` with two run directory names:
 *
 *   AIME_EVAL=1 \
 *   AIME_EVAL_BASE_RUN=baseline-2026-08-01-00-14-25 \
 *   AIME_EVAL_NEW_RUN=craft-2026-08-02-09-00-00 \
 *   npm run eval:compare
 *
 * ## Why this is a separate step from generating
 *
 * Generation is the expensive, slow, tool-driven part; judging is a single
 * completion per ordering. Splitting them means a judge can be re-run — with a
 * fixed prompt, a different model, a repaired rubric — without paying to
 * regenerate every artifact. It also means the *stored* runs are the unit of
 * comparison, so any two runs on disk can be compared after the fact, including
 * ones generated months apart.
 *
 * ## Why the judge does NOT resolve through the app's model settings
 *
 * `baseline.eval.ts` deliberately drives the real route, because the thing being
 * measured is what the app actually assembles. The judge is the opposite case:
 * it is the measuring instrument, and an instrument that follows the user's
 * Settings would silently recalibrate itself whenever a tier was reassigned. Two
 * runs compared before and after such a change would not be comparable, and
 * nothing would say so. So the judge is pinned by its own environment variables
 * and its model is recorded in the report.
 *
 * That is the same reasoning that freezes the brief prompts, applied to the
 * other half of the instrument.
 */

const OUT_ROOT = path.resolve(__dirname, '../../../../.planning/evals');
const ENABLED = process.env.AIME_EVAL === '1';

const BASE_RUN = process.env.AIME_EVAL_BASE_RUN;
const NEW_RUN = process.env.AIME_EVAL_NEW_RUN;

/** Pinned independently of the app. Recorded in every report. */
const JUDGE_MODEL = process.env.AIME_EVAL_JUDGE_MODEL || 'claude-opus-5';
const JUDGE_BASE_URL = process.env.AIME_EVAL_JUDGE_BASE_URL;
const JUDGE_API_KEY = process.env.AIME_EVAL_JUDGE_API_KEY || process.env.ANTHROPIC_API_KEY;

/**
 * Two calls per pair — one per ordering — so this bounds spend directly. A
 * 16-brief, 3-sample run is 48 pairs and 96 judge calls; at a few cents each
 * that is real money but not eval-harness money.
 */
const MAX_PAIRS = Number(process.env.AIME_EVAL_MAX_PAIRS ?? 64);

const ARTIFACT_EXT = /\.(html?|tsx?|jsx?|css|svelte|vue|md)$/i;

interface Sample {
  briefId: string;
  sample: number;
  source: string;
}

/**
 * Read one sample's artifacts as a single blob.
 *
 * Files prefixed `_` are harness metadata (`_reply.md`, `_usage.json`,
 * `_system-prompt.txt`) and are excluded — `_system-prompt.txt` especially, since
 * feeding the judge the prompt that produced a candidate would tell it exactly
 * which condition it is looking at and destroy the blinding.
 */
function readSample(runDir: string, briefId: string, sample: number): Sample | null {
  const dir = path.join(runDir, briefId, `sample-${sample}`);
  if (!fs.existsSync(dir)) return null;

  const parts: string[] = [];
  const walk = (d: string, rel = '') => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, r);
      else if (ARTIFACT_EXT.test(e.name)) {
        parts.push(`/* ===== ${r} ===== */\n${fs.readFileSync(full, 'utf-8')}`);
      }
    }
  };
  walk(dir);

  const source = parts.join('\n\n');
  return source.trim() ? { briefId, sample, source } : null;
}

function listRun(runDir: string): Map<string, Sample> {
  const out = new Map<string, Sample>();
  for (const brief of EVAL_BRIEFS) {
    for (let s = 0; s < 20; s++) {
      const found = readSample(runDir, brief.id, s);
      if (found) out.set(`${brief.id}#${s}`, found);
    }
  }
  return out;
}

describe.skipIf(!ENABLED)('P7 — pairwise comparison of two stored runs', () => {
  let client: Anthropic;
  let baseDir: string;
  let newDir: string;

  beforeAll(() => {
    expect(BASE_RUN, 'set AIME_EVAL_BASE_RUN to a directory under .planning/evals').toBeTruthy();
    expect(NEW_RUN, 'set AIME_EVAL_NEW_RUN to a directory under .planning/evals').toBeTruthy();
    expect(JUDGE_API_KEY, 'no judge API key (AIME_EVAL_JUDGE_API_KEY or ANTHROPIC_API_KEY)').toBeTruthy();

    baseDir = path.join(OUT_ROOT, BASE_RUN!);
    newDir = path.join(OUT_ROOT, NEW_RUN!);
    for (const d of [baseDir, newDir]) {
      expect(fs.existsSync(d), `no such run: ${d}`).toBe(true);
    }

    client = new Anthropic({
      apiKey: JUDGE_API_KEY,
      ...(JUDGE_BASE_URL ? { baseURL: JUDGE_BASE_URL } : {}),
    });
  });

  it('judges every paired sample in both orders and reports a win rate', async () => {
    const baseSamples = listRun(baseDir);
    const newSamples = listRun(newDir);

    // Only samples present in BOTH runs can be compared. A brief that failed in
    // one run is dropped from the pairing rather than scored as a loss — a
    // provider outage is not a design result.
    const keys = [...baseSamples.keys()].filter((k) => newSamples.has(k)).slice(0, MAX_PAIRS);
    const skipped = [...baseSamples.keys()].filter((k) => !newSamples.has(k));

    expect(keys.length, 'no samples appear in both runs — nothing to compare').toBeGreaterThan(0);

    const ask = async (prompt: string): Promise<string> => {
      const res = await client.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      });
      return res.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
    };

    const outcomes: PairOutcome[] = [];
    const notes: string[] = [];
    let unparseable = 0;

    for (const key of keys) {
      const a = baseSamples.get(key)!;
      const b = newSamples.get(key)!;
      const brief = EVAL_BRIEFS.find((x) => x.id === a.briefId)!;

      // Both orderings. `forward` puts the BASE run first; `reverse` puts the NEW
      // run first. `resolvePair` relies on exactly this convention.
      const [forwardText, reverseText] = await Promise.all([
        ask(buildJudgePrompt({ brief: brief.prompt, first: a, second: b })),
        ask(buildJudgePrompt({ brief: brief.prompt, first: b, second: a })),
      ]);

      const forward = parseVerdict(forwardText);
      const reverse = parseVerdict(reverseText);
      if (!forward || !reverse) {
        unparseable++;
        continue;
      }

      const outcome = resolvePair({ briefId: a.briefId, sample: a.sample, forward, reverse });
      outcomes.push(outcome);
      if (forward.note) notes.push(`- \`${key}\` → **${outcome.overall}** — ${forward.note}`);
    }

    const agg = aggregate(outcomes, { unparseable });
    const labels = { a: BASE_RUN!, b: NEW_RUN! };

    // The deterministic floor, reported alongside rather than replaced by the
    // judge. A pairwise win with a rising tell count is a result worth seeing.
    const tellDelta = (samples: Map<string, Sample>) => {
      const all = [...samples.values()].flatMap((s) => findSlopTells(s.source));
      return summariseTells(all);
    };

    const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
    const report = [
      `# Pairwise comparison`,
      ``,
      `- **A (base):** \`${BASE_RUN}\``,
      `- **B (new):** \`${NEW_RUN}\``,
      `- **Judge:** \`${JUDGE_MODEL}\`${JUDGE_BASE_URL ? ` via \`${JUDGE_BASE_URL}\`` : ''}`,
      `- **Rubric dimensions:** ${RUBRIC_IDS.join(', ')}`,
      ``,
      `## Result`,
      ``,
      summarisePairwise(agg, labels),
      ``,
      `Ties are counted as half a win, and a pair whose winner changes when the`,
      `order is swapped is recorded as a tie. An interval spanning 50% means the`,
      `two runs are tied, not that B is marginally ahead.`,
      ``,
      `| | |`,
      `|---|---|`,
      `| Pairs judged | ${agg.n} over ${agg.briefs} briefs |`,
      `| Win rate (B) | ${pct(agg.winRateB)} |`,
      `| 95% CI | ${pct(agg.ci[0])} – ${pct(agg.ci[1])} |`,
      `| Significant | ${agg.significant ? 'yes' : 'no — reported as tied'} |`,
      `| A / B / tie | ${agg.wins.a} / ${agg.wins.b} / ${agg.wins.tie} |`,
      `| Position flips | ${pct(agg.positionalBiasRate)} |`,
      `| Unreadable verdicts | ${agg.unparseable} |`,
      `| Skipped (missing in B) | ${skipped.length}${skipped.length ? ` — ${skipped.join(', ')}` : ''} |`,
      ``,
      `## By rubric dimension`,
      ``,
      `| Dimension | Win rate (B) |`,
      `|---|---|`,
      ...RUBRIC_IDS.map((id) => `| ${id} | ${pct(agg.byDimension[id])} |`),
      ``,
      `## Deterministic tells (unchanged instrument)`,
      ``,
      `- A: ${tellDelta(baseSamples)}`,
      `- B: ${tellDelta(newSamples)}`,
      ``,
      `## Judge notes (forward ordering)`,
      ``,
      ...notes,
      ``,
    ].join('\n');

    const outFile = path.join(OUT_ROOT, `compare-${BASE_RUN}-vs-${NEW_RUN}.md`);
    fs.writeFileSync(outFile, report);
    fs.writeFileSync(
      outFile.replace(/\.md$/, '.json'),
      JSON.stringify({ base: BASE_RUN, new: NEW_RUN, judge: JUDGE_MODEL, agg, outcomes }, null, 2),
    );

    console.log(`\n${summarisePairwise(agg, labels)}\n→ ${outFile}\n`);

    // A judge that flips on order more than a third of the time is not measuring
    // the artifacts, and every number above it is decoration. Fail loudly rather
    // than let that report be quoted.
    expect(
      agg.positionalBiasRate,
      'the judge is order-sensitive; its verdicts do not describe the artifacts',
    ).toBeLessThan(0.34);
  });
});
