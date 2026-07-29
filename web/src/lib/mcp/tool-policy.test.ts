import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
  readToolDecisions,
  recordToolDecision,
  toolDecisionsPath,
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

/**
 * The decision store — the only part of this module that touches disk, and the
 * part that had no tests at all.
 *
 * It matters because the file is written from a decision about a name an MCP
 * SERVER chose, and read back to grant standing approvals. A name that gets
 * through the filter becomes a permanent "always allow" for a tool the user
 * approved once under a different spelling.
 *
 * Driven against a real temp directory rather than a mocked `fs`: the thing
 * under test IS the read/parse/validate/write path, and mocking it would assert
 * that we call `readFile`.
 */
describe('the decision store on disk', () => {
  let dir: string;
  let mcpConfigPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-decisions-'));
    mcpConfigPath = path.join(dir, '.aime-mcp.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (contents: unknown) =>
    fs.writeFileSync(
      toolDecisionsPath(mcpConfigPath),
      typeof contents === 'string' ? contents : JSON.stringify(contents),
    );

  it('sits beside the MCP config, not in it', () => {
    expect(toolDecisionsPath('/a/b/.aime-mcp.json')).toBe('/a/b/.aime-mcp-decisions.json');
  });

  describe('readToolDecisions never weakens policy over a bad file', () => {
    it('returns nothing when the file is missing', async () => {
      expect(await readToolDecisions(mcpConfigPath)).toEqual({});
    });

    it('returns nothing for unparseable JSON', async () => {
      write('{not json');
      expect(await readToolDecisions(mcpConfigPath)).toEqual({});
    });

    it.each([
      ['an empty array', []],
      // A NON-empty array is the interesting one: `Object.entries` on it yields
      // numeric keys, so without the Array.isArray guard a JSON array would be
      // read back as a set of servers named "0", "1", …
      ['a populated array', [{ approved: ['getIssue'] }]],
      ['a bare string', '"hello"'],
      ['a number', '42'],
      ['null', 'null'],
    ])('returns nothing for %s at the top level', async (_label, contents) => {
      write(contents as never);
      expect(await readToolDecisions(mcpConfigPath)).toEqual({});
    });

    it('skips a server entry that is not an object', async () => {
      write({ good: { approved: ['readIssue'] }, bad: 'nope', alsoBad: null });
      expect(await readToolDecisions(mcpConfigPath)).toEqual({
        good: { approved: ['readIssue'], denied: [] },
      });
    });

    it('treats a non-array list as absent rather than throwing', async () => {
      write({ s: { approved: 'readIssue', denied: ['deleteIssue'] } });
      expect(await readToolDecisions(mcpConfigPath)).toEqual({
        s: { approved: [], denied: ['deleteIssue'] },
      });
    });

    it('drops a server whose lists are both empty after filtering', async () => {
      write({ s: { approved: [], denied: [] }, t: { approved: [123, null] } });
      expect(await readToolDecisions(mcpConfigPath)).toEqual({});
    });
  });

  describe('readToolDecisions filters the names it will trust', () => {
    /**
     * SAFE_NAME is anchored at both ends on purpose. Unanchored, a name only has
     * to CONTAIN a plausible run — so `../../etc/passwd` would be accepted
     * because it ends in one.
     */
    it.each([
      '../../etc/passwd',
      '/absolute/name',
      'has space',
      'has/slash',
      'has\\backslash',
      '-leading-dash',
      '.leading-dot',
      'new\nline',
      '',
      'x'.repeat(200),
    ])('rejects %j', async (bad) => {
      write({ s: { approved: [bad, 'readIssue'] } });
      const out = await readToolDecisions(mcpConfigPath);
      expect(out.s?.approved).toEqual(['readIssue']);
    });

    it.each(['readIssue', 'read_issue', 'a.b', 'a:b', 'a-b', 'A1', 'x'.repeat(128)])(
      'accepts %j',
      async (good) => {
        write({ s: { approved: [good] } });
        expect((await readToolDecisions(mcpConfigPath)).s?.approved).toEqual([good]);
      },
    );

    it('caps how many decisions a single server can carry', async () => {
      write({ s: { approved: Array.from({ length: 500 }, (_, i) => `tool${i}`) } });
      const out = await readToolDecisions(mcpConfigPath);
      expect(out.s?.approved).toHaveLength(200);
      expect(out.s?.approved?.[0]).toBe('tool0');
    });
  });

  describe('recordToolDecision', () => {
    it('persists an approval and reads it back', async () => {
      await recordToolDecision(mcpConfigPath, 'aime-mcp-acme', 'getIssue', 'always_allow');
      expect(await readToolDecisions(mcpConfigPath)).toEqual({
        'aime-mcp-acme': { approved: ['getIssue'], denied: [] },
      });
    });

    it('stores the BARE name, so the prefixed form resolves too', async () => {
      await recordToolDecision(mcpConfigPath, 'acme', 'mcp__acme__getIssue', 'always_allow');
      expect((await readToolDecisions(mcpConfigPath)).acme?.approved).toEqual(['getIssue']);
    });

    it('moves a tool from approved to denied, and back', async () => {
      await recordToolDecision(mcpConfigPath, 'acme', 'x', 'always_allow');
      await recordToolDecision(mcpConfigPath, 'acme', 'x', 'always_deny');
      expect(await readToolDecisions(mcpConfigPath)).toEqual({
        acme: { approved: [], denied: ['x'] },
      });

      await recordToolDecision(mcpConfigPath, 'acme', 'x', 'always_allow');
      expect(await readToolDecisions(mcpConfigPath)).toEqual({
        acme: { approved: ['x'], denied: [] },
      });
    });

    it('merges rather than replacing what another surface wrote', async () => {
      await recordToolDecision(mcpConfigPath, 'acme', 'a', 'always_allow');
      await recordToolDecision(mcpConfigPath, 'other', 'b', 'always_deny');
      const out = await readToolDecisions(mcpConfigPath);
      expect(Object.keys(out).sort()).toEqual(['acme', 'other']);
    });

    /** The write-side half of the anchoring above. */
    it.each([
      ['../../evil', 'getIssue'],
      ['acme', '../../evil'],
      ['has space', 'getIssue'],
      ['', 'getIssue'],
      ['acme', ''],
    ])('refuses to remember an implausible name (%j, %j)', async (server, tool) => {
      await recordToolDecision(mcpConfigPath, server, tool, 'always_allow');
      expect(await readToolDecisions(mcpConfigPath)).toEqual({});
      expect(fs.existsSync(toolDecisionsPath(mcpConfigPath))).toBe(false);
    });

    it('stops growing once a server hits the cap', async () => {
      write({ acme: { approved: Array.from({ length: 200 }, (_, i) => `t${i}`), denied: [] } });
      await recordToolDecision(mcpConfigPath, 'acme', 'oneMore', 'always_allow');
      const out = await readToolDecisions(mcpConfigPath);
      expect(out.acme?.approved).not.toContain('oneMore');
      expect(out.acme?.approved).toHaveLength(200);
    });
  });
});

describe('serverHandlesMoney — the flag that withholds "Always allow"', () => {
  it('strips either legacy prefix before matching the catalogue id', () => {
    expect(serverHandlesMoney('aime-mcp-stripe')).toBe(true);
    expect(serverHandlesMoney('nib-connector-stripe')).toBe(true);
    expect(serverHandlesMoney('stripe')).toBe(true);
  });

  it('does not match a key that merely contains a money id', () => {
    // Anchoring matters: `notstripe` and `stripe-clone` are different servers.
    expect(serverHandlesMoney('notstripe')).toBe(false);
    expect(serverHandlesMoney('my-stripe-proxy')).toBe(false);
  });

  it('falls back to the entry URL host', () => {
    expect(serverHandlesMoney('anything', { url: 'https://mcp.stripe.com/mcp' })).toBe(true);
    expect(serverHandlesMoney('anything', { url: 'https://MCP.STRIPE.COM/x' })).toBe(true);
  });

  it('says no for an unrelated host', () => {
    expect(serverHandlesMoney('anything', { url: 'https://example.com/mcp' })).toBe(false);
  });

  it('says no rather than throwing on a malformed or missing URL', () => {
    // Fail-safe direction: an unparseable URL must not be treated as money —
    // that would make every broken entry unable to be blanket-approved — but it
    // must also not throw out of the gate.
    expect(serverHandlesMoney('anything', { url: 'not a url' })).toBe(false);
    expect(serverHandlesMoney('anything', { url: 42 })).toBe(false);
    expect(serverHandlesMoney('anything', {})).toBe(false);
    expect(serverHandlesMoney('anything', undefined)).toBe(false);
  });
});

describe('buildToolGate — name shapes and the money override', () => {
  const servers = { acme: { type: 'http', url: 'https://mcp.acme.com' } };
  const stripe = { stripe: { type: 'http', url: 'https://mcp.stripe.com' } };

  it('ignores a leading separator rather than splitting on it', () => {
    const gate = buildToolGate(servers as never, {});
    // `at <= 0` — a name that STARTS with the separator has an empty server half.
    expect(gate.resolve('__getIssue')).toBeNull();
    expect(gate.resolve(':getIssue')).toBeNull();
  });

  it('accepts a <server>:<tool> form only for a governed server', () => {
    const gate = buildToolGate(servers as never, {});
    expect(gate.resolve('acme:deleteIssue')).toMatchObject({ server: 'acme', tool: 'deleteIssue' });
    expect(gate.resolve('elsewhere:deleteIssue')).toBeNull();
  });

  it('classifies the BARE tool, not the name with the server glued on', () => {
    const gate = buildToolGate(servers as never, {});
    // `acme:getIssue` must read as a read, which it cannot if the server half is
    // still attached when the classifier sees it.
    expect(gate.resolve('acme:getIssue')?.policy).toBe('always_allow');
  });

  it('downgrades a DECLARED always_allow to always_ask on a money server', () => {
    const gate = buildToolGate(
      { stripe: { ...stripe.stripe, tools: [{ name: 'create_refund', permission_policy: 'always_allow' }] } } as never,
      {},
    );
    expect(gate.resolve('mcp__stripe__create_refund')?.policy).toBe('always_ask');
  });

  it('leaves a declared always_deny alone on a money server', () => {
    const gate = buildToolGate(
      { stripe: { ...stripe.stripe, tools: [{ name: 'create_refund', permission_policy: 'always_deny' }] } } as never,
      {},
    );
    expect(gate.resolve('mcp__stripe__create_refund')?.policy).toBe('always_deny');
  });

  it('ignores an entry policy that is not one of the three SDK values', () => {
    const gate = buildToolGate(
      { acme: { ...servers.acme, tools: [{ name: 'deleteIssue', permission_policy: 'sure_why_not' }] } } as never,
      {},
    );
    // Falls through to the classifier rather than trusting an unknown string.
    expect(gate.resolve('mcp__acme__deleteIssue')?.policy).toBe('always_ask');
  });

  it('ignores a tools entry with no usable name', () => {
    const gate = buildToolGate(
      { acme: { ...servers.acme, tools: [{ name: '', permission_policy: 'always_allow' }, { permission_policy: 'always_allow' }] } } as never,
      {},
    );
    expect(gate.resolve('mcp__acme__deleteIssue')?.policy).toBe('always_ask');
  });

  it('reports its governed servers in a stable order', () => {
    const gate = buildToolGate({ zeta: servers.acme, alpha: servers.acme } as never, {});
    expect(gate.governedServers).toEqual(['alpha', 'zeta']);
  });

  it('remember() moves a tool between the two sets', () => {
    const gate = buildToolGate(servers as never, {});
    gate.remember('acme', 'mcp__acme__deleteIssue', 'always_allow');
    expect(gate.policyFor('mcp__acme__deleteIssue')).toBe('always_allow');
    gate.remember('acme', 'deleteIssue', 'always_deny');
    expect(gate.policyFor('mcp__acme__deleteIssue')).toBe('always_deny');
  });

  it('rejects a non-string or empty tool name', () => {
    const gate = buildToolGate(servers as never, {});
    for (const bad of [undefined, null, 42, '', {}]) {
      expect(gate.resolve(bad as never)).toBeNull();
    }
  });
});

describe('readApprovalAnswer fails closed', () => {
  const Q = 'Allow acme to run deleteIssue?';

  it('reads the four labels', () => {
    expect(readApprovalAnswer({ [Q]: 'Allow once' }, Q)).toBe('allow-once');
    expect(readApprovalAnswer({ [Q]: 'Always allow' }, Q)).toBe('always-allow');
    expect(readApprovalAnswer({ [Q]: 'Deny' }, Q)).toBe('deny');
    expect(readApprovalAnswer({ [Q]: 'Always deny' }, Q)).toBe('always-deny');
  });

  it('tolerates surrounding whitespace', () => {
    expect(readApprovalAnswer({ [Q]: '  Allow once  ' }, Q)).toBe('allow-once');
  });

  it.each([
    ['a label it never offered', { [Q]: 'Sure' }],
    ['an empty answer', { [Q]: '' }],
    ['a non-string answer', { [Q]: true }],
    ['no answers object', null],
    ['a primitive', 'Allow once'],
    ['the wrong question with two entries', { a: 'Allow once', b: 'Allow once' }],
  ])('denies on %s', (_label, answers) => {
    expect(readApprovalAnswer(answers as never, Q)).toBe('deny');
  });

  it('accepts a single answer under a different key — the card had one question', () => {
    expect(readApprovalAnswer({ somethingElse: 'Allow once' }, Q)).toBe('allow-once');
  });

  it('degrades a blanket approval to once for a money tool', () => {
    expect(readApprovalAnswer({ [Q]: 'Always allow' }, Q, { handlesMoney: true })).toBe('allow-once');
    // ...but a denial is not softened.
    expect(readApprovalAnswer({ [Q]: 'Always deny' }, Q, { handlesMoney: true })).toBe('always-deny');
  });
});

describe('buildApprovalQuestion', () => {
  it('strips the connector prefix so the user sees the service name', () => {
    expect(buildApprovalQuestion({ server: 'aime-mcp-acme', tool: 'deleteIssue' }).question)
      .toContain('acme');
  });

  it('clips a hostile server or tool name instead of rendering it whole', () => {
    const q = buildApprovalQuestion({ server: 'a'.repeat(500), tool: 'b'.repeat(500) });
    expect(q.question.length).toBeLessThan(200);
    expect(q.question).toContain('…');
  });

  it('offers the blanket options for an ordinary tool', () => {
    const labels = buildApprovalQuestion({ server: 'acme', tool: 'deleteIssue' }).options.map((o) => o.label);
    expect(labels).toEqual(['Allow once', 'Always allow', 'Deny', 'Always deny']);
  });

  it('withholds "Always allow" — and says why in the header — for money', () => {
    const q = buildApprovalQuestion({ server: 'stripe', tool: 'create_refund', handlesMoney: true });
    expect(q.options.map((o) => o.label)).toEqual(['Allow once', 'Deny', 'Always deny']);
    expect(q.header).toMatch(/money/i);
  });
});

describe('applyToolPolicies — the remaining transports and the report', () => {
  const observed = { acme: ['getIssue', 'deleteIssue'] };
  const entry = (type: string) => ({ acme: { type, url: 'https://mcp.acme.com' } });

  it.each(['http', 'sse', 'streamable-http'])('attaches policies to a %s server', (type) => {
    const out = applyToolPolicies(entry(type) as never, observed);
    expect((out.servers.acme as { tools?: unknown[] }).tools).toHaveLength(2);
    expect(out.unsupported).toEqual([]);
  });

  it.each(['stdio', 'ws', ''])('reports a %j server as unsupported', (type) => {
    const out = applyToolPolicies(entry(type) as never, observed);
    expect(out.unsupported).toEqual(['acme']);
    expect((out.servers.acme as { tools?: unknown[] }).tools).toBeUndefined();
  });

  it('counts what it gated per server, split by outcome', () => {
    // Three tools, deliberately UNEQUAL counts: with one-of-each, a filter that
    // flipped `===` to `!==` still produced 1 and the assertion could not tell.
    const out = applyToolPolicies(
      entry('http') as never,
      { acme: ['getIssue', 'listIssues', 'deleteIssue'] },
    );
    expect(out.applied).toEqual([{ server: 'acme', asked: 1, allowed: 2, denied: 0 }]);
  });

  it('counts a denial too, so the report is not just ask-vs-allow', () => {
    const out = applyToolPolicies(entry('http') as never, observed, () => ({ denied: ['deleteIssue'] }));
    expect(out.applied).toEqual([{ server: 'acme', asked: 0, allowed: 1, denied: 1 }]);
  });

  it('works with no per-server options callback at all', () => {
    // The default `optsFor` must return an object, not undefined.
    expect(() => applyToolPolicies(entry('http') as never, observed)).not.toThrow();
  });

  it('lists unsupported servers in a stable order', () => {
    const out = applyToolPolicies(
      { zeta: { type: 'stdio' }, alpha: { type: 'stdio' } } as never,
      { zeta: ['x'], alpha: ['y'] },
    );
    expect(out.unsupported).toEqual(['alpha', 'zeta']);
  });
});

/**
 * The last few survivors from mutation testing that are worth killing — each one
 * a place where an assertion happened to hold for the mutated code too.
 *
 * ## Why the file stops at ~91% and not higher
 *
 * The remainder was checked by applying each doubtful mutant and running the
 * suite, rather than assumed. Three equivalence classes account for nearly all
 * of it:
 *
 * 1. **Guards that are redundant with a fail-closed default.** Dropping the
 *    `typeof x !== 'object'` half of the guards in `readApprovalAnswer` and
 *    `readToolDecisions` changes nothing observable, because the lookup that
 *    follows returns undefined for a primitive and the function already denies /
 *    returns {} on undefined. Verified by applying all three: suite still green.
 *    That is defence in depth, not dead code — the guard is the readable
 *    statement of intent and the default is the backstop.
 *
 * 2. **Unreachable-by-construction branches.** `at <= 0` vs `at < 0` in the gate:
 *    at 0 the server half is the empty string, which is never a governed server,
 *    so both spellings return null. Same for the dedup `continue` (a Map re-set
 *    preserves insertion order and the value is identical) and the malformed
 *    `tools` entry guards (a skipped entry and a registered-but-unusable one both
 *    fall through to the classifier).
 *
 * 3. **Copy and log text.** `console.warn` messages, `encoding: 'utf-8'`, and
 *    `Deny: 'deny'` in the label map — the last is provably equivalent because
 *    an empty mapping is falsy and falls through to the same fail-closed 'deny'.
 *
 * Killing those would mean asserting log strings and the absence of names no
 * server has. That is writing tests for the mutation tool rather than for the
 * code, which the header of stryker.conf.json warns against.
 */
describe('decisionOptions', () => {
  it('adapts a stored entry to the optsFor shape', () => {
    const optsFor = decisionOptions({ acme: { approved: ['a'], denied: ['b'] } });
    expect(optsFor('acme')).toEqual({ approved: ['a'], denied: ['b'] });
  });

  it('returns empty lists — not undefined — for a half-filled entry', () => {
    // `?? []` on both sides: a caller spreads these straight into a Set.
    const optsFor = decisionOptions({ acme: { approved: ['a'] } as never });
    expect(optsFor('acme')).toEqual({ approved: ['a'], denied: [] });
    const other = decisionOptions({ acme: { denied: ['b'] } as never });
    expect(other('acme')).toEqual({ approved: [], denied: ['b'] });
  });

  it('returns nothing for a server with no stored decisions', () => {
    expect(decisionOptions({})('acme')).toEqual({});
  });
});

describe('the decision file on disk is stable and survives a bad write', () => {
  let dir: string;
  let mcpConfigPath: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-decisions2-'));
    mcpConfigPath = path.join(dir, '.aime-mcp.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes both lists sorted, so the file does not churn between surfaces', async () => {
    for (const t of ['zeta', 'alpha', 'mid']) {
      await recordToolDecision(mcpConfigPath, 'acme', t, 'always_allow');
    }
    for (const t of ['zulu', 'bravo']) {
      await recordToolDecision(mcpConfigPath, 'acme', t, 'always_deny');
    }
    const raw = JSON.parse(fs.readFileSync(toolDecisionsPath(mcpConfigPath), 'utf-8'));
    expect(raw.acme.approved).toEqual(['alpha', 'mid', 'zeta']);
    expect(raw.acme.denied).toEqual(['bravo', 'zulu']);
  });

  it('swallows a write failure rather than throwing into the approval gate', async () => {
    // This runs inside canUseTool while a turn is paused; an exception here
    // would escape into the SDK loop instead of just losing a preference.
    const readOnly = path.join(dir, 'ro');
    fs.mkdirSync(readOnly);
    fs.chmodSync(readOnly, 0o500);
    await expect(
      recordToolDecision(path.join(readOnly, '.aime-mcp.json'), 'acme', 'x', 'always_allow'),
    ).resolves.toBeUndefined();
    fs.chmodSync(readOnly, 0o700);
  });

  it('refuses the 201st decision but keeps the 200 it has', async () => {
    // Boundary: 200 is allowed to stand, 201 is not written.
    const at199 = Array.from({ length: 199 }, (_, i) => `t${i}`);
    fs.writeFileSync(
      toolDecisionsPath(mcpConfigPath),
      JSON.stringify({ acme: { approved: at199, denied: [] } }),
    );
    await recordToolDecision(mcpConfigPath, 'acme', 'number200', 'always_allow');
    expect((await readToolDecisions(mcpConfigPath)).acme?.approved).toHaveLength(200);

    await recordToolDecision(mcpConfigPath, 'acme', 'number201', 'always_allow');
    const out = await readToolDecisions(mcpConfigPath);
    expect(out.acme?.approved).toHaveLength(200);
    expect(out.acme?.approved).not.toContain('number201');
  });
});

describe('buildApprovalQuestion — exact wording, not just a substring', () => {
  it('renders the ordinary header and question verbatim', () => {
    const q = buildApprovalQuestion({ server: 'aime-mcp-acme', tool: 'deleteIssue' });
    expect(q.header).toBe('Approval');
    expect(q.question).toBe('Allow acme to run deleteIssue?');
  });

  it('renders the money header and question verbatim', () => {
    const q = buildApprovalQuestion({ server: 'stripe', tool: 'create_refund', handlesMoney: true });
    expect(q.header).toBe('Approval — moves money');
    expect(q.question).toBe('stripe can move money. Run create_refund?');
  });

  it('gives every option a description the user can act on', () => {
    const q = buildApprovalQuestion({ server: 'acme', tool: 'deleteIssue' });
    for (const opt of q.options) {
      expect(opt.description, opt.label).toBeTruthy();
      expect(opt.description!.length, opt.label).toBeGreaterThan(10);
    }
    expect(q.options.find((o) => o.label === 'Always allow')!.description).toContain('deleteIssue');
    expect(q.options.find((o) => o.label === 'Always deny')!.description).toContain('deleteIssue');
  });

  it('clips at the boundary, not one either side of it', () => {
    // 80 chars is the tool limit: exactly 80 is rendered whole, 81 is clipped.
    const exact = buildApprovalQuestion({ server: 'acme', tool: 'b'.repeat(80) });
    expect(exact.question).toContain('b'.repeat(80));
    expect(exact.question).not.toContain('…');

    const over = buildApprovalQuestion({ server: 'acme', tool: 'b'.repeat(81) });
    expect(over.question).toContain('…');
    expect(over.question).not.toContain('b'.repeat(81));
  });
});

/**
 * The prefix patterns are anchored at the start. Unanchored, a name only has to
 * CONTAIN the marker — so a built-in or a hostile server's tool called
 * `xmcp__acme__getIssue` would be split as though it belonged to `acme`, and
 * `xaime-mcp-stripe` would inherit stripe's money flag.
 *
 * None of these is reachable through the SDK today, which is exactly why they
 * are worth pinning: the anchors are the reason, and nothing recorded it.
 */
describe('prefix matching is anchored', () => {
  it('splitMcpToolName ignores a name that merely contains the marker', () => {
    expect(splitMcpToolName('mcp__acme__getIssue')).toEqual({ server: 'acme', tool: 'getIssue' });
    expect(splitMcpToolName('xmcp__acme__getIssue')).toBeNull();
    expect(splitMcpToolName(' mcp__acme__getIssue')).toBeNull();
  });

  it('splitMcpToolName requires a non-empty tool half', () => {
    expect(splitMcpToolName('mcp__acme__')).toBeNull();
  });

  it('bareToolName only strips a marker at the start', () => {
    expect(bareToolName('mcp__acme__getIssue')).toBe('getIssue');
    expect(bareToolName('xmcp__acme__getIssue')).toBe('xmcp__acme__getIssue');
  });

  it('groupToolsByServer ignores a name that merely contains the marker', () => {
    expect(groupToolsByServer(['xmcp__acme__getIssue'])).toEqual({});
    // It groups by server but keeps the FULL name (buildToolPolicies bares it).
    expect(groupToolsByServer(['mcp__acme__getIssue'])).toEqual({ acme: ['mcp__acme__getIssue'] });
  });

  it('serverHandlesMoney only strips a connector prefix at the start', () => {
    expect(serverHandlesMoney('aime-mcp-stripe')).toBe(true);
    expect(serverHandlesMoney('xaime-mcp-stripe')).toBe(false);
    expect(serverHandlesMoney('proxy-for-aime-mcp-stripe')).toBe(false);
  });

  it('the approval card only strips a connector prefix at the start', () => {
    // Otherwise the card would name a different service than the one being run.
    expect(buildApprovalQuestion({ server: 'xaime-mcp-acme', tool: 't' }).question)
      .toBe('Allow xaime-mcp-acme to run t?');
  });
});
