import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * THE CAP HAS TO REACH THE PROVIDER, not merely be computed.
 *
 * `budget-guard.test.ts` proves the loop stops between sessions. It mocks
 * `query`, which is exactly the boundary the in-session cap crosses — so the
 * harness route could destructure `{prompt, chatId, maxTurns, cwd}` and silently
 * drop `maxBudgetUsd`, and every test stayed green while a real run reported
 * "$7.57 of $3.00".
 *
 * A behavioural test here would need the whole provider; the honest cheap check
 * is that the lambda both ACCEPTS and FORWARDS the parameter, since dropping
 * either half is the bug.
 */

const route = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/harness/route.ts'),
  'utf8',
);

/** The `query:` lambda the harness hands to the loop. */
function queryLambda(): string {
  const at = route.indexOf('query: ({');
  expect(at, 'the harness query lambda has moved or changed shape').toBeGreaterThan(-1);
  return route.slice(at, at + 900);
}

describe('the in-session budget cap', () => {
  it('is destructured from the loop call', () => {
    expect(queryLambda()).toMatch(/query: \(\{[^}]*maxBudgetUsd/);
  });

  it('is forwarded to provider.query', () => {
    // Accepting it and not passing it on is precisely what shipped.
    expect(queryLambda()).toMatch(/maxBudgetUsd:\s*maxBudgetUsd/);
  });

  it('something actually supplies one — the whole chain', () => {
    /*
     * A forwarded parameter nothing sets is still no cap, so this walks the
     * chain rather than trusting the last hop:
     *
     *   goal-loop computes `budgetRemainingUsd` (what is left of the run's
     *     budget after previous sessions)
     *   → session.ts renames it to `maxBudgetUsd` on the query call
     *   → the harness route forwards that to provider.query   ← was dropped
     *
     * The rename is why the route's omission was easy to miss reading either
     * file alone.
     */
    const loop = fs.readFileSync(path.join(process.cwd(), 'src/lib/harness/goal-loop.ts'), 'utf8');
    expect(loop, 'the loop computes no remaining budget').toMatch(/budgetRemainingUsd:/);

    const session = fs.readFileSync(path.join(process.cwd(), 'src/lib/harness/session.ts'), 'utf8');
    expect(session, 'the session does not map it onto the query').toMatch(
      /maxBudgetUsd:\s*input\.budgetRemainingUsd/,
    );
  });
});
