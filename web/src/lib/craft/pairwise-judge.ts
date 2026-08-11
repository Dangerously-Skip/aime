import { CRAFT_RUBRIC, RUBRIC_IDS } from './rubric';

/**
 * Paired, order-swapped, rubric-guided pairwise judging — the P7 headline metric.
 *
 * ## Why this replaced the tell-count as the headline
 *
 * `slop-tells.ts` counts things a regex can decide, and it stays: it is the
 * deterministic floor, it is free, and a rule it catches is a rule a before/after
 * can move. What it cannot do is notice that an artifact got WORSE in a way no
 * rule covers — a clean tell-count is compatible with an incoherent screen.
 * Optimising against it alone would eventually produce output that passes every
 * rule and pleases nobody.
 *
 * The market's answer for generated UI is pairwise comparison against a rubric,
 * for a specific and measurable reason: pairwise judges track human raters
 * substantially better than pointwise scoring does, and judges shown the CODE
 * agree more than judges shown a screenshot. Absolute "rate this 1-10" scores
 * drift between runs and cannot be calibrated after the fact; a comparison is
 * anchored by the thing it is compared against.
 *
 * ## Where the arithmetic is, and why it is here rather than in the eval
 *
 * The model call lives in the eval, because that is the part that costs money.
 * Everything in this file is pure: prompt assembly, parsing, order-swap
 * resolution and aggregation. That split is deliberate — the arithmetic is what
 * quietly gets a result wrong, so it is the part that has to be testable without
 * paying anyone.
 *
 * ## The two controls that matter
 *
 * 1. **Order swap.** LLM judges have a well-documented position preference. Every
 *    pair is therefore judged twice, with the candidates swapped, and only an
 *    outcome that survives both orders counts as a win. A pair that flips is
 *    recorded as a tie AND counted into `positionalBiasRate`, which is a direct,
 *    free read on whether the judge is worth listening to at all.
 * 2. **Clustered resampling.** Samples of the same brief are not independent
 *    observations — a brief the model finds easy produces correlated wins. The
 *    bootstrap therefore resamples BRIEFS, not pairs. Resampling pairs would
 *    report a confidence interval roughly sqrt(samples-per-brief) times too
 *    narrow, which is how an eval announces a result it does not have.
 */

/** What a judge said about one ordering. `first`/`second` are positional. */
export type Choice = 'first' | 'second' | 'tie';

/** Which candidate won, once position has been resolved away. */
export type Side = 'a' | 'b' | 'tie';

export interface JudgeVerdict {
  overall: Choice;
  /** Keyed by rubric dimension id. Missing dimensions are treated as ties. */
  dimensions: Partial<Record<string, Choice>>;
  /** The judge's one-line reason, kept for the report. */
  note?: string;
}

export interface PairOutcome {
  briefId: string;
  /** Index of the sample within the brief, so pairing is reproducible. */
  sample: number;
  overall: Side;
  dimensions: Record<string, Side>;
  /**
   * The two orderings picked OPPOSITE candidates. Not merely "disagreed": one
   * order abstaining while the other picks is weak evidence, not a flip.
   */
  orderDisagreed: boolean;
}

export interface Candidate {
  /**
   * Optional, and deliberately never read by `buildJudgePrompt`. Callers carry a
   * label for their own reports; the point is that passing one CANNOT leak into
   * the prompt, which is what the blinding test asserts by passing 'baseline'
   * and 'craft' and checking neither word appears.
   */
  label?: string;
  /** The generated source. Judges read code, not screenshots. */
  source: string;
}

const CHOICES: Choice[] = ['first', 'second', 'tie'];

/**
 * Build the judge prompt for ONE ordering.
 *
 * Deliberately says nothing about which candidate came from where. A judge told
 * one artifact is "the new version" will find it better; that is not a subtle
 * effect and it is entirely avoidable.
 */
export function buildJudgePrompt(args: {
  brief: string;
  first: Candidate;
  second: Candidate;
  /** Truncation guard — a 400KB artifact would blow the context and the budget. */
  maxCharsPerCandidate?: number;
}): string {
  const cap = args.maxCharsPerCandidate ?? 24_000;
  const clip = (s: string) =>
    s.length <= cap ? s : `${s.slice(0, cap)}\n\n/* … truncated at ${cap} characters … */`;

  const dimensions = CRAFT_RUBRIC.map((d) => `- **${d.id}** (${d.title}): ${d.question}`).join('\n');

  return `You are judging two candidate implementations of the same design brief.

# The brief

${args.brief}

# Candidate FIRST

\`\`\`
${clip(args.first.source)}
\`\`\`

# Candidate SECOND

\`\`\`
${clip(args.second.source)}
\`\`\`

# How to judge

For each dimension below, decide whether FIRST or SECOND is better, or whether
they are genuinely equivalent. Judge the artifact as it would be experienced,
reading the code to work out what it renders.

${dimensions}

Then give an overall verdict, weighing the dimensions as a designer would rather
than by counting them.

Rules:
- "tie" is a real answer. Use it when the difference is not one a user would
  notice. Do not manufacture a preference.
- Ignore which candidate is longer. More code is not better code.
- Ignore comments, naming and code style except where they change what renders.
- You are not told where either candidate came from. Do not speculate.

Reply with ONLY a JSON object, no prose around it:

{"dimensions":{${RUBRIC_IDS.map((id) => `"${id}":"first|second|tie"`).join(',')}},"overall":"first|second|tie","note":"one sentence"}`;
}

/**
 * Every TOP-LEVEL `{…}` span in the text, in order.
 *
 * Scanned rather than matched because a regex cannot count braces, and string
 * literals are tracked so a `}` inside `"…"` does not close an object early —
 * judge replies quote code and prose routinely.
 */
function balancedObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Pull the verdict out of a judge reply.
 *
 * Returns `null` rather than a default when the reply cannot be read. An
 * unparseable verdict silently coerced to "tie" would drag every win rate toward
 * 0.5 and look like a null result — so the caller is made to count these instead;
 * `aggregate` reports them.
 */
export function parseVerdict(text: string): JudgeVerdict | null {
  /*
   * Last balanced object wins: models prepend explanation despite instructions.
   *
   * This used to be `[...text.matchAll(/\{[\s\S]*\}/g)]`, which is GREEDY and
   * therefore yields exactly one candidate — first `{` to last `}` — so
   * `.reverse()` was a no-op and `shrinkToJson` only ever offered the FIRST
   * balanced object inside that span. The opposite of what the comment claimed,
   * and the effect was silent: a reply reading `the format {"a":1} is wrong.
   * My answer:\n{"overall":"second"}` parsed to the EXAMPLE, or to nothing, and
   * `compare.eval.ts` counted the pair unparseable — shrinking both `n` and the
   * brief count that bounds the bootstrap CI, while the report showed a tally.
   */
  for (const raw of balancedObjects(text).reverse()) {
    for (const attempt of shrinkToJson(raw)) {
      try {
        const parsed = JSON.parse(attempt);
        const overall = asChoice(parsed?.overall);
        if (!overall) continue;
        const dimensions: Partial<Record<string, Choice>> = {};
        for (const id of RUBRIC_IDS) {
          const c = asChoice(parsed?.dimensions?.[id]);
          if (c) dimensions[id] = c;
        }
        return {
          overall,
          dimensions,
          note: typeof parsed?.note === 'string' ? parsed.note : undefined,
        };
      } catch {
        /* try the next candidate */
      }
    }
  }
  return null;
}

/** Progressively trim trailing content so a JSON object followed by prose parses. */
function* shrinkToJson(raw: string): Generator<string> {
  yield raw;
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') {
      depth--;
      if (depth === 0) {
        yield raw.slice(0, i + 1);
        return;
      }
    }
  }
}

function asChoice(v: unknown): Choice | null {
  return typeof v === 'string' && (CHOICES as string[]).includes(v.toLowerCase())
    ? (v.toLowerCase() as Choice)
    : null;
}

/** Map a positional choice onto a candidate, given which candidate went first. */
function toSide(choice: Choice, firstIs: 'a' | 'b'): Side {
  if (choice === 'tie') return 'tie';
  const picked = choice === 'first' ? firstIs : firstIs === 'a' ? 'b' : 'a';
  return picked;
}

/**
 * Combine the two orderings of one pair into a single outcome.
 *
 * `forward` judged A first; `reverse` judged B first. A win requires BOTH orders
 * to name the same candidate. Anything else is a tie — including the case where
 * one order picks and the other abstains, which is deliberately conservative:
 * with an effective sample size in the low tens, the cost of overstating a
 * difference is higher than the cost of missing a small one.
 */
export function resolvePair(args: {
  briefId: string;
  sample: number;
  forward: JudgeVerdict;
  reverse: JudgeVerdict;
}): PairOutcome {
  const combine = (f: Choice, r: Choice): { side: Side; flipped: boolean } => {
    const a = toSide(f, 'a');
    const b = toSide(r, 'b');
    if (a === b) return { side: a, flipped: false };
    // Opposite picks — a genuine position flip, and no signal about the artifacts.
    if (a !== 'tie' && b !== 'tie') return { side: 'tie', flipped: true };
    return { side: 'tie', flipped: false };
  };

  const overall = combine(args.forward.overall, args.reverse.overall);
  const dimensions: Record<string, Side> = {};
  for (const id of RUBRIC_IDS) {
    dimensions[id] = combine(
      args.forward.dimensions[id] ?? 'tie',
      args.reverse.dimensions[id] ?? 'tie',
    ).side;
  }

  return {
    briefId: args.briefId,
    sample: args.sample,
    overall: overall.side,
    dimensions,
    orderDisagreed: overall.flipped,
  };
}

export interface Aggregate {
  /** Pairs that produced an outcome. */
  n: number;
  /** Distinct briefs — the real unit of independence, and what bounds the CI. */
  briefs: number;
  /** Wins for candidate B, ties counted as half. 0.5 is "no difference". */
  winRateB: number;
  wins: { a: number; b: number; tie: number };
  /** 95% percentile bootstrap, resampled over briefs. */
  ci: [number, number];
  /** True when the interval excludes 0.5 — i.e. a difference worth reporting. */
  significant: boolean;
  /** Fraction of pairs where swapping the order flipped the winner. */
  positionalBiasRate: number;
  /** Per-rubric-dimension win rate for B, same convention. */
  byDimension: Record<string, number>;
  /** Verdicts that could not be read. Reported, never silently treated as ties. */
  unparseable: number;
}

/** Deterministic PRNG so a reported interval can be reproduced exactly. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const scoreFor = (side: Side): number => (side === 'b' ? 1 : side === 'tie' ? 0.5 : 0);

const rateOf = (sides: Side[]): number =>
  sides.length === 0 ? 0.5 : sides.reduce((s, side) => s + scoreFor(side), 0) / sides.length;

/**
 * Turn resolved pairs into the numbers that go in the report.
 *
 * `unparseable` is passed in rather than inferred: by the time a pair reaches
 * here it has already been resolved, so the count of verdicts that never made it
 * is only known to the caller.
 */
export function aggregate(
  outcomes: PairOutcome[],
  opts: { unparseable?: number; resamples?: number; seed?: number } = {},
): Aggregate {
  const resamples = opts.resamples ?? 1000;
  const rand = mulberry32(opts.seed ?? 0x5eed);

  const byBrief = new Map<string, PairOutcome[]>();
  for (const o of outcomes) {
    const list = byBrief.get(o.briefId);
    if (list) list.push(o);
    else byBrief.set(o.briefId, [o]);
  }
  const briefIds = [...byBrief.keys()];

  const wins = {
    a: outcomes.filter((o) => o.overall === 'a').length,
    b: outcomes.filter((o) => o.overall === 'b').length,
    tie: outcomes.filter((o) => o.overall === 'tie').length,
  };

  // Resample BRIEFS with replacement, taking each drawn brief's pairs whole.
  // This is what keeps the interval honest when one brief contributes several
  // correlated samples.
  const draws: number[] = [];
  for (let i = 0; i < resamples && briefIds.length > 0; i++) {
    const picked: Side[] = [];
    for (let j = 0; j < briefIds.length; j++) {
      const brief = briefIds[Math.floor(rand() * briefIds.length)];
      for (const o of byBrief.get(brief)!) picked.push(o.overall);
    }
    draws.push(rateOf(picked));
  }
  draws.sort((x, y) => x - y);

  const at = (q: number) =>
    draws.length === 0 ? 0.5 : draws[Math.min(draws.length - 1, Math.floor(q * draws.length))];
  const ci: [number, number] = [at(0.025), at(0.975)];

  const byDimension: Record<string, number> = {};
  for (const id of RUBRIC_IDS) {
    byDimension[id] = rateOf(outcomes.map((o) => o.dimensions[id] ?? 'tie'));
  }

  return {
    n: outcomes.length,
    briefs: briefIds.length,
    winRateB: rateOf(outcomes.map((o) => o.overall)),
    wins,
    ci,
    // A CI touching 0.5 means "tied", reported as such rather than ranked.
    significant: outcomes.length > 0 && (ci[0] > 0.5 || ci[1] < 0.5),
    positionalBiasRate:
      outcomes.length === 0
        ? 0
        : outcomes.filter((o) => o.orderDisagreed).length / outcomes.length,
    byDimension,
    unparseable: opts.unparseable ?? 0,
  };
}

/** One-paragraph summary for the run report. */
export function summarisePairwise(agg: Aggregate, labels: { a: string; b: string }): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const verdict = agg.significant
    ? `${agg.winRateB > 0.5 ? labels.b : labels.a} wins`
    : 'tied — the interval includes 50%';
  return (
    `${labels.b} vs ${labels.a}: ${pct(agg.winRateB)} win rate ` +
    `(95% CI ${pct(agg.ci[0])}–${pct(agg.ci[1])}, ${agg.n} pairs over ${agg.briefs} briefs) — ${verdict}. ` +
    `Position flips ${pct(agg.positionalBiasRate)}` +
    (agg.unparseable ? `, ${agg.unparseable} verdict(s) unreadable.` : '.')
  );
}
