import { describe, it, expect } from 'vitest';
import { parseRevision, classifyRevision, applyRevision, REVISION_MARKER } from './revision';
import type { Ledger } from './ledger';

/**
 * Revision has to be possible without becoming the thing `illegalChanges` exists
 * to stop: an agent making a hard task easy by deleting it.
 *
 * The split is by CONSEQUENCE. Adding work can only make a run longer, never
 * make it falsely succeed. Removing work, or changing what "done" means, shrinks
 * the definition of success — which is precisely the move reward hacking makes.
 */
const ledger = (): Ledger => ({
  version: 1,
  tasks: [
    { id: 't-001', title: 'Fix add()', verify: ['run test.sh'], status: 'passed', attempts: 1, lastVerdict: { passed: true, missing: [], evidence: ['ran it'], at: 'now' } },
    { id: 't-002', title: 'Add a README', verify: ['README exists'], status: 'todo', attempts: 0, lastVerdict: null },
  ],
});

const rev = (o: Partial<{ add: { title: string; verify: string[] }[]; remove: string[]; reason: string }> = {}) => ({
  add: o.add ?? [], remove: o.remove ?? [], reason: o.reason ?? 'the tests need a fixture first',
});

describe('parseRevision', () => {
  it('returns null when nothing is proposed — the common case', () => {
    expect(parseRevision('Did the work.\nSTATUS: COMPLETE')).toBeNull();
  });

  it('reads a proposal out of a fenced block', () => {
    const r = parseRevision(`${REVISION_MARKER}\n\`\`\`json\n${JSON.stringify(rev({ add: [{ title: 'Write a fixture', verify: ['fixture.json exists'] }] }))}\n\`\`\``);
    expect(r?.add).toHaveLength(1);
    expect(r?.add[0].title).toBe('Write a fixture');
  });

  it('drops an addition with no title rather than adding a blank task', () => {
    const r = parseRevision(`${REVISION_MARKER} ${JSON.stringify(rev({ add: [{ title: '  ', verify: ['x'] }] }))}`);
    expect(r).toBeNull();
  });

  it('returns null for a marker with unreadable JSON', () => {
    expect(parseRevision(`${REVISION_MARKER} { broken`)).toBeNull();
  });
});

describe('classifyRevision', () => {
  it('ADDING is automatic — asking would train the user to click yes', () => {
    const c = classifyRevision(ledger(), rev({ add: [{ title: 'Write a fixture', verify: ['it exists'] }] }));
    expect(c.kind).toBe('auto');
    expect(c.refusals).toEqual([]);
  });

  it('REMOVING needs approval, and says which tasks and why', () => {
    const c = classifyRevision(ledger(), rev({ remove: ['t-002'], reason: 'the README is out of scope' }));
    expect(c.kind).toBe('needs-approval');
    expect(c.approvalPrompt).toContain('Add a README');
    expect(c.approvalPrompt).toContain('out of scope');
  });

  it('REFUSES to remove a task that already passed', () => {
    /*
     * Its verdict is evidence that work was done and checked. Deleting it would
     * erase the record rather than change the plan — and is the cheapest way to
     * make a run look complete.
     */
    const c = classifyRevision(ledger(), rev({ remove: ['t-001'] }));
    expect(c.refusals.some((r) => r.includes('t-001'))).toBe(true);
    expect(c.kind).toBe('none');
  });

  it('refuses an added task with no verification steps', () => {
    // Same rule the initializer applies: nothing to check can never pass.
    const c = classifyRevision(ledger(), rev({ add: [{ title: 'Make it good', verify: [] }] }));
    expect(c.refusals.some((r) => r.includes('Make it good'))).toBe(true);
  });

  it('requires a reason', () => {
    const c = classifyRevision(ledger(), { add: [{ title: 'x', verify: ['y'] }], remove: [], reason: '' });
    expect(c.refusals.some((r) => /reason/i.test(r))).toBe(true);
  });

  it('refuses a removal of a task that does not exist', () => {
    const c = classifyRevision(ledger(), rev({ remove: ['t-999'] }));
    expect(c.refusals.some((r) => r.includes('t-999'))).toBe(true);
  });
});

describe('applyRevision', () => {
  it('appends new tasks with ids that continue past the highest used', () => {
    const out = applyRevision(ledger(), rev({ add: [{ title: 'A', verify: ['x'] }, { title: 'B', verify: ['y'] }] }), false);
    expect(out.tasks.map((t) => t.id)).toEqual(['t-001', 't-002', 't-003', 't-004']);
  });

  it('never REUSES the id of a removed task', () => {
    /*
     * The case the count-based version cannot see. After a removal the list is
     * shorter than the highest id ever issued, so numbering from the length
     * hands a new task the id of a retired one — and ids key every patch, every
     * run record and every verdict.
     */
    const shrunk = applyRevision(ledger(), rev({ remove: ['t-002'] }), true);
    expect(shrunk.tasks.map((t) => t.id)).toEqual(['t-001']);
    const grown = applyRevision(shrunk, rev({ add: [{ title: 'New', verify: ['x'] }] }), false);
    expect(grown.tasks.map((t) => t.id)).toEqual(['t-001', 't-003']);
    expect(grown.tasks.map((t) => t.id)).not.toContain('t-002');
  });

  it('does NOT remove anything unless removals are approved', () => {
    const out = applyRevision(ledger(), rev({ remove: ['t-002'] }), false);
    expect(out.tasks.map((t) => t.id)).toEqual(['t-001', 't-002']);
  });

  it('removes once approved', () => {
    const out = applyRevision(ledger(), rev({ remove: ['t-002'] }), true);
    expect(out.tasks.map((t) => t.id)).toEqual(['t-001']);
  });

  it('still refuses to remove a passed task, even when approved', () => {
    // Approval is for changing the plan, not for erasing evidence.
    const out = applyRevision(ledger(), rev({ remove: ['t-001'] }), true);
    expect(out.tasks.map((t) => t.id)).toContain('t-001');
  });

  it('leaves existing tasks otherwise untouched', () => {
    const out = applyRevision(ledger(), rev({ add: [{ title: 'A', verify: ['x'] }] }), false);
    expect(out.tasks[0]).toEqual(ledger().tasks[0]);
    expect(out.tasks[1]).toEqual(ledger().tasks[1]);
  });

  it('drops an addition with no verify even when applying', () => {
    const out = applyRevision(ledger(), rev({ add: [{ title: 'Vague', verify: [] }] }), false);
    expect(out.tasks.map((t) => t.title)).not.toContain('Vague');
  });
});
