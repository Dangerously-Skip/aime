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
    expect(out[0].content).toMatch(/Goal panel/);
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
