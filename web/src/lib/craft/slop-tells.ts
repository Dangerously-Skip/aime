/**
 * Deterministic checks for the AI-design tells — the ones a regex can decide.
 *
 * ## Why deterministic first
 *
 * P7 is about the quality of generated UI, and quality arguments are where
 * projects quietly stop measuring. `nexu-io/open-design` is the cautionary case
 * on both counts: it ships ~1000 lines of exactly these rules, and it also ships
 * no benchmarks at all — its own slim-vs-classic prompt split is unresolved
 * *because* the A/B was never finished (DR-16). Worse, its linter has no caller:
 * the save route returns `lint: findings` and the only consumer types the
 * response as `{url, path}` and drops them. A control that reads as enforced and
 * is not — the same shape as `allowedTools` here.
 *
 * So this module is deliberately narrow. Every rule below is CHECKABLE: a
 * specific hex value, a specific missing property, a countable ratio. Nothing
 * here judges taste. Things that need judgement (hierarchy, restraint, whether
 * the thing looks like the brand) are a human's job and are not smuggled in as
 * a passing score.
 *
 * The point of having it BEFORE any prompt work is that a before/after needs the
 * before measured with the same instrument as the after. Change the instrument
 * between runs and the comparison means nothing.
 */

export type Severity = 'p0' | 'p1';

export interface Finding {
  rule: string;
  severity: Severity;
  /** What was found, in the user's terms. */
  detail: string;
  /** What to do instead — a finding without one is a complaint. */
  fix: string;
  /** 1-indexed line, when the rule matched a specific place. */
  line?: number;
  /** The matched text, trimmed, for the report. */
  match?: string;
}

interface Rule {
  id: string;
  severity: Severity;
  pattern: RegExp;
  detail: string;
  fix: string;
}

/**
 * The default LLM accent palette. These specific values are the single most
 * reported "this was AI-generated" tell, and they are exact strings rather than
 * a hue range on purpose — a rule that flagged all indigo would fire on a brand
 * that legitimately uses it.
 */
const AI_DEFAULT_ACCENTS = [
  '#6366f1',
  '#4f46e5',
  '#4338ca',
  '#3730a3',
  '#8b5cf6',
  '#7c3aed',
  '#a855f7',
];

const RULES: Rule[] = [
  {
    id: 'ai-default-accent',
    severity: 'p0',
    pattern: new RegExp(AI_DEFAULT_ACCENTS.join('|'), 'i'),
    detail: 'a default LLM accent colour',
    fix: 'Take the accent from the brand, the domain, or the chosen direction — never the model’s favourite indigo.',
  },
  {
    id: 'two-stop-trust-gradient',
    severity: 'p1',
    // The specific shape: a two-stop linear gradient between two purples/blues.
    pattern:
      /linear-gradient\([^)]*(#(6366f1|8b5cf6|7c3aed|a855f7|4f46e5)[^)]*#|from-(indigo|purple|violet)-\d{3}[^)]*to-(indigo|purple|violet)-\d{3})/i,
    detail: 'the two-stop purple/indigo "trust gradient"',
    fix: 'Use a flat surface colour, or a gradient that carries meaning (depth, state) rather than decoration.',
  },
  {
    id: 'generic-display-face',
    severity: 'p1',
    // Only when used as a DISPLAY face — as a body fallback these are fine, so
    // the rule looks for them in a heading/display declaration.
    pattern:
      // `[^;}]` — not `[^;{}]`: the selector's own opening brace sits between
      // the selector and the declaration (`h1 { font-family: … }`), so excluding
      // `{` meant this rule could never match the ordinary case.
      /(?:--font-display|font-display|h1|h2|\.display|\.hero)[^;}]{0,120}font-family:[^;]*\b(Inter|Roboto|Arial|system-ui)\b/i,
    detail: 'a generic system face used for display type',
    fix: 'Display face should differ from the body face. Keep Inter/Roboto for body if you like; pick something with a voice for headings.',
  },
  {
    id: 'caps-without-tracking',
    severity: 'p1',
    // ALL CAPS with no positive letter-spacing in the same declaration block.
    pattern: /text-transform:\s*uppercase\s*;(?![^{}]*letter-spacing)/i,
    detail: 'uppercase text with no positive letter-spacing',
    fix: 'ALL CAPS needs 0.06em–0.1em tracking, or it reads cramped. This is one of the most reliable tells.',
  },
  {
    id: 'pure-black-or-white',
    severity: 'p1',
    pattern: /(background(-color)?|color):\s*(#000(000)?|#fff(fff)?)\b/i,
    detail: 'pure #000 or #fff as a surface or text colour',
    fix: 'Use near-black/near-white (e.g. #111111 / #fafafa). Pure values read as unconsidered.',
  },
  {
    id: 'emoji-as-icon',
    severity: 'p0',
    // An emoji standing alone inside an element — i.e. used as an icon.
    pattern: /<(span|div|i|p)[^>]*>\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\s*<\//u,
    detail: 'an emoji used as a feature icon',
    fix: 'Use a real icon set. Emoji render differently per platform and read as a placeholder.',
  },
  {
    id: 'left-border-accent-card',
    severity: 'p1',
    pattern: /border-left:\s*\d+px\s+solid[^;]*;[^{}]{0,200}border-radius/i,
    detail: 'the rounded card with a coloured left border',
    fix: 'A very recognisable template shape. Distinguish the card by surface, spacing or type instead.',
  },
];

/**
 * Rules that need a whole-document view rather than a regex over the text.
 * Kept separate because they are the ones most likely to be wrong on a fragment.
 */
function documentRules(html: string): Finding[] {
  const out: Finding[] = [];

  // A UI with only the populated state. Open-design calls this "the single most
  // reliable AI-design failure" and it is checkable: does the markup mention any
  // of the other states at all?
  const looksLikeApp = /<(table|ul|ol|form)\b/i.test(html);
  const mentionsOtherStates =
    /\b(empty|no results|nothing here|loading|skeleton|spinner|error|failed|retry)\b/i.test(html);
  if (looksLikeApp && !mentionsOtherStates) {
    out.push({
      rule: 'populated-state-only',
      severity: 'p1',
      detail: 'only the populated state appears — no empty, loading or error state',
      fix: 'Show at least the empty and error states. A list that can be empty always is, eventually.',
    });
  }

  return out;
}

/**
 * Scan generated markup for the tells.
 *
 * Line numbers are reported so a finding points somewhere. Order is by severity
 * then by position, so the report reads worst-first.
 */
export function findSlopTells(source: string): Finding[] {
  const lines = source.split('\n');
  const found: Finding[] = [];

  for (const rule of RULES) {
    // Per-line so the report can point at a place; the first hit per rule is
    // enough — a list of 40 identical findings is noise, not information.
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(rule.pattern);
      if (m) {
        found.push({
          rule: rule.id,
          severity: rule.severity,
          detail: rule.detail,
          fix: rule.fix,
          line: i + 1,
          match: m[0].trim().slice(0, 80),
        });
        break;
      }
    }
  }

  found.push(...documentRules(source));
  return found.sort((a, b) =>
    a.severity === b.severity ? (a.line ?? 0) - (b.line ?? 0) : a.severity === 'p0' ? -1 : 1,
  );
}

/** A one-line summary for a run report. */
export function summariseTells(findings: Finding[]): string {
  const p0 = findings.filter((f) => f.severity === 'p0').length;
  const p1 = findings.length - p0;
  return `${p0} P0, ${p1} P1`;
}
