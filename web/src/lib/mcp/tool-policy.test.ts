import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { classifyToolCall } from '../runs/approval';
import {
  bareToolName,
  policyForClass,
  buildToolPolicies,
  applyToolPolicies,
  groupToolsByServer,
} from './tool-policy';

/**
 * The real C3 classifier is used, not a stub — the claim is that a newly added
 * server's destructive tools end up gated, which is only true if the actual
 * classification runs.
 */

const policyOf = (policies: ReturnType<typeof buildToolPolicies>, name: string) =>
  policies.find((p) => p.name === name)?.permission_policy;

describe('bareToolName', () => {
  it('strips the mcp server prefix', () => {
    expect(bareToolName('mcp__aime-mcp-atlassian__transitionJiraIssue')).toBe('transitionJiraIssue');
    expect(bareToolName('mcp__web_search__query')).toBe('query');
  });

  it('leaves an already-bare name alone', () => {
    expect(bareToolName('deleteIssue')).toBe('deleteIssue');
    expect(bareToolName('Read')).toBe('Read');
  });
});

describe('policyForClass', () => {
  it('allows reads and in-app actions', () => {
    expect(policyForClass('read')).toBe('always_allow');
    expect(policyForClass('app')).toBe('always_allow');
  });

  it('asks for outside-world effects', () => {
    expect(policyForClass('consequential')).toBe('always_ask');
  });

  it('asks for anything it cannot classify — a gate that guesses is not a gate', () => {
    expect(policyForClass('unknown')).toBe('always_ask');
  });
});

describe('buildToolPolicies', () => {
  it('gates destructive tools and allows reads on a real-looking server', () => {
    const policies = buildToolPolicies([
      'mcp__aime-mcp-acme__searchIssues',
      'mcp__aime-mcp-acme__getIssue',
      'mcp__aime-mcp-acme__listProjects',
      'mcp__aime-mcp-acme__deleteIssue',
      'mcp__aime-mcp-acme__sendEmail',
    ]);

    expect(policyOf(policies, 'searchIssues')).toBe('always_allow');
    expect(policyOf(policies, 'getIssue')).toBe('always_allow');
    expect(policyOf(policies, 'listProjects')).toBe('always_allow');
    expect(policyOf(policies, 'deleteIssue')).toBe('always_ask');
    expect(policyOf(policies, 'sendEmail')).toBe('always_ask');
  });

  it('asks for a tool whose purpose is unrecognisable', () => {
    const policies = buildToolPolicies(['mcp__x__frobnicate']);
    expect(policyOf(policies, 'frobnicate')).toBe('always_ask');
  });

  it('honours an explicit approval so the user is not asked forever', () => {
    const policies = buildToolPolicies(['mcp__x__deleteIssue'], { approved: ['deleteIssue'] });
    expect(policyOf(policies, 'deleteIssue')).toBe('always_allow');
  });

  it('lets a denial outrank an approval', () => {
    const policies = buildToolPolicies(['mcp__x__deleteIssue'], {
      approved: ['deleteIssue'],
      denied: ['deleteIssue'],
    });
    expect(policyOf(policies, 'deleteIssue')).toBe('always_deny');
  });

  it('accepts prefixed or bare approval names', () => {
    const policies = buildToolPolicies(['mcp__x__deleteIssue'], {
      approved: ['mcp__x__deleteIssue'],
    });
    expect(policyOf(policies, 'deleteIssue')).toBe('always_allow');
  });

  it('deduplicates and orders stably so the config does not churn', () => {
    const a = buildToolPolicies(['mcp__x__b', 'mcp__x__a', 'mcp__x__b']);
    const b = buildToolPolicies(['mcp__x__a', 'mcp__x__b']);
    expect(a).toEqual(b);
    expect(a.map((p) => p.name)).toEqual(['a', 'b']);
  });

  it('skips empty and non-string names', () => {
    expect(buildToolPolicies(['', 'mcp__x__getThing', null as unknown as string])).toEqual([
      { name: 'getThing', permission_policy: 'always_allow' },
    ]);
  });

  it('fails closed on a name with no recognisable verb', () => {
    expect(buildToolPolicies(['mcp__x__ok'])).toEqual([
      { name: 'ok', permission_policy: 'always_ask' },
    ]);
  });

  it('property: every emitted policy is one of the three SDK values, bare-named', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (names) => {
        for (const p of buildToolPolicies(names)) {
          expect(['always_allow', 'always_ask', 'always_deny']).toContain(p.permission_policy);
          expect(p.name).not.toContain('mcp__');
          expect(p.name).not.toBe('');
        }
      }),
      { numRuns: 500 },
    );
  });

  it('property: a tool is never silently allowed unless classified read/app or approved', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 })), (names) => {
        const policies = buildToolPolicies(names);
        for (const p of policies) {
          if (p.permission_policy !== 'always_allow') continue;
          // must have been genuinely classified as harmless
          expect(['read', 'app']).toContain(classifyToolCall(p.name));
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('applyToolPolicies', () => {
  const servers = {
    'aime-mcp-acme': { type: 'http', url: 'https://mcp.acme.com/mcp', headers: { Authorization: 'Bearer x' } },
    'aime-connector-github': { transport: 'streamable-http', url: 'https://api.githubcopilot.com/mcp/' },
    'aime-connector-buildkite': { type: 'stdio', command: 'npx', args: ['-y', 'bk'] },
  };

  it('attaches a policy to http and streamable-http servers', () => {
    const { servers: out, applied } = applyToolPolicies(servers, {
      'aime-mcp-acme': ['mcp__aime-mcp-acme__deleteIssue', 'mcp__aime-mcp-acme__getIssue'],
    });

    const entry = out['aime-mcp-acme'] as { tools: Array<{ name: string; permission_policy: string }> };
    expect(entry.tools).toEqual([
      { name: 'deleteIssue', permission_policy: 'always_ask' },
      { name: 'getIssue', permission_policy: 'always_allow' },
    ]);
    expect(applied).toEqual([{ server: 'aime-mcp-acme', asked: 1, allowed: 1, denied: 0 }]);
  });

  it('preserves the rest of the server config', () => {
    const { servers: out } = applyToolPolicies(servers, {
      'aime-mcp-acme': ['mcp__aime-mcp-acme__getIssue'],
    });
    expect(out['aime-mcp-acme']).toMatchObject({
      type: 'http',
      url: 'https://mcp.acme.com/mcp',
      headers: { Authorization: 'Bearer x' },
    });
  });

  it('reports stdio servers as unsupported rather than pretending to gate them', () => {
    // McpStdioServerConfig has no `tools` field — an SDK constraint, and one that
    // must be visible rather than silently ignored.
    const { servers: out, unsupported } = applyToolPolicies(servers, {
      'aime-connector-buildkite': ['mcp__aime-connector-buildkite__triggerBuild'],
    });
    expect(unsupported).toEqual(['aime-connector-buildkite']);
    expect(out['aime-connector-buildkite']).not.toHaveProperty('tools');
  });

  it('leaves a server with no observed tools completely untouched', () => {
    // An empty `tools` array could read as "no tools permitted" and break the
    // server on its very first use.
    const { servers: out, applied } = applyToolPolicies(servers, {});
    expect(out['aime-mcp-acme']).not.toHaveProperty('tools');
    expect(out['aime-mcp-acme']).toBe(servers['aime-mcp-acme']);
    expect(applied).toEqual([]);
  });

  it('treats an empty name list as "no observations"', () => {
    const { servers: out } = applyToolPolicies(servers, { 'aime-mcp-acme': [] });
    expect(out['aime-mcp-acme']).not.toHaveProperty('tools');
  });

  it('takes per-server approvals from the callback', () => {
    const { servers: out } = applyToolPolicies(
      servers,
      { 'aime-mcp-acme': ['mcp__aime-mcp-acme__deleteIssue'] },
      (key) => (key === 'aime-mcp-acme' ? { approved: ['deleteIssue'] } : {}),
    );
    const entry = out['aime-mcp-acme'] as { tools: Array<{ permission_policy: string }> };
    expect(entry.tools[0].permission_policy).toBe('always_allow');
  });
});

describe('groupToolsByServer', () => {
  it('groups a flat session tool list by server', () => {
    expect(
      groupToolsByServer([
        'Read',
        'Bash',
        'mcp__aime-mcp-acme__getIssue',
        'mcp__aime-mcp-acme__deleteIssue',
        'mcp__aime__canvas',
      ]),
    ).toEqual({
      'aime-mcp-acme': ['mcp__aime-mcp-acme__getIssue', 'mcp__aime-mcp-acme__deleteIssue'],
      aime: ['mcp__aime__canvas'],
    });
  });

  it('ignores built-in tools', () => {
    expect(groupToolsByServer(['Read', 'Write', 'Bash'])).toEqual({});
  });

  it('handles server names with underscores', () => {
    expect(groupToolsByServer(['mcp__web_search__query'])).toEqual({
      web_search: ['mcp__web_search__query'],
    });
  });
});
