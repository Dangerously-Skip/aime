import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  filterMcpServers,
  connectorIdForServerKey,
  summarizeToolBudget,
  TOOL_BUDGET,
} from './filter';

describe('connectorIdForServerKey', () => {
  it('recovers ids from current and legacy key shapes', () => {
    expect(connectorIdForServerKey('aime-connector-github')).toBe('github');
    expect(connectorIdForServerKey('aime-mcp-atlassian')).toBe('atlassian');
    expect(connectorIdForServerKey('nib-connector-miro')).toBe('miro');
    expect(connectorIdForServerKey('nib-mcp-figma')).toBe('figma');
  });

  it('returns null for servers we do not manage', () => {
    for (const key of ['playwright', 'web-search', 'my-own-server', '']) {
      expect(connectorIdForServerKey(key), key).toBeNull();
    }
  });
});

describe('filterMcpServers', () => {
  const servers = {
    'aime-connector-github': { type: 'http' },
    'aime-mcp-atlassian': { type: 'http' },
    'web-search': { command: 'npx' },
    playwright: { command: 'npx' },
  };

  it('drops only the disabled connector', () => {
    const { servers: kept, removed } = filterMcpServers(servers, ['github']);
    expect(Object.keys(kept).sort()).toEqual(['aime-mcp-atlassian', 'playwright', 'web-search']);
    expect(removed).toEqual(['aime-connector-github']);
  });

  it('never filters servers the app does not manage', () => {
    // The toggle governs connectors, not a hand-written .mcp.json entry.
    const { servers: kept } = filterMcpServers(servers, ['web-search', 'playwright']);
    expect(kept['web-search']).toBeDefined();
    expect(kept.playwright).toBeDefined();
  });

  it('mounts everything when nothing is disabled', () => {
    expect(filterMcpServers(servers, []).servers).toBe(servers);
    expect(filterMcpServers(servers, undefined).servers).toBe(servers);
  });

  it('mounts everything when the caller sends no list at all', () => {
    // An older renderer, or a scheduled server-side run with no UI state.
    // Unmounting by default would silently strip an unattended run of its tools.
    const { servers: kept, removed } = filterMcpServers(servers, undefined);
    expect(Object.keys(kept)).toHaveLength(4);
    expect(removed).toEqual([]);
  });

  it('handles an absent server map', () => {
    expect(filterMcpServers(undefined, ['github'])).toEqual({ servers: {}, removed: [] });
  });

  it('can disable every managed connector without touching the rest', () => {
    const { servers: kept } = filterMcpServers(servers, ['github', 'atlassian']);
    expect(Object.keys(kept).sort()).toEqual(['playwright', 'web-search']);
  });

  it('property: filtering never adds a server and never keeps a disabled one', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom(
            'aime-connector-github',
            'aime-mcp-atlassian',
            'nib-connector-miro',
            'playwright',
            'web-search',
          ),
          fc.constant({ type: 'http' }),
        ),
        fc.array(fc.constantFrom('github', 'atlassian', 'miro', 'playwright')),
        (servers, disabled) => {
          const { servers: kept } = filterMcpServers(servers, disabled);
          const disabledSet = new Set<string>(disabled);
          for (const key of Object.keys(kept)) {
            expect(key in servers).toBe(true);
            const id = connectorIdForServerKey(key);
            if (id) expect(disabledSet.has(id)).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

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
