import { describe, it, expect } from 'vitest';
import { findSlopTells, summariseTells } from './slop-tells';

const ids = (src: string) => findSlopTells(src).map((f) => f.rule);

/**
 * A checker for design tells is only useful if it is trusted, and it stops being
 * trusted the first time it fires on something legitimate. So roughly half of
 * these assert what must NOT be flagged.
 */

describe('the accent tells', () => {
  it('flags the default LLM indigo', () => {
    expect(ids('.btn { background: #6366F1; }')).toContain('ai-default-accent');
  });

  it('does not flag other colours, including other purples', () => {
    // A brand may legitimately be purple. The rule is about specific default
    // values, not a hue — a rule that owned "purple" would be unusable.
    expect(ids('.btn { background: #7B2D8E; }')).not.toContain('ai-default-accent');
    expect(ids('.btn { background: #DC4A3F; }')).not.toContain('ai-default-accent');
  });

  it('flags the two-stop trust gradient', () => {
    expect(ids('.hero { background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); }')).toContain(
      'two-stop-trust-gradient',
    );
  });

  it('leaves a purposeful gradient alone', () => {
    expect(ids('.fade { background: linear-gradient(to top, rgba(0,0,0,0.6), transparent); }')).not.toContain(
      'two-stop-trust-gradient',
    );
  });
});

describe('typography tells', () => {
  it('flags uppercase with no tracking', () => {
    expect(ids('.label { text-transform: uppercase; font-size: 12px; }')).toContain(
      'caps-without-tracking',
    );
  });

  it('accepts uppercase that sets tracking', () => {
    expect(
      ids('.label { text-transform: uppercase; letter-spacing: 0.08em; }'),
    ).not.toContain('caps-without-tracking');
  });

  it('flags a generic face used for display', () => {
    expect(ids('h1 { font-family: Inter, sans-serif; }')).toContain('generic-display-face');
  });

  /**
   * The distinction the rule exists to make: these faces are perfectly good for
   * BODY text, and flagging that would make the checker noise.
   */
  it('accepts a generic face for body text', () => {
    expect(ids('body { font-family: Inter, system-ui, sans-serif; }')).not.toContain(
      'generic-display-face',
    );
  });
});

describe('surface tells', () => {
  it('flags pure black and pure white', () => {
    expect(ids('body { background: #fff; }')).toContain('pure-black-or-white');
    expect(ids('body { color: #000000; }')).toContain('pure-black-or-white');
  });

  it('accepts near-black and near-white', () => {
    expect(ids('body { background: #fafafa; color: #111111; }')).not.toContain(
      'pure-black-or-white',
    );
  });

  it('flags an emoji used as an icon', () => {
    expect(ids('<div class="feature"><span>🚀</span><h3>Fast</h3></div>')).toContain(
      'emoji-as-icon',
    );
  });

  it('leaves emoji inside prose alone', () => {
    // Emoji in copy is a content choice, not a design tell.
    expect(ids('<p>Shipping today 🚀 and we could not be happier</p>')).not.toContain(
      'emoji-as-icon',
    );
  });

  it('flags the rounded card with a coloured left border', () => {
    expect(
      ids('.card { border-left: 4px solid #10b981; padding: 16px; border-radius: 8px; }'),
    ).toContain('left-border-accent-card');
  });
});

describe('state coverage', () => {
  it('flags a data UI that only shows the populated state', () => {
    expect(ids('<table><tr><td>Ada</td></tr></table>')).toContain('populated-state-only');
  });

  it('accepts one that handles empty and error', () => {
    const src = '<table><tr><td>Ada</td></tr></table><p class="empty">No results yet</p><p>Failed to load</p>';
    expect(ids(src)).not.toContain('populated-state-only');
  });

  /**
   * A brochure page has no populated state to be missing. Firing here would make
   * the rule noise on every marketing brief.
   */
  it('does not ask a static page for an empty state', () => {
    expect(ids('<section><h1>Welcome</h1><p>We build things.</p></section>')).not.toContain(
      'populated-state-only',
    );
  });
});

describe('the report itself', () => {
  it('reports nothing for clean markup', () => {
    const clean = `
      :root { --accent: oklch(60% 0.16 250); --bg: #fafafa; --fg: #111111; }
      body { font-family: 'IBM Plex Sans', sans-serif; background: var(--bg); color: var(--fg); }
      h1 { font-family: 'Fraunces', serif; letter-spacing: -0.02em; }
      .label { text-transform: uppercase; letter-spacing: 0.08em; }
    `;
    expect(findSlopTells(clean)).toEqual([]);
    expect(summariseTells([])).toBe('0 P0, 0 P1');
  });

  it('sorts worst-first and points at a line', () => {
    const src = ['body { background: #fff; }', '.btn { background: #6366f1; }'].join('\n');
    const found = findSlopTells(src);
    expect(found[0].severity).toBe('p0');
    expect(found[0].line).toBe(2);
  });

  // A finding without a fix is a complaint, and complaints get ignored.
  it('gives every finding an actionable fix', () => {
    const found = findSlopTells('.btn { background: #6366f1; text-transform: uppercase; }');
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) expect(f.fix.length).toBeGreaterThan(20);
  });

  it('reports each rule at most once, so one bad token is not 40 findings', () => {
    const src = Array.from({ length: 40 }, () => '.x { background: #6366f1; }').join('\n');
    expect(findSlopTells(src).filter((f) => f.rule === 'ai-default-accent')).toHaveLength(1);
  });
});
