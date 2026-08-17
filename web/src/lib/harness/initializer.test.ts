import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlanPrompt, parsePlan, initializeGoal } from './initializer';
import { readGoal, readLedger } from './ledger';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-init-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const PLAN = JSON.stringify({
  objective: 'Every embed in the deck plays',
  acceptanceCriteria: ['no Error 153 in any frame'],
  tasks: [
    { title: 'Serve the deck over http', verify: ['curl the preview URL', 'expect HTTP 200'] },
    { title: 'Give video a layout', verify: ['open slide 3', 'the player fits inside the slide'] },
  ],
});

describe('buildPlanPrompt', () => {
  it('says not to do the work yet', () => {
    // A planner that starts building produces a plan shaped by what it happened
    // to do first.
    expect(buildPlanPrompt('do a thing', '')).toMatch(/will NOT do the work now/i);
  });

  it('demands observable verification steps and says why', () => {
    const p = buildPlanPrompt('do a thing', '');
    expect(p).toMatch(/OBSERVABLE/);
    expect(p).toMatch(/"Works correctly" is not a check/);
    // The reason matters: another agent runs these later and cannot read minds.
    expect(p.replace(/\s+/g, ' ')).toMatch(/another agent will run these/i);
  });

  it('asks for small, ordered, one-session tasks', () => {
    const p = buildPlanPrompt('do a thing', '');
    expect(p).toMatch(/Order them/i);
    expect(p).toMatch(/ONE session of work/i);
    expect(p).toMatch(/Prefer more, smaller tasks/i);
  });

  it('includes context when there is some, and omits the header when not', () => {
    expect(buildPlanPrompt('x', 'the repo uses Vite')).toContain('the repo uses Vite');
    expect(buildPlanPrompt('x', '   ')).not.toContain('# Context');
  });
});

describe('parsePlan', () => {
  it('reads a bare JSON object', () => {
    const r = parsePlan(PLAN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.goal.objective).toBe('Every embed in the deck plays');
    expect(r.value.tasks).toHaveLength(2);
  });

  it('reads it out of a fenced block with preamble and trailing prose', () => {
    // The normal shape of a model response, and not worth failing over.
    const r = parsePlan(`Here is the plan.\n\n\`\`\`json\n${PLAN}\n\`\`\`\n\nLet me know.`);
    expect(r.ok).toBe(true);
  });

  it('assigns OUR ids, ordered and padded', () => {
    /*
     * Ids are ours, not the model's: they key every patch and every run record,
     * so a duplicate or a reused one would make an update ambiguous.
     */
    const r = parsePlan(PLAN);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.tasks.map((t) => t.id)).toEqual(['t-001', 't-002']);
  });

  it('ignores any id the model tried to set', () => {
    const withIds = JSON.stringify({
      objective: 'x',
      tasks: [{ id: 'whatever-it-liked', title: 'a', verify: ['check a'] }],
    });
    const r = parsePlan(withIds);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.tasks[0].id).toBe('t-001');
  });

  it('starts every task at todo with no attempts', () => {
    const r = parsePlan(PLAN);
    if (!r.ok) throw new Error(r.error);
    for (const t of r.value.tasks) {
      expect(t.status).toBe('todo');
      expect(t.attempts).toBe(0);
      expect(t.lastVerdict).toBeNull();
    }
  });

  it('REFUSES a task with no verification steps', () => {
    /*
     * A task with nothing to check can never legitimately pass — in phase 2 the
     * verifier would have nothing to run. Refusing here means the failure has a
     * message that says what went wrong, rather than surfacing as a task that
     * mysteriously never completes.
     */
    const bad = JSON.stringify({ objective: 'x', tasks: [{ title: 'Do it properly', verify: [] }] });
    const r = parsePlan(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Do it properly');
  });

  it('refuses blank verification steps dressed up as steps', () => {
    const bad = JSON.stringify({ objective: 'x', tasks: [{ title: 'a', verify: ['  ', ''] }] });
    expect(parsePlan(bad).ok).toBe(false);
  });

  it('refuses an empty task list', () => {
    // The loop would read no tasks as "everything is blocked"; the message
    // should say what actually happened.
    const r = parsePlan(JSON.stringify({ objective: 'x', tasks: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no tasks/);
  });

  it('refuses a plan with no objective', () => {
    expect(parsePlan(JSON.stringify({ objective: '  ', tasks: [] })).ok).toBe(false);
  });

  it('refuses a response with no JSON at all', () => {
    const r = parsePlan('I think we should start by looking at the deck.');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no JSON/);
  });

  it('refuses malformed JSON rather than salvaging half of it', () => {
    expect(parsePlan(`{ "objective": "x", "tasks": [`).ok).toBe(false);
  });
});

describe('initializeGoal', () => {
  const base = {
    objective: 'Make the deck work',
    budgetUsd: 5,
    deadlineIso: null,
    sessionCap: 20,
    nowIso: () => '2026-08-16T00:00:00.000Z',
  };

  it('writes the goal and the ledger', async () => {
    const r = await initializeGoal({ ...base, dir, plan: async () => PLAN });
    expect(r.ok).toBe(true);

    const goal = await readGoal(dir);
    const ledger = await readLedger(dir);
    expect(goal.ok && goal.value.objective).toBe('Every embed in the deck plays');
    expect(ledger.ok && ledger.value.tasks).toHaveLength(2);
  });

  it('takes stop conditions from the USER, not the plan', async () => {
    /*
     * A model that sets its own budget has no budget, and a planner has every
     * incentive to be optimistic about what its work will cost.
     */
    const greedy = JSON.stringify({
      objective: 'x',
      budgetUsd: 10_000,
      sessionCap: 9999,
      tasks: [{ title: 'a', verify: ['check a'] }],
    });
    const r = await initializeGoal({ ...base, dir, plan: async () => greedy });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.goal.budgetUsd).toBe(5);
    expect(r.goal.sessionCap).toBe(20);
  });

  it('refuses to re-plan over an existing goal', async () => {
    // Re-planning would orphan the ledger and the progress log of a run in
    // flight; a new conversation is the honest recovery.
    await initializeGoal({ ...base, dir, plan: async () => PLAN });
    const second = await initializeGoal({ ...base, dir, plan: async () => PLAN });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/already has a goal/);
  });

  it('writes NOTHING when the plan is unusable', async () => {
    const r = await initializeGoal({ ...base, dir, plan: async () => 'no plan here' });
    expect(r.ok).toBe(false);
    // A half-initialised directory is worse than an empty one: the loop would
    // find a goal and no ledger.
    expect((await readGoal(dir)).ok).toBe(false);
    expect((await readLedger(dir)).ok).toBe(false);
  });

  it('reports a planner that threw, rather than throwing', async () => {
    const r = await initializeGoal({
      ...base, dir,
      plan: async () => { throw new Error('model unreachable'); },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/model unreachable/);
  });

  it('refuses an empty objective before spending a session on it', async () => {
    let called = false;
    const r = await initializeGoal({
      ...base, dir, objective: '   ',
      plan: async () => { called = true; return PLAN; },
    });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});
