import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * What the caller is told when the upstream provider rejects a request.
 *
 * Every status except 401/403 used to collapse to 502. Four unrelated problems
 * then looked identical from the outside:
 *
 *   - 400 — the translated request is malformed
 *   - 404 — that model no longer exists
 *   - 429 — rate limited, i.e. slow down and retry
 *   - 5xx — the provider really is down
 *
 * A user watching this saw `502 in 60ms` interleaved with `200 in 10.7s` and had
 * no way to tell which. The upstream's own explanation DID exist, in a response
 * body that went to the SDK subprocess and nowhere a human reads — so the first
 * question asked about it ("are the 502s from models that aren't available
 * anymore?") could not be answered from the logs at all. It turned out the
 * models were all live on OpenRouter; the mapping had destroyed the evidence.
 *
 * 429 is the one that did active harm rather than merely hiding information.
 * The Agent SDK backs off and retries a rate limit and honours `retry-after`;
 * it cannot do either for a 502. Masking one as the other turned a recoverable
 * pause into a failed turn.
 *
 * Asserted against source because the route's POST needs a live upstream, a
 * provider record and a credential store to reach this branch; the mapping
 * itself is a pure decision and is what regresses.
 */

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../app/api/llm-proxy/[...slug]/route.ts'),
  'utf-8',
);

/**
 * Evaluate the route's own `callerStatusFor` rather than a copy of it — a test
 * that reimplements the rule proves the reimplementation, not the code.
 */
function callerStatusFor(upstream: number): number {
  const body = /function callerStatusFor\(upstream: number\): number \{([\s\S]*?)\n\}/.exec(SRC)?.[1];
  if (!body) throw new Error('callerStatusFor not found — has it been renamed?');
  return new Function('upstream', body)(upstream) as number;
}

describe('an upstream rejection reaches the caller as itself', () => {
  it.each([400, 401, 403, 404, 408, 413, 422, 429])('passes %i through', (status) => {
    expect(
      callerStatusFor(status),
      `${status} is being masked — the caller cannot tell what went wrong`,
    ).toBe(status);
  });

  /** From the caller's side the provider really is a bad gateway here. */
  it.each([500, 502, 503, 504])('reports %i as 502', (status) => {
    expect(callerStatusFor(status)).toBe(502);
  });

  /**
   * The regression, stated as the case that cost the most: a rate limit the SDK
   * could have waited out, delivered as a failure it cannot.
   */
  it('does not turn a rate limit into a gateway error', () => {
    expect(callerStatusFor(429), 'a 429 masked as 502 is not retried').not.toBe(502);
  });
});

describe('the failure is diagnosable after the fact', () => {
  it('logs the upstream status, the model, and the reason', () => {
    const log = /console\.error\(\s*`\[llm-proxy\][^`]*`/.exec(SRC)?.[0] ?? '';
    expect(log, 'no upstream logging — the reason goes only to the subprocess').not.toBe('');
    expect(log).toContain('${upstreamRes.status}');
    expect(log, 'the model is what distinguishes a dead model from a bad request')
      .toContain('${body.model}');
    expect(log, 'the upstream body is the only place the actual reason appears')
      .toContain('detail');
  });

  it('types a rate limit as one, since the SDK switches on that', () => {
    expect(SRC).toMatch(/rate_limit_error/);
  });

  it('forwards the retry hints instead of dropping them', () => {
    const fn = /function retryHeaders\(res: Response\)[\s\S]*?\n\}/.exec(SRC)?.[0] ?? '';
    expect(fn, 'retryHeaders not found').not.toBe('');
    expect(fn).toContain('retry-after');
  });
});
