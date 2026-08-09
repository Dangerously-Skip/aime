import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Two places start a turn, and they must describe the same user.
 *
 * The composer sends what you typed. The auto-continue — fired when the agent
 * looks like it ran out of turns mid-task — sends a follow-up of its own. That
 * second path hand-copied a subset of the request fields, and the subset drifted
 * until it was missing eight of them.
 *
 * The visible symptom was a deck. A user chose "Magazine Bold" in
 * Customize → Design, asked for a themed deck, the turn auto-continued, and the
 * deck came back unstyled — because the continuation ran as a user with no theme
 * set. The model even said so: "I'm not seeing any custom brand or styling
 * configuration in your setup — just the default." It was telling the truth
 * about the request it received.
 *
 * `searchSettings`, `memories`, `projectInstructions`, `projectKnowledge`,
 * `crossSurfaceContext`, `contextBusEvents` and `securitySettings` went the same
 * way. Security was the only one with a server-side fallback
 * (`loadSecuritySettings`), so it was the only one that did not silently change
 * behaviour — which is exactly why nobody noticed the rest.
 *
 * Asserted against source: this is a wiring property of the component, and a
 * rendering test would need the whole surface, its stores and a live SSE mock to
 * observe the payload of a code path that fires on a heuristic.
 */

const SRC = fs.readFileSync(
  path.resolve(__dirname, 'cowork-surface.tsx'),
  'utf-8',
);

/** The body of a `sendMessage(...)` call, from its opening brace. */
function sendCalls(): string[] {
  return [...SRC.matchAll(/sendMessage\([^)]*?,\s*\{([\s\S]{0,2000}?)\n\s{6,14}\}\);/g)].map(
    (m) => m[1],
  );
}

describe('every turn carries the same settings', () => {
  const calls = sendCalls();

  it('finds both send sites', () => {
    expect(calls.length, 'expected the composer and the auto-continue').toBeGreaterThanOrEqual(2);
  });

  /**
   * The fix is structural, not a longer checklist: both callers spread ONE
   * builder. A future field added to `turnContext` reaches both for free, which
   * a second hand-written list can never promise.
   */
  it('every send site spreads the shared context rather than listing fields', () => {
    calls.forEach((body, i) => {
      expect(
        body,
        `send site ${i + 1} builds its own settings payload instead of spreading turnContext()`,
      ).toContain('...turnContext()');
    });
  });

  /**
   * The specific regression. `deckTheme` must not be re-listed at a call site,
   * because a call site that names it is a call site that can forget it.
   */
  it('no send site hand-lists deckTheme or searchSettings', () => {
    for (const body of calls) {
      expect(body, 'deckTheme is set per-call again').not.toMatch(/^\s*deckTheme[,:]/m);
      expect(body, 'searchSettings is set per-call again').not.toMatch(/^\s*searchSettings[,:]/m);
    }
  });
});

describe('the shared context carries what has no server-side fallback', () => {
  const builder =
    /const turnContext = useCallback\(\s*\(\) => \(\{([\s\S]*?)\}\),/.exec(SRC)?.[1] ?? '';

  it('exists', () => {
    expect(builder, 'turnContext not found — has it been renamed?').not.toBe('');
  });

  /**
   * Each of these is lost outright if the request omits it. `securitySettings`
   * is included too, but for a different reason: it DOES fall back server-side,
   * so leaving it out degrades quietly to the persisted values rather than to
   * nothing — the kind of near-miss worth pinning.
   */
  it.each([
    'deckTheme',
    'searchSettings',
    'projectInstructions',
    'projectKnowledge',
    'crossSurfaceContext',
    'securitySettings',
    'personalPreferences',
    'displayName',
  ])('carries %s', (field) => {
    expect(builder, `${field} is not in the shared context`).toMatch(
      new RegExp(`\\b${field}\\b`),
    );
  });

  /**
   * Per-message things must NOT be in here. `history` and `attachments`
   * legitimately differ between the composer and a continuation, and freezing
   * them into shared context would send the wrong conversation.
   */
  it.each(['history', 'attachments'])('does not capture the per-message %s', (field) => {
    expect(builder, `${field} belongs to the individual send, not the shared context`).not.toMatch(
      new RegExp(`^\\s*${field}[,:]`, 'm'),
    );
  });
});
