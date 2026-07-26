import { describe, it, expect } from 'vitest';
import {
  needsVerification,
  buildVerificationPrompt,
  parseVerdict,
  decideRetry,
  escalateTier,
  outcomeLabel,
  isUnmet,
  MAX_ATTEMPTS,
  ASK_AFTER_CONSECUTIVE_FAILURES,
} from './verification';
import type { Goal, Run } from './types';

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  objective: 'Post a summary of overnight build failures to Slack',
  successCriteria: 'a message was posted to #builds',
  approvalPolicy: 'consequential',
  enabled: true,
  createdAt: 0,
  ...over,
});

const run = (over: Partial<Run> = {}): Run => ({
  id: 'r1',
  goalId: 'g1',
  trigger: 'cron',
  status: 'succeeded',
  startedAt: 1_000,
  endedAt: 2_000,
  durationMs: 1_000,
  deliverables: [],
  ...over,
});

describe('needsVerification', () => {
  it('is true only for real criteria', () => {
    expect(needsVerification(goal())).toBe(true);
    expect(needsVerification(goal({ successCriteria: '   ' }))).toBe(false);
    expect(needsVerification(goal({ successCriteria: undefined }))).toBe(false);
  });
});

describe('buildVerificationPrompt', () => {
  it('includes the objective, criteria, output and deliverables', () => {
    const p = buildVerificationPrompt(
      goal(),
      run({ deliverables: [{ kind: 'message', title: 'Slack post', summary: '3 failures' }] }),
      'Posted the summary.',
    );
    expect(p).toContain('Post a summary of overnight build failures');
    expect(p).toContain('a message was posted to #builds');
    expect(p).toContain('Posted the summary.');
    expect(p).toContain('Slack post');
  });

  // A judge that gives the benefit of the doubt turns verification into
  // decoration, so the instruction must be explicitly strict.
  it('instructs the judge to fail anything it cannot confirm', () => {
    const p = buildVerificationPrompt(goal(), run(), 'something happened');
    expect(p).toMatch(/answer "no"/i);
    expect(p).toMatch(/NOT a pass/i);
    expect(p).toMatch(/Do not give credit for intent/i);
  });

  it('surfaces a run error to the judge', () => {
    expect(buildVerificationPrompt(goal(), run({ error: 'slack 403' }), '')).toContain('slack 403');
  });

  it('says so when there was no output at all', () => {
    expect(buildVerificationPrompt(goal(), run(), '')).toContain('(no output captured)');
  });
});

describe('parseVerdict', () => {
  it('reads a clean verdict', () => {
    expect(parseVerdict('{"passed": true, "note": "message found"}')).toEqual({
      passed: true,
      note: 'message found',
    });
    expect(parseVerdict('{"passed": false, "note": "no post"}')).toMatchObject({ passed: false });
  });

  it('reads a fenced or prose-wrapped verdict', () => {
    expect(parseVerdict('```json\n{"passed":true}\n```').passed).toBe(true);
    expect(parseVerdict('Checking… {"passed":true,"note":"ok"} done').passed).toBe(true);
  });

  // A verification step that defaults to success on confusion manufactures
  // false confidence — worse than having no check at all.
  it('treats anything unreadable as a FAIL', () => {
    for (const bad of ['', '   ', 'yes it passed', '{broken', '{}', '{"passed":"yes"}', '{"passed":1}']) {
      const v = parseVerdict(bad);
      expect(v.passed, JSON.stringify(bad)).toBe(false);
      expect(v.note).toBeTruthy();
    }
  });

  it('caps an over-long note', () => {
    expect(parseVerdict(`{"passed":true,"note":"${'x'.repeat(900)}"}`).note!.length).toBe(300);
  });
});

describe('escalateTier', () => {
  it('climbs toward the most capable tier and stops there', () => {
    expect(escalateTier('cheap')).toBe('good');
    expect(escalateTier('good')).toBe('smort');
    expect(escalateTier('smort')).toBe('stallion');
    expect(escalateTier('stallion')).toBeNull();
  });
});

describe('decideRetry', () => {
  it('does nothing when the run succeeded and met its criteria', () => {
    const d = decideRetry({ goal: goal(), run: run({ verification: { passed: true } }), attempt: 1 });
    expect(d.action).toBe('none');
  });

  it('does nothing for an unverified success (no criteria stated)', () => {
    const d = decideRetry({ goal: goal({ successCriteria: undefined }), run: run(), attempt: 1 });
    expect(d.action).toBe('none');
  });

  it('retries an errored run unchanged — likely transient', () => {
    const d = decideRetry({ goal: goal(), run: run({ status: 'failed', error: 'ETIMEDOUT' }), attempt: 1 });
    expect(d.action).toBe('retry');
    expect(d.reason).toContain('ETIMEDOUT');
  });

  it('retries a timeout too', () => {
    expect(decideRetry({ goal: goal(), run: run({ status: 'timeout' }), attempt: 1 }).action).toBe('retry');
  });

  // The key distinction: a clean run that didn't achieve the goal is a
  // CAPABILITY problem. Repeating it on the same model fails the same way.
  it('escalates the tier when the run succeeded but failed verification', () => {
    const d = decideRetry({
      goal: goal({ tier: 'cheap' }),
      run: run({ verification: { passed: false, note: 'nothing was posted' } }),
      attempt: 1,
    });
    expect(d.action).toBe('escalate');
    expect(d.tier).toBe('good');
    expect(d.reason).toMatch(/didn't meet its criteria/i);
  });

  it('defaults an unspecified goal tier to good when escalating', () => {
    const d = decideRetry({ goal: goal(), run: run({ verification: { passed: false } }), attempt: 1 });
    expect(d.tier).toBe('smort'); // good → smort
  });

  it('asks the human when even the top tier could not meet the criteria', () => {
    const d = decideRetry({
      goal: goal({ tier: 'stallion' }),
      run: run({ verification: { passed: false } }),
      attempt: 1,
    });
    expect(d.action).toBe('ask');
    expect(d.reason).toMatch(/most capable tier/i);
  });

  it('gives up at the attempt ceiling', () => {
    const d = decideRetry({ goal: goal(), run: run({ status: 'failed' }), attempt: MAX_ATTEMPTS });
    expect(d.action).toBe('give_up');
    expect(d.reason).toContain(String(MAX_ATTEMPTS));
  });

  // A goal failing every night must reach the user rather than silently burning
  // three attempts a day forever.
  it('asks the human on a long failure streak, before spending more attempts', () => {
    const d = decideRetry({
      goal: goal({ consecutiveFailures: ASK_AFTER_CONSECUTIVE_FAILURES }),
      run: run({ status: 'failed' }),
      attempt: 1,
    });
    expect(d.action).toBe('ask');
    expect(d.reason).toMatch(/needs attention/i);
  });

  it('the streak check wins over the attempt ceiling', () => {
    const d = decideRetry({
      goal: goal({ consecutiveFailures: 99 }),
      run: run({ status: 'failed' }),
      attempt: MAX_ATTEMPTS + 5,
    });
    expect(d.action).toBe('ask');
  });

  it('never proposes an unbounded number of attempts', () => {
    // Walk the ladder: escalation must terminate.
    let tier: Goal['tier'] = 'cheap';
    const seen: string[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS + 2; attempt++) {
      const d = decideRetry({
        goal: goal({ tier }),
        run: run({ verification: { passed: false } }),
        attempt,
      });
      seen.push(d.action);
      if (d.action !== 'escalate') break;
      tier = d.tier;
    }
    expect(seen.at(-1)).not.toBe('escalate');
  });
});

describe('outcomeLabel / isUnmet', () => {
  // The three states the Cockpit must never conflate.
  it('distinguishes errored, ran-but-unmet, and verified', () => {
    expect(outcomeLabel(run({ status: 'failed' }))).toBe('Failed');
    expect(outcomeLabel(run({ verification: { passed: false } }))).toBe('Ran, but unmet');
    expect(outcomeLabel(run({ verification: { passed: true } }))).toBe('Verified');
    // no criteria ⇒ we only know it didn't error, and we say exactly that
    expect(outcomeLabel(run())).toBe('Succeeded');
  });

  it('labels the remaining statuses', () => {
    expect(outcomeLabel(run({ status: 'timeout' }))).toBe('Timed out');
    expect(outcomeLabel(run({ status: 'cancelled' }))).toBe('Cancelled');
    expect(outcomeLabel(run({ status: 'running' }))).toBe('Running');
    expect(outcomeLabel(run({ status: 'awaiting_approval' }))).toBe('Needs approval');
  });

  it('isUnmet is true only for a clean run that missed its criteria', () => {
    expect(isUnmet(run({ verification: { passed: false } }))).toBe(true);
    expect(isUnmet(run({ verification: { passed: true } }))).toBe(false);
    expect(isUnmet(run())).toBe(false);
    // an errored run is "failed", not "unmet" — different problem, different fix
    expect(isUnmet(run({ status: 'failed', verification: { passed: false } }))).toBe(false);
  });
});
