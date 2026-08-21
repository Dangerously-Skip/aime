import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGoalLoop, type SessionInput } from './goal-loop';
import { writeGoalOnce, writeLedger, type Goal, type Ledger } from './ledger';
import { createSessionRunner } from './session';

/**
 * A LIMIT ENFORCED ONLY AFTER THE MONEY IS GONE IS NOT A LIMIT.
 *
 * `shouldStop` checks the budget BETWEEN sessions. A session itself was
 * unbounded — the harness never passed `maxBudgetUsd` to the provider at all,
 * though the provider has supported it all along. So the cap could only ever be
 * noticed after it had been passed, and a real run reported:
 *
 *     Stopped — Spent $7.57 of $3.00.
 *
 * 2.5x over, reported as a clean stop.
 *
 * These tests drive the REAL loop and assert what each session is actually
 * handed, because the whole failure was a value that was never passed.
 */

let dir = '';

const goal = (budgetUsd: number | null): Goal => ({
  version: 1,
  objective: 'Ship the thing',
  acceptanceCriteria: ['it works'],
  budgetUsd,
  deadlineIso: null,
  sessionCap: 20,
  createdAt: '2026-08-16T00:00:00.000Z',
});

const ledger = (n = 3): Ledger => ({
  version: 1,
  tasks: Array.from({ length: n }, (_, i) => ({
    id: `t-${i + 1}`, title: `Task ${i + 1}`, status: 'todo',
    verify: ['done'], attempts: 0, notes: [], lastVerdict: null,
  })),
} as unknown as Ledger);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'budget-guard-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

/** Run the loop, recording the budget handed to each session. */
async function budgetsSeen(budgetUsd: number | null, costPerSession: number) {
  await writeGoalOnce(dir, goal(budgetUsd));
  await writeLedger(dir, ledger());
  const seen: (number | null)[] = [];
  await runGoalLoop({
    dir,
    runSession: async (input: SessionInput) => {
      seen.push(input.budgetRemainingUsd);
      return { costUsd: costPerSession, summary: 'did a thing', complete: true, error: undefined } as never;
    },
    verify: async () => ({ passed: true, missing: [] }) as never,
  });
  return seen;
}

describe('each session is told what is left', () => {
  it('hands down the remaining budget, shrinking as it spends', async () => {
    const seen = await budgetsSeen(3.0, 1.0);
    expect(seen[0]).toBeCloseTo(3.0);
    expect(seen[1]).toBeCloseTo(2.0);
    expect(seen[2]).toBeCloseTo(1.0);
  });

  it('never hands down a negative budget', async () => {
    /*
     * A session that overspends leaves the remainder negative. Passing that to a
     * provider would be nonsense; zero is the honest answer and the between-
     * sessions check stops the run on the next pass anyway.
     */
    const seen = await budgetsSeen(1.0, 5.0);
    for (const b of seen) expect(b!).toBeGreaterThanOrEqual(0);
  });

  it('stops rather than starting a session with nothing left', async () => {
    // $3 budget, $3 per session: the second session must not start.
    const seen = await budgetsSeen(3.0, 3.0);
    expect(seen).toHaveLength(1);
  });

  it('passes null when the goal has no budget', async () => {
    // `null` is no limit; it must not become 0, which would mean "spend nothing".
    const seen = await budgetsSeen(null, 1.0);
    expect(seen[0]).toBeNull();
  });
});

describe('the session runner forwards it to the provider', () => {
  it('sets maxBudgetUsd on the query — the value that was never passed', async () => {
    /*
     * The provider is the ONLY layer that can stop a turn while it is spending.
     * Everything above it can merely notice afterwards, which is what produced
     * $7.57 of $3.00.
     */
    let sawBudget: number | null | undefined;
    const run = createSessionRunner({
      chatId: 'c', cwd: dir, maxTurns: 5,
      query: (args) => {
        sawBudget = args.maxBudgetUsd;
        return (async function* () { yield { type: 'text', content: 'done' }; })();
      },
    });
    await run({
      dir, sessionIndex: 1, missing: [],
      goal: goal(3), task: { id: 't-1', title: 'x', status: 'doing', verify: ['y'] },
      budgetRemainingUsd: 1.25,
    } as never);
    expect(sawBudget).toBe(1.25);
  });

  it('forwards null unchanged, rather than defaulting to a number', async () => {
    let sawBudget: number | null | undefined = 999;
    const run = createSessionRunner({
      chatId: 'c', cwd: dir, maxTurns: 5,
      query: (args) => {
        sawBudget = args.maxBudgetUsd;
        return (async function* () { yield { type: 'text', content: 'done' }; })();
      },
    });
    await run({
      dir, sessionIndex: 1, missing: [],
      goal: goal(null), task: { id: 't-1', title: 'x', status: 'doing', verify: ['y'] },
      budgetRemainingUsd: null,
    } as never);
    expect(sawBudget).toBeNull();
  });
});
