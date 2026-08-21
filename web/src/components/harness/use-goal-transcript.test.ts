import { describe, it, expect } from 'vitest';
import { transcriptLines, type TranscriptStatus } from './use-goal-transcript';

/**
 * The transcript is the interface.
 *
 * A run completed two tasks, changed real code and reported "$0.27 of $2.00" in
 * green — and still read as "I'm not sure it even ran", because all of it
 * happened in a side panel while the centre of the screen showed something else.
 */
const status = (over: Partial<TranscriptStatus> = {}): TranscriptStatus => ({
  running: true,
  goal: { objective: 'Add subtract and divide' },
  ledger: { tasks: [{ id: 't-001', title: 'Implement divide', status: 'doing' }] },
  run: { sessions: 1, spentUsd: 0.27 },
  decision: null,
  events: [],
  question: null,
  ...over,
});

describe('transcriptLines', () => {
  it('says nothing when there is no goal — ordinary chat is untouched', () => {
    expect(transcriptLines(status({ goal: null }))).toEqual([]);
  });

  it('announces each session, naming the task rather than its id', () => {
    const out = transcriptLines(status({ events: [{ type: 'session-start', sessionIndex: 1, taskId: 't-001' }] }));
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('Session 1');
    expect(out[0].content).toContain('Implement divide');
  });

  it('reports a verdict, and distinguishes pass from rejection', () => {
    const passed = transcriptLines(status({ events: [{ type: 'verify-end', sessionIndex: 1, taskId: 't-001', detail: 'passed' }] }));
    expect(passed[0].content).toContain('Checked and passed');

    const failed = transcriptLines(status({ events: [{ type: 'verify-end', sessionIndex: 1, taskId: 't-001', detail: 'still returns Infinity' }] }));
    expect(failed[0].content).toContain('rejected');
    expect(failed[0].content).toContain('still returns Infinity');
  });

  it('surfaces a rejected plan edit', () => {
    const out = transcriptLines(status({ events: [{ type: 'tamper', sessionIndex: 2, detail: 'task t-2 was removed' }] }));
    expect(out[0].content).toContain('Rejected a plan edit');
  });

  it('puts a parked question in the transcript, and says where to answer', () => {
    // Otherwise the run is waiting and the transcript looks idle.
    const out = transcriptLines(status({ question: { id: 'q1', question: 'Throw or return null?' } }));
    expect(out[0].content).toContain('needs a decision from you');
    expect(out[0].content).toContain('Throw or return null?');
    expect(out[0].content).toMatch(/above the composer/);
  });

  it('reports the ending WITH the spend, which is the number that was invisible', () => {
    const out = transcriptLines(
      status({ running: false, decision: { stop: true, reason: 'complete', detail: 'All 2 tasks passed.' } }),
    );
    const last = out[out.length - 1];
    expect(last.content).toContain('Goal complete');
    expect(last.content).toContain('$0.27');
    expect(last.content).toContain('1 session');
  });

  it('does not announce an ending while it is still RUNNING', () => {
    /*
     * A decision is present on the status object before the loop has actually
     * stopped. The first version of this test passed `decision: null`, so
     * deleting the `!running` guard changed nothing and the sabotage passed.
     */
    const out = transcriptLines(
      status({ running: true, decision: { stop: true, reason: 'complete', detail: 'All done.' } }),
    );
    expect(out.some((l) => l.content.includes('Goal complete'))).toBe(false);
  });

  it('gives every line a STABLE key, so a 3s poll does not repeat it', () => {
    /*
     * The whole thing polls, so each event is seen many times. Without stable
     * keys the same line would append twenty times a minute.
     */
    const s = status({
      events: [
        { type: 'session-start', sessionIndex: 1, taskId: 't-001' },
        { type: 'verify-end', sessionIndex: 1, taskId: 't-001', detail: 'passed' },
      ],
    });
    const a = transcriptLines(s).map((l) => l.key);
    const b = transcriptLines(s).map((l) => l.key);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('keys a session and its verdict separately', () => {
    const out = transcriptLines(status({
      events: [
        { type: 'session-start', sessionIndex: 1, taskId: 't-001' },
        { type: 'verify-end', sessionIndex: 1, taskId: 't-001', detail: 'passed' },
      ],
    }));
    expect(new Set(out.map((l) => l.key)).size).toBe(2);
  });
});

describe('a stopped run says it has stopped — to the model, not just the user', () => {
  /*
   * These lines are posted as ASSISTANT turns, so they are the history of every
   * later turn in the conversation. After a run stopped on budget, the model
   * read "Session 1 — working on…", "Checked and passed", and carried on in the
   * same voice: "Now let me verify t-002", "t-002 verified" — with no verifier,
   * no ledger write and no run. The plan never moved and the panel looked broken.
   *
   * A false claim of verification is the worst failure this system has, because
   * verification is the only reason to trust any of it.
   */
  const stopped = (reason: string) =>
    transcriptLines({
      runIndex: 1,
      goal: { objective: 'do the thing' },
      ledger: { tasks: [{ id: 't-001', title: 'one', status: 'passed' }] },
      run: { sessions: 2, spentUsd: 7.57 },
      decision: { stop: true, reason, detail: 'Spent $7.57 of $3.00.' },
      events: [],
      running: false,
    } as never);

  const stopLine = (reason = 'budget') =>
    stopped(reason).find((l) => l.content.includes('**Goal'))!.content;

  it('still reports what happened', () => {
    expect(stopLine()).toContain('Spent $7.57 of $3.00.');
    expect(stopLine()).toContain('2 sessions');
  });

  it('states there is no verifier running', () => {
    expect(stopLine()).toMatch(/no\s+verifier running/i);
  });

  it('forbids narrating sessions and claiming verification', () => {
    const c = stopLine();
    expect(c).toMatch(/do not narrate sessions/i);
    expect(c).toMatch(/claim a task is verified/i);
  });

  it('says the plan will not change, so the panel is not "broken"', () => {
    expect(stopLine()).toMatch(/plan will not change/i);
  });

  it('names the way to start another run', () => {
    // A wall with no door is how a model ends up inventing one.
    expect(stopLine()).toMatch(/pursue goal/i);
  });

  it('says it on completion too, not only on a budget stop', () => {
    // A completed run is just as able to be spoken for after the fact.
    expect(stopLine('complete')).toMatch(/no\s+verifier running/i);
  });
});
