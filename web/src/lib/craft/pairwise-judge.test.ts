import { describe, it, expect } from 'vitest';
import {
  buildJudgePrompt,
  parseVerdict,
  resolvePair,
  aggregate,
  summarisePairwise,
  type Choice,
  type JudgeVerdict,
  type PairOutcome,
} from './pairwise-judge';
import { RUBRIC_IDS } from './rubric';

/**
 * The model call costs money; the arithmetic around it is free and is where a
 * result actually goes wrong. So everything here is exercised without a network:
 * prompt assembly, parsing, order-swap resolution, and the clustered bootstrap.
 *
 * The failures being guarded against are specific, and each has a documented
 * precedent in how eval harnesses mislead:
 *   - a position-biased judge read as a real preference,
 *   - an unreadable verdict silently coerced to "tie", dragging the rate to 0.5,
 *   - a confidence interval computed over correlated samples, reported far too
 *     narrow, and used to announce a difference that is not there.
 */

const verdict = (overall: Choice, dims?: Partial<Record<string, Choice>>): JudgeVerdict => ({
  overall,
  dimensions: dims ?? Object.fromEntries(RUBRIC_IDS.map((id) => [id, overall])),
});

describe('the judge prompt', () => {
  const prompt = buildJudgePrompt({
    brief: 'Build a dashboard',
    first: { label: 'baseline', source: '<div>A</div>' },
    second: { label: 'craft', source: '<div>B</div>' },
  });

  it('names every rubric dimension', () => {
    for (const id of RUBRIC_IDS) expect(prompt).toContain(id);
  });

  it('includes the brief — a judge without it prefers the prettier wrong answer', () => {
    expect(prompt).toContain('Build a dashboard');
  });

  /**
   * The blinding requirement. A judge told which candidate is "the new one" will
   * find it better, and that effect is large enough to produce a whole result on
   * its own.
   */
  it('never reveals where a candidate came from', () => {
    expect(prompt).not.toContain('baseline');
    expect(prompt).not.toContain('craft');
  });

  it('offers tie as a real option rather than forcing a pick', () => {
    expect(prompt).toMatch(/"tie" is a real answer/);
  });

  it('truncates a huge artifact instead of blowing the context window', () => {
    const big = buildJudgePrompt({
      brief: 'b',
      first: { label: 'x', source: 'x'.repeat(50_000) },
      second: { label: 'y', source: 'y' },
      maxCharsPerCandidate: 100,
    });
    expect(big).toContain('truncated at 100 characters');
    expect(big.length).toBeLessThan(5_000);
  });
});

describe('parsing a judge reply', () => {
  const good = `{"dimensions":{"brief-fit":"first","hierarchy":"second"},"overall":"first","note":"ok"}`;

  it('reads a clean JSON reply', () => {
    const v = parseVerdict(good)!;
    expect(v.overall).toBe('first');
    expect(v.dimensions['brief-fit']).toBe('first');
    expect(v.dimensions.hierarchy).toBe('second');
    expect(v.note).toBe('ok');
  });

  it('reads it despite the prose models add anyway', () => {
    expect(parseVerdict(`Sure! Here is my verdict:\n\n${good}\n\nHope that helps.`)?.overall).toBe(
      'first',
    );
  });

  it('reads it out of a fenced block', () => {
    expect(parseVerdict('```json\n' + good + '\n```')?.overall).toBe('first');
  });

  it('is case-insensitive about the choice words', () => {
    expect(parseVerdict(`{"overall":"TIE","dimensions":{}}`)?.overall).toBe('tie');
  });

  /**
   * The important one. Coercing an unreadable reply to "tie" would pull every win
   * rate toward 50% and read exactly like a genuine null result — the harness
   * would report "no difference" when what happened was "the judge broke".
   */
  it.each([
    ['not JSON at all', 'The first one is better, obviously.'],
    ['malformed JSON', '{"overall": '],
    ['a valid object with no verdict', '{"thoughts":"hmm"}'],
    ['an invalid choice word', '{"overall":"maybe","dimensions":{}}'],
  ])('returns null for %s rather than defaulting to a tie', (_label, text) => {
    expect(parseVerdict(text)).toBeNull();
  });

  it('treats a missing dimension as absent, not as a pick', () => {
    const v = parseVerdict(`{"overall":"first","dimensions":{"hierarchy":"first"}}`)!;
    expect(v.dimensions['brief-fit']).toBeUndefined();
  });
});

describe('order-swap resolution', () => {
  const pair = (forward: Choice, reverse: Choice) =>
    resolvePair({
      briefId: 'b1',
      sample: 0,
      forward: verdict(forward),
      reverse: verdict(reverse),
    });

  /**
   * Forward judges A first, reverse judges B first. Agreement means the same
   * CANDIDATE was picked, which is the opposite positional word in each.
   */
  it('a consistent win for A survives both orders', () => {
    expect(pair('first', 'second').overall).toBe('a');
  });

  it('a consistent win for B survives both orders', () => {
    expect(pair('second', 'first').overall).toBe('b');
  });

  /**
   * Both orders said "the first one" — that is a preference for position, not
   * for either artifact, and it must not be counted as a win.
   */
  it.each([
    ['always-first bias', 'first' as Choice, 'first' as Choice],
    ['always-second bias', 'second' as Choice, 'second' as Choice],
  ])('%s becomes a tie and is flagged', (_label, f, r) => {
    const out = pair(f, r);
    expect(out.overall).toBe('tie');
    expect(out.orderDisagreed).toBe(true);
  });

  it('genuine agreement on a tie is a tie, and is not flagged as bias', () => {
    const out = pair('tie', 'tie');
    expect(out.overall).toBe('tie');
    expect(out.orderDisagreed).toBe(false);
  });

  /**
   * One order picks, the other abstains. Conservative by design: with an
   * effective sample size in the low tens, overstating a difference costs more
   * than missing a small one. But it is NOT a position flip, so it must not
   * inflate the bias figure — that number is a read on the judge, and polluting
   * it would make the judge look worse than it is.
   */
  it('a pick against an abstention is a tie without counting as bias', () => {
    const out = pair('first', 'tie');
    expect(out.overall).toBe('tie');
    expect(out.orderDisagreed).toBe(false);
  });

  it('resolves each dimension independently of the overall verdict', () => {
    const out = resolvePair({
      briefId: 'b1',
      sample: 0,
      forward: verdict('tie', { 'brief-fit': 'first', hierarchy: 'second' }),
      reverse: verdict('tie', { 'brief-fit': 'second', hierarchy: 'first' }),
    });
    expect(out.overall).toBe('tie');
    expect(out.dimensions['brief-fit']).toBe('a');
    expect(out.dimensions.hierarchy).toBe('b');
  });

  it('a dimension the judge omitted in both orders is a tie', () => {
    const out = resolvePair({
      briefId: 'b1',
      sample: 0,
      forward: verdict('first', {}),
      reverse: verdict('second', {}),
    });
    expect(out.dimensions.restraint).toBe('tie');
  });
});

describe('aggregation', () => {
  const outcome = (briefId: string, sample: number, overall: PairOutcome['overall']): PairOutcome => ({
    briefId,
    sample,
    overall,
    dimensions: Object.fromEntries(RUBRIC_IDS.map((id) => [id, overall])),
    orderDisagreed: false,
  });

  it('counts ties as half a win', () => {
    const agg = aggregate([
      outcome('b1', 0, 'b'),
      outcome('b2', 0, 'a'),
      outcome('b3', 0, 'tie'),
      outcome('b4', 0, 'tie'),
    ]);
    expect(agg.winRateB).toBe(0.5);
    expect(agg.wins).toEqual({ a: 1, b: 1, tie: 2 });
  });

  it('is deterministic — the same input reproduces the same interval', () => {
    const data = ['b1', 'b2', 'b3', 'b4'].map((b, i) => outcome(b, 0, i === 0 ? 'a' : 'b'));
    expect(aggregate(data).ci).toEqual(aggregate(data).ci);
  });

  /**
   * The headline discipline, borrowed from how public leaderboards report rank:
   * an interval that includes 50% is a TIE, not a quiet win. A four-brief split
   * decision cannot support a claim either way.
   */
  it('reports a near-even result as not significant', () => {
    const agg = aggregate([
      outcome('b1', 0, 'b'),
      outcome('b2', 0, 'a'),
      outcome('b3', 0, 'b'),
      outcome('b4', 0, 'a'),
    ]);
    expect(agg.significant).toBe(false);
    expect(agg.ci[0]).toBeLessThanOrEqual(0.5);
    expect(agg.ci[1]).toBeGreaterThanOrEqual(0.5);
  });

  it('reports a unanimous sweep across many briefs as significant', () => {
    const agg = aggregate(Array.from({ length: 16 }, (_, i) => outcome(`b${i}`, 0, 'b')));
    expect(agg.winRateB).toBe(1);
    expect(agg.significant).toBe(true);
    expect(agg.ci[0]).toBeGreaterThan(0.5);
  });

  /**
   * The clustering guarantee, and the reason the bootstrap resamples briefs.
   *
   * Both datasets have 24 observations and the same win rate. One has 24
   * independent briefs; the other has 4 briefs sampled 6 times each — the same
   * brief agreeing with itself, which is not new evidence. The clustered
   * interval MUST be wider. A pair-level bootstrap would report these two as
   * equally certain, which is precisely how an eval announces a result it does
   * not have.
   */
  it('widens the interval when observations are clustered within briefs', () => {
    const wins: PairOutcome['overall'][] = [
      ...Array(18).fill('b'),
      ...Array(6).fill('a'),
    ] as PairOutcome['overall'][];

    const independent = wins.map((w, i) => outcome(`brief-${i}`, 0, w));
    const clustered = wins.map((w, i) => outcome(`brief-${Math.floor(i / 6)}`, i % 6, w));

    expect(aggregate(independent).winRateB).toBeCloseTo(aggregate(clustered).winRateB, 10);
    expect(aggregate(independent).briefs).toBe(24);
    expect(aggregate(clustered).briefs).toBe(4);

    const width = (a: ReturnType<typeof aggregate>) => a.ci[1] - a.ci[0];
    expect(width(aggregate(clustered))).toBeGreaterThan(width(aggregate(independent)));
  });

  it('reports positional bias as its own number', () => {
    const flipped = { ...outcome('b1', 0, 'tie'), orderDisagreed: true };
    const agg = aggregate([flipped, outcome('b2', 0, 'b'), outcome('b3', 0, 'b'), outcome('b4', 0, 'a')]);
    expect(agg.positionalBiasRate).toBeCloseTo(0.25, 10);
  });

  it('surfaces unreadable verdicts rather than hiding them in the tie count', () => {
    expect(aggregate([outcome('b1', 0, 'b')], { unparseable: 3 }).unparseable).toBe(3);
  });

  it('does not divide by zero on an empty run', () => {
    const agg = aggregate([]);
    expect(agg.n).toBe(0);
    expect(agg.significant).toBe(false);
    expect(Number.isFinite(agg.winRateB)).toBe(true);
    expect(agg.positionalBiasRate).toBe(0);
  });

  it('scores each dimension separately', () => {
    const mixed: PairOutcome = {
      briefId: 'b1',
      sample: 0,
      overall: 'tie',
      dimensions: { ...Object.fromEntries(RUBRIC_IDS.map((id) => [id, 'a'])), restraint: 'b' },
      orderDisagreed: false,
    };
    const agg = aggregate([mixed]);
    expect(agg.byDimension.restraint).toBe(1);
    expect(agg.byDimension['brief-fit']).toBe(0);
  });
});

describe('the summary line', () => {
  const build = (overalls: PairOutcome['overall'][]) =>
    aggregate(
      overalls.map((o, i) => ({
        briefId: `b${i}`,
        sample: 0,
        overall: o,
        dimensions: {},
        orderDisagreed: false,
      })),
    );

  it('says "tied" rather than naming a winner when the interval spans 50%', () => {
    const text = summarisePairwise(build(['a', 'b', 'a', 'b']), { a: 'baseline', b: 'craft' });
    expect(text).toContain('tied');
    expect(text).not.toMatch(/craft wins/);
  });

  it('names the winner when the interval does not', () => {
    const text = summarisePairwise(build(Array(16).fill('b')), { a: 'baseline', b: 'craft' });
    expect(text).toContain('craft wins');
  });

  it('always shows the interval and the pair count, not just the headline rate', () => {
    const text = summarisePairwise(build(['b', 'b', 'a', 'tie']), { a: 'baseline', b: 'craft' });
    expect(text).toMatch(/95% CI/);
    expect(text).toMatch(/4 pairs over 4 briefs/);
  });
});

/**
 * A judge reply with a brace before the JSON.
 *
 * `[...text.matchAll(/\{[\s\S]*\}/g)]` is greedy, so it produced exactly ONE
 * candidate — first `{` to last `}` — which made `.reverse()` a no-op and left
 * `shrinkToJson` offering only the first balanced object inside that span. The
 * comment above it claimed the opposite. Every such reply was counted
 * unparseable, silently shrinking both `n` and the brief count that bounds the
 * bootstrap CI.
 */
describe('parseVerdict finds the LAST object, not the first', () => {
  it('skips an example object quoted before the answer', () => {
    const reply = 'Note: the format {"a":1} is wrong. My answer:\n{"dimensions":{},"overall":"second"}';
    expect(parseVerdict(reply)?.overall).toBe('second');
  });

  it('skips a whole worked example', () => {
    const reply = [
      'For instance {"overall":"first"} would mean A wins.',
      'Here is my verdict:',
      '{"dimensions":{},"overall":"tie"}',
    ].join('\n');
    expect(parseVerdict(reply)?.overall).toBe('tie');
  });

  it('is not confused by a brace inside a string', () => {
    const reply = '{"dimensions":{},"overall":"second","note":"the } here is prose"}';
    expect(parseVerdict(reply)?.overall).toBe('second');
  });

  it('is not confused by an escaped quote inside a string', () => {
    const reply = '{"dimensions":{},"overall":"first","note":"they said \\"} \\" oddly"}';
    expect(parseVerdict(reply)?.overall).toBe('first');
  });

  it('still reads a bare object with no prose around it', () => {
    expect(parseVerdict('{"dimensions":{},"overall":"first"}')?.overall).toBe('first');
  });

  it('still returns null when there is no verdict at all', () => {
    expect(parseVerdict('I could not decide. {"notes":"hmm"}')).toBeNull();
    expect(parseVerdict('no braces here')).toBeNull();
  });
});
