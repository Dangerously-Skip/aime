import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { summarizeToolBudget, TOOL_BUDGET } from './filter';

/**
 * `filterMcpServers` and `connectorIdForServerKey` were tested here and are gone.
 * The per-request deny list they implemented duplicated the server-side stash
 * (`/api/connectors/provision?intent=disable` → `config.disabledMcpServers`) at
 * strictly worse cost, because it ran after the load. The behaviour those tests
 * pinned — a switched-off connector is not mounted — now lives where the mechanism
 * does: mcp/disabled-connector-cost.test.ts, which also measures what the
 * duplicate cost per message.
 */

describe('summarizeToolBudget', () => {
  const mcpTools = (server: string, n: number) =>
    Array.from({ length: n }, (_, i) => `mcp__${server}__tool${i}`);

  it('groups by server and counts built-ins separately', () => {
    const report = summarizeToolBudget([
      'Read',
      'Write',
      'Bash',
      ...mcpTools('aime-connector-github', 3),
      ...mcpTools('aime-mcp-atlassian', 2),
    ]);
    expect(report.total).toBe(8);
    expect(report.builtinCount).toBe(3);
    expect(report.perServer).toEqual([
      { server: 'aime-connector-github', count: 3 },
      { server: 'aime-mcp-atlassian', count: 2 },
    ]);
  });

  it('handles server names containing underscores', () => {
    const report = summarizeToolBudget(['mcp__web_search__query', 'mcp__web_search__fetch']);
    expect(report.perServer).toEqual([{ server: 'web_search', count: 2 }]);
  });

  it('handles the in-process aime server', () => {
    const report = summarizeToolBudget(['mcp__aime__canvas', 'mcp__aime__RequestConnector']);
    expect(report.perServer).toEqual([{ server: 'aime', count: 2 }]);
  });

  it('is not over budget for a modest set', () => {
    const report = summarizeToolBudget(['Read', ...mcpTools('a', 10)]);
    expect(report.overBudget).toBe(false);
    expect(report.advice).toBeUndefined();
  });

  it('flags over-budget and names the biggest offender to switch off', () => {
    const report = summarizeToolBudget([
      ...mcpTools('aime-connector-github', 100),
      ...mcpTools('aime-mcp-atlassian', 30),
    ]);
    expect(report.total).toBe(130);
    expect(report.overBudget).toBe(true);
    expect(report.advice).toContain('aime-connector-github');
    expect(report.advice).toContain('100');
  });

  it('warns rather than truncating — the caller still sees every tool', () => {
    // Silently dropping tools would make failures inexplicable.
    const names = mcpTools('big', TOOL_BUDGET + 50);
    const report = summarizeToolBudget(names);
    expect(report.total).toBe(names.length);
    expect(report.perServer[0].count).toBe(names.length);
  });

  it('handles an empty tool list', () => {
    expect(summarizeToolBudget([])).toMatchObject({
      total: 0,
      builtinCount: 0,
      perServer: [],
      overBudget: false,
    });
  });

  it('property: counts always partition the input exactly', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 })), (names) => {
        const r = summarizeToolBudget(names);
        const grouped = r.perServer.reduce((sum, s) => sum + s.count, 0);
        expect(grouped + r.builtinCount).toBe(names.length);
        expect(r.total).toBe(names.length);
      }),
      { numRuns: 300 },
    );
  });
});
