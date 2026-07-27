import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { classifyToolCall } from '../runs/approval';
import {
  bareToolName,
  policyForClass,
  buildToolPolicies,
  applyToolPolicies,
  groupToolsByServer,
  splitMcpToolName,
  serverHandlesMoney,
  buildToolGate,
  buildApprovalQuestion,
  readApprovalAnswer,
  decisionOptions,
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
  it('allows reads outright', () => {
    expect(policyForClass('read')).toBe('always_allow');
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

  it('property: a tool is never silently allowed unless classified read or approved', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 })), (names) => {
        const policies = buildToolPolicies(names);
        for (const p of policies) {
          if (p.permission_policy !== 'always_allow') continue;
          // must have been genuinely classified as harmless
          expect(classifyToolCall(p.name)).toBe('read');
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('buildToolPolicies — compound names are not pre-approved (regression)', () => {
  /**
   * This path is the sharper edge of the classifier bug. `always_allow` is
   * pushed down INTO THE SDK, so a tool that classifies 'read' is pre-approved
   * and canUseTool never runs for it — there is no second line of defence.
   * A name whose first segment reads and whose later segments mutate
   * (`findAndReplace`, `checkAndSendInvoice`) must therefore never reach
   * always_allow.
   */
  it('asks for a name whose later segment acts on the world', () => {
    const policies = buildToolPolicies([
      'mcp__aime-mcp-docs__findAndReplace',
      'mcp__aime-mcp-docs__findAndReplaceText',
      'mcp__aime-mcp-acme__checkAndSendInvoice',
      'mcp__aime-mcp-acme__getOrCreateChannel',
      'mcp__aime-mcp-acme__queryAndDeleteRows',
      'mcp__aime-mcp-acme__listAndArchiveThreads',
      'mcp__aime-mcp-acme__readFileAndWrite',
      'mcp__aime-mcp-acme__showAndDeleteEverything',
    ]);
    expect(policies).toHaveLength(8);
    for (const p of policies) {
      expect(p.permission_policy, p.name).toBe('always_ask');
    }
  });

  it('asks when the second operation is unrecognisable', () => {
    expect(policyOf(buildToolPolicies(['mcp__x__findAndFrobnicate']), 'findAndFrobnicate')).toBe(
      'always_ask',
    );
  });

  it('still allows genuine reads, so the gate stays usable', () => {
    const policies = buildToolPolicies([
      'mcp__aime-mcp-atlassian__searchJiraIssuesUsingJql',
      'mcp__aime-mcp-atlassian__getTransitionsForJiraIssue',
      'mcp__aime-mcp-acme__getOrders',
      'mcp__aime-mcp-acme__searchAndListThreads',
    ]);
    for (const p of policies) {
      expect(p.permission_policy, p.name).toBe('always_allow');
    }
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

// ── The runtime gate ────────────────────────────────────────────────────────

describe('splitMcpToolName', () => {
  it('splits a prefixed MCP tool name into server and tool', () => {
    expect(splitMcpToolName('mcp__aime-mcp-acme__deleteIssue')).toEqual({
      server: 'aime-mcp-acme',
      tool: 'deleteIssue',
    });
    expect(splitMcpToolName('mcp__web_search__query')).toEqual({
      server: 'web_search',
      tool: 'query',
    });
  });

  it('returns null for anything that is not an MCP tool call', () => {
    expect(splitMcpToolName('Read')).toBeNull();
    expect(splitMcpToolName('mcp__nounderscores')).toBeNull();
    expect(splitMcpToolName('')).toBeNull();
  });
});

describe('serverHandlesMoney', () => {
  it('recognises the catalogue money servers by key', () => {
    expect(serverHandlesMoney('aime-mcp-stripe')).toBe(true);
    expect(serverHandlesMoney('aime-mcp-paypal')).toBe(true);
    expect(serverHandlesMoney('aime-mcp-square')).toBe(true);
    expect(serverHandlesMoney('aime-mcp-linear')).toBe(false);
  });

  it('recognises them by URL even when the key says nothing', () => {
    // A key is not proof of identity, so the URL is the stronger signal.
    expect(serverHandlesMoney('aime-mcp-payments', { type: 'http', url: 'https://mcp.stripe.com' })).toBe(true);
    expect(serverHandlesMoney('aime-mcp-payments', { type: 'http', url: 'https://mcp.acme.com' })).toBe(false);
  });
});

describe('buildToolGate', () => {
  const servers = {
    'aime-mcp-acme': { type: 'http', url: 'https://mcp.acme.com/mcp' },
    'aime-connector-buildkite': { type: 'stdio', command: 'npx' },
  };

  it('gates by live classification, so session one is covered too', () => {
    // The SDK-level policy needs names observed in a PREVIOUS session. canUseTool
    // has the real name in hand, so it needs no observations at all.
    const gate = buildToolGate(servers);
    expect(gate.policyFor('mcp__aime-mcp-acme__deleteIssue')).toBe('always_ask');
    expect(gate.policyFor('mcp__aime-mcp-acme__getIssue')).toBe('always_allow');
  });

  it('covers stdio servers, which the SDK config cannot', () => {
    expect(buildToolGate(servers).policyFor('mcp__aime-connector-buildkite__triggerBuild')).toBe('always_ask');
  });

  it('returns null for tools outside the governed server set', () => {
    const gate = buildToolGate(servers);
    expect(gate.policyFor('Write')).toBeNull();
    expect(gate.policyFor('mcp__aime__DocumentCreate')).toBeNull();
    expect(gate.policyFor('mcp__web-search__web_search')).toBeNull();
  });

  it('honours an explicit policy already on the entry', () => {
    const gate = buildToolGate({
      'aime-mcp-acme': {
        type: 'http',
        url: 'https://x/mcp',
        tools: [
          { name: 'deleteIssue', permission_policy: 'always_allow' },
          { name: 'getIssue', permission_policy: 'always_deny' },
        ],
      },
    });
    expect(gate.policyFor('mcp__aime-mcp-acme__deleteIssue')).toBe('always_allow');
    expect(gate.policyFor('mcp__aime-mcp-acme__getIssue')).toBe('always_deny');
  });

  it('lets stored decisions outrank the classifier, with deny on top', () => {
    const gate = buildToolGate(servers, {
      'aime-mcp-acme': { approved: ['deleteIssue'], denied: ['getIssue', 'sendEmail'] },
    });
    expect(gate.policyFor('mcp__aime-mcp-acme__deleteIssue')).toBe('always_allow');
    expect(gate.policyFor('mcp__aime-mcp-acme__getIssue')).toBe('always_deny');
    expect(gate.policyFor('mcp__aime-mcp-acme__sendEmail')).toBe('always_deny');
  });

  it('never lets a stored approval un-gate a money-moving tool', () => {
    const gate = buildToolGate(
      { 'aime-mcp-stripe': { type: 'http', url: 'https://mcp.stripe.com' } },
      { 'aime-mcp-stripe': { approved: ['create_refund'] } },
    );
    expect(gate.policyFor('mcp__aime-mcp-stripe__create_refund')).toBe('always_ask');
    expect(gate.handlesMoney('aime-mcp-stripe')).toBe(true);
  });

  it('remembers a decision for the rest of the session', () => {
    const gate = buildToolGate(servers);
    expect(gate.policyFor('mcp__aime-mcp-acme__deleteIssue')).toBe('always_ask');
    gate.remember('aime-mcp-acme', 'deleteIssue', 'always_allow');
    expect(gate.policyFor('mcp__aime-mcp-acme__deleteIssue')).toBe('always_allow');
    gate.remember('aime-mcp-acme', 'deleteIssue', 'always_deny');
    expect(gate.policyFor('mcp__aime-mcp-acme__deleteIssue')).toBe('always_deny');
  });

  it('gates an alternative name shape rather than failing open', () => {
    // The SDK emits mcp__server__tool, and the provider guards a server:tool form
    // elsewhere. An unrecognised shape would mean an UNGATED call, so the left
    // half is matched against the mounted server keys instead.
    const gate = buildToolGate(servers);
    expect(gate.policyFor('aime-mcp-acme:deleteIssue')).toBe('always_ask');
    expect(gate.policyFor('aime-mcp-acme:getIssue')).toBe('always_allow');
    expect(gate.policyFor('aime-mcp-acme__deleteIssue')).toBe('always_ask');
    // ...and a server nobody mounted still claims nothing.
    expect(gate.policyFor('other-server:deleteIssue')).toBeNull();
  });

  it('resolve reports which governed server and tool a call names', () => {
    expect(buildToolGate(servers).resolve('mcp__aime-mcp-acme__deleteIssue')).toEqual({
      server: 'aime-mcp-acme',
      tool: 'deleteIssue',
      policy: 'always_ask',
    });
    expect(buildToolGate(servers).resolve('Write')).toBeNull();
  });

  it('is inert when no servers are mounted', () => {
    expect(buildToolGate({}).policyFor('mcp__anything__deleteIssue')).toBeNull();
  });
});

describe('the approval question', () => {
  it('names the tool and the server, and offers a remembered choice', () => {
    const q = buildApprovalQuestion({ server: 'aime-mcp-acme', tool: 'deleteIssue' });
    expect(q.question).toContain('deleteIssue');
    expect(q.options.map((o) => o.label)).toEqual([
      'Allow once',
      'Always allow',
      'Deny',
      'Always deny',
    ]);
    expect(q.multiSelect).toBe(false);
  });

  it('withholds a blanket approval for money-moving tools', () => {
    const q = buildApprovalQuestion({ server: 'aime-mcp-stripe', tool: 'create_refund', handlesMoney: true });
    expect(q.options.map((o) => o.label)).toEqual(['Allow once', 'Deny', 'Always deny']);
    expect(q.question).toMatch(/money|payment/i);
  });

  it('truncates a hostile tool name rather than rendering it whole', () => {
    const q = buildApprovalQuestion({ server: 's', tool: 'x'.repeat(500) });
    expect(q.question.length).toBeLessThan(400);
  });
});

describe('readApprovalAnswer', () => {
  const q = buildApprovalQuestion({ server: 's', tool: 'deleteIssue' }).question;

  it('maps each label to its decision', () => {
    expect(readApprovalAnswer({ [q]: 'Allow once' }, q)).toBe('allow-once');
    expect(readApprovalAnswer({ [q]: 'Always allow' }, q)).toBe('always-allow');
    expect(readApprovalAnswer({ [q]: 'Deny' }, q)).toBe('deny');
    expect(readApprovalAnswer({ [q]: 'Always deny' }, q)).toBe('always-deny');
  });

  it('accepts a single answer under an unexpected key', () => {
    expect(readApprovalAnswer({ whatever: 'Allow once' }, q)).toBe('allow-once');
  });

  it('fails closed on anything it does not recognise', () => {
    expect(readApprovalAnswer({}, q)).toBe('deny');
    expect(readApprovalAnswer({ [q]: '' }, q)).toBe('deny');
    expect(readApprovalAnswer({ [q]: 'Allow once, Deny' }, q)).toBe('deny');
    expect(readApprovalAnswer({ [q]: 'yes please' }, q)).toBe('deny');
    expect(readApprovalAnswer(null, q)).toBe('deny');
    expect(readApprovalAnswer({ a: 'Allow once', b: 'Deny' }, q)).toBe('deny');
  });

  it('degrades a blanket approval to allow-once for money-moving tools', () => {
    expect(readApprovalAnswer({ [q]: 'Always allow' }, q, { handlesMoney: true })).toBe('allow-once');
  });

  it('property: only an exact known label can ever produce an allow', () => {
    fc.assert(
      fc.property(fc.string(), (answer) => {
        const decision = readApprovalAnswer({ [q]: answer }, q);
        if (decision === 'allow-once' || decision === 'always-allow') {
          expect(['Allow once', 'Always allow']).toContain(answer);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('policyForClass — MCP tools cannot claim to be in-app', () => {
  /**
   * 'app' means "acts inside AIME, visible and reversible in the UI" — true of
   * TodoWrite and the canvas tool, and never true of a remote server. Since the
   * classifier matches on the bare name, any server could expose a tool called
   * `canvas`, `Task` or `TodoWrite` and be handed always_allow.
   */
  it('only a read is allowed outright', () => {
    expect(policyForClass('read')).toBe('always_allow');
    expect(policyForClass('app')).toBe('always_ask');
    expect(policyForClass('consequential')).toBe('always_ask');
    expect(policyForClass('unknown')).toBe('always_ask');
  });

  it('a server impersonating a builtin name gets no free pass', () => {
    const policies = buildToolPolicies([
      'mcp__aime-mcp-stripe__canvas',
      'mcp__aime-mcp-stripe__TodoWrite',
      'mcp__aime-mcp-stripe__Task',
      'mcp__aime-mcp-stripe__browser_click',
    ]);
    for (const p of policies) expect(p.permission_policy, p.name).toBe('always_ask');
  });
});

describe('the decision store', () => {
  it('turns stored decisions into per-server BuildPolicyOptions', () => {
    const optsFor = decisionOptions({ 'aime-mcp-acme': { approved: ['a'], denied: ['b'] } });
    expect(optsFor('aime-mcp-acme')).toEqual({ approved: ['a'], denied: ['b'] });
    expect(optsFor('other')).toEqual({});
  });
});
