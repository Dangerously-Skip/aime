// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { RunLog } from './run-log';
import type { Run } from '@/lib/runs/types';

/**
 * EVENTS ON ACTIVITY, STATE ON THE COCKPIT — enforced, not described.
 *
 * The Cockpit rendered "Recent activity" — a table of finished one-off runs —
 * directly beneath the widgets, on a tab sitting next to one called Activity.
 * Asked as "cockpit panel is showing both the widgets and the activity…
 * shouldn't activity be on the activity tab?"
 *
 * Yes, by the rule this codebase already applies: a finished run has a start
 * time and never changes again, which is what a feed is for. The same rule
 * moved the widget quick-add buttons the OTHER way a day earlier, and applying
 * it in one direction only is how the two tabs came to read as one screen.
 *
 * The distinction that keeps this from being a blanket "no runs on the
 * Cockpit": a run belonging to a GOAL is that goal's health — the evidence for
 * "currently failing", which without it is an uncited claim. A run belonging to
 * nothing is history. The split is by ownership.
 */

const run = (over: Partial<Run> = {}): Run =>
  ({
    id: 'r1',
    goalId: undefined,
    trigger: 'manual',
    status: 'succeeded',
    startedAt: Date.now() - 60_000,
    durationMs: 1_000,
    model: 'deepseek/deepseek-v4-pro',
    deliverables: [],
    ...over,
  }) as Run;

beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runs: [] }) })));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the run log', () => {
  it('shows runs that belong to nothing', () => {
    render(<RunLog runs={[run({ id: 'a' })]} now={Date.now()} />);
    expect(screen.getByText(/deepseek/)).toBeTruthy();
  });

  it("EXCLUDES a goal's own runs — those are its health, shown in its card", () => {
    /*
     * Without this the same run appears twice: once as the evidence for a
     * goal's failure streak and once in a global feed, and a user counting
     * runs gets a different answer depending which they read.
     */
    render(<RunLog runs={[run({ id: 'b', goalId: 'goal-1' })]} now={Date.now()} />);
    expect(screen.getByText(/no runs recorded yet/i)).toBeTruthy();
  });

  it('distinguishes loading from empty', () => {
    // "No runs recorded yet" while still fetching is a claim about the user's
    // history that we do not yet have the data to make.
    const { rerender } = render(<RunLog runs={[]} now={Date.now()} loading />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
    rerender(<RunLog runs={[]} now={Date.now()} loading={false} />);
    expect(screen.getByText(/no runs recorded yet/i)).toBeTruthy();
  });
});

describe('where each surface puts runs', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
  const cockpit = read('src/components/surfaces/assistant/cockpit.tsx');
  const surface = read('src/components/surfaces/assistant/assistant-surface.tsx');

  it('the Cockpit does not render the global run log', () => {
    expect(cockpit, 'the ad-hoc run log is back on the Cockpit').not.toContain('<RunLog');
    expect(cockpit).not.toContain('Recent activity');
  });

  it('the Activity tab does', () => {
    expect(surface).toContain('<RunLog');
  });

  it("the Cockpit still shows a goal's own runs", () => {
    // The other half. Removing the feed must not take the evidence with it —
    // a failure streak you cannot open is a number you have to trust.
    expect(cockpit).toContain('RunStrip');
    expect(cockpit).toContain('RunRow');
  });

  it('both read the SAME run source', () => {
    /*
     * Two independent fetches of the same log drift the moment one refreshes
     * and the other does not — and the Cockpit header shows a total spend that
     * would then disagree with the rows on the other tab.
     */
    expect(cockpit).toContain('useRunLog');
    expect(surface).toContain('useRunLog');
    // And neither may go back to fetching it directly. Matched on the CALL,
    // not the string — the Cockpit legitimately names the endpoint in a comment.
    expect(cockpit).not.toMatch(/fetch\(\s*["'`]\/api\/runs/);
    expect(surface).not.toMatch(/fetch\(\s*["'`]\/api\/runs/);
  });
});
