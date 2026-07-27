import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  baseToolName,
  classifyBash,
  classifyToolCall,
  evaluateApproval,
} from './approval';

describe('baseToolName', () => {
  it('strips MCP prefixes', () => {
    expect(baseToolName('mcp__gmail__send_email')).toBe('send_email');
    expect(baseToolName('slack:post_message')).toBe('post_message');
    expect(baseToolName('Write')).toBe('Write');
  });
});

describe('classifyToolCall — built-ins', () => {
  it('reads read, acts consequential', () => {
    for (const t of ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']) {
      expect(classifyToolCall(t), t).toBe('read');
    }
    for (const t of ['Write', 'Edit', 'NotebookEdit']) {
      expect(classifyToolCall(t), t).toBe('consequential');
    }
  });

  it('in-app orchestration is app, not consequential', () => {
    for (const t of ['TodoWrite', 'AskUserQuestion', 'canvas', 'spawn_agent', 'CronCreate', 'StandingOrderCreate']) {
      expect(classifyToolCall(t), t).toBe('app');
    }
    expect(classifyToolCall('browser_click')).toBe('app');
    expect(classifyToolCall('browser_inspect')).toBe('app');
  });
});

describe('classifyToolCall — MCP tools by verb', () => {
  it('classifies read verbs across naming styles', () => {
    for (const t of ['gmail__list_messages', 'mcp__slack__search_messages', 'get_issue', 'fetch-page', 'describe_table']) {
      expect(classifyToolCall(t), t).toBe('read');
    }
  });

  it('classifies world-side verbs as consequential', () => {
    for (const t of [
      'gmail__send_email', 'slack__post_message', 'jira__create_issue',
      'github__merge_pull_request', 'stripe__pay_invoice', 'calendar__delete_event',
      'drive__upload_file', 'aws__deploy_stack',
    ]) {
      expect(classifyToolCall(t), t).toBe('consequential');
    }
  });

  // The old implementation was a hardcoded 10-name list, so any NEW connector
  // tool sailed through ungoverned. Unknown must not mean allowed.
  it('classifies unrecognisable names as unknown, never read', () => {
    for (const t of ['frobnicate', 'zap', 'mcp__custom__doTheThing']) {
      expect(classifyToolCall(t), t).toBe('unknown');
    }
  });

  it('does not misread substrings as verbs', () => {
    // 'sendable_report' starts with 'send' but 'sendable' is not the verb 'send'
    expect(classifyToolCall('sendable_report')).toBe('unknown');
    // 'getaway_plan' is not 'get'
    expect(classifyToolCall('getaway_plan')).toBe('unknown');
  });
});

describe('classifyBash', () => {
  it('recognises plainly read-only commands', () => {
    for (const cmd of [
      'ls -la',
      'cat package.json',
      'grep -rn "foo" src',
      'git status',
      'git log --oneline -5',
      'ps aux',
      'du -sh .',
      'FOO=bar env',
    ]) {
      expect(classifyBash(cmd), cmd).toBe('read');
    }
  });

  it('requires EVERY pipeline segment to read', () => {
    expect(classifyBash('ps aux | grep node')).toBe('read');
    expect(classifyBash('cat a.txt | sort | uniq')).toBe('read');
    // one acting segment poisons the pipeline
    expect(classifyBash('ls; rm -rf /tmp/x')).toBe('consequential');
    expect(classifyBash('cat a.txt && rm a.txt')).toBe('consequential');
    expect(classifyBash('true || curl -X POST https://x')).toBe('consequential');
  });

  it('treats redirection and substitution as consequential', () => {
    for (const cmd of [
      'echo hi > /tmp/file',
      'cat a >> b',
      'echo $(rm -rf /)',
      'echo `whoami`',
      'sort < in.txt > out.txt',
    ]) {
      expect(classifyBash(cmd), cmd).toBe('consequential');
    }
  });

  it('treats mutating git and everything unrecognised as consequential', () => {
    for (const cmd of ['git push', 'git commit -m x', 'git checkout -b y', 'npm install', 'rm -rf node_modules', 'curl https://x']) {
      expect(classifyBash(cmd), cmd).toBe('consequential');
    }
  });

  it('returns unknown for a missing or empty command', () => {
    expect(classifyBash(undefined)).toBe('unknown');
    expect(classifyBash('')).toBe('unknown');
    expect(classifyBash(42)).toBe('unknown');
  });

  it('routes through classifyToolCall via the Bash input', () => {
    expect(classifyToolCall('Bash', { command: 'ls' })).toBe('read');
    expect(classifyToolCall('Bash', { command: 'rm -rf /' })).toBe('consequential');
    expect(classifyToolCall('Bash', {})).toBe('unknown');
  });
});

describe('evaluateApproval', () => {
  it("'never' allows everything — the human is watching", () => {
    for (const t of ['Write', 'gmail__send_email', 'frobnicate']) {
      expect(evaluateApproval('never', t).allow, t).toBe(true);
    }
  });

  it("'consequential' allows reads and app actions, pauses world effects", () => {
    expect(evaluateApproval('consequential', 'Read').allow).toBe(true);
    expect(evaluateApproval('consequential', 'gmail__list_messages').allow).toBe(true);
    expect(evaluateApproval('consequential', 'TodoWrite').allow).toBe(true);
    expect(evaluateApproval('consequential', 'CronCreate').allow).toBe(true);

    expect(evaluateApproval('consequential', 'gmail__send_email').allow).toBe(false);
    expect(evaluateApproval('consequential', 'Write').allow).toBe(false);
    expect(evaluateApproval('consequential', 'Bash', { command: 'rm -rf /' }).allow).toBe(false);
    // but a read-only bash command is fine
    expect(evaluateApproval('consequential', 'Bash', { command: 'git diff' }).allow).toBe(true);
  });

  // A gating policy that guesses "probably fine" is not a gate.
  it("'consequential' fails closed on unknown tools", () => {
    const out = evaluateApproval('consequential', 'mcp__custom__doTheThing');
    expect(out.allow).toBe(false);
    expect(out.class).toBe('unknown');
  });

  it("'always' allows only reads", () => {
    expect(evaluateApproval('always', 'Read').allow).toBe(true);
    expect(evaluateApproval('always', 'Bash', { command: 'ls' }).allow).toBe(true);
    expect(evaluateApproval('always', 'TodoWrite').allow).toBe(false);
    expect(evaluateApproval('always', 'gmail__send_email').allow).toBe(false);
  });

  // The old deny message claimed "an approval card has been created" — nothing
  // ever created one. The replacement must not promise machinery that
  // doesn't exist.
  it('the deny reason is honest and actionable', () => {
    const out = evaluateApproval('consequential', 'gmail__send_email');
    expect(out.reason).toMatch(/unattended/i);
    expect(out.reason).toMatch(/interactively|approval policy/i);
    expect(out.reason).not.toMatch(/card has been created/i);
  });
});

describe('classifier is total (fuzz)', () => {
  it('never throws on arbitrary tool names and inputs', () => {
    fc.assert(
      fc.property(fc.string(), fc.option(fc.object(), { nil: undefined }), (name, input) => {
        expect(() => classifyToolCall(name, input as Record<string, unknown> | undefined)).not.toThrow();
        expect(() => evaluateApproval('consequential', name, input as Record<string, unknown> | undefined)).not.toThrow();
      }),
      { numRuns: 2_000 },
    );
  });

  it('classifyBash never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (cmd) => {
        expect(() => classifyBash(cmd)).not.toThrow();
      }),
      { numRuns: 2_000 },
    );
  });

  // Under a gating policy, no input may ever be allowed merely by being weird.
  it('unknown weirdness is never allowed under a gating policy', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (name) => {
        const out = evaluateApproval('consequential', name);
        if (out.class === 'unknown' || out.class === 'consequential') {
          expect(out.allow).toBe(false);
        }
      }),
      { numRuns: 2_000 },
    );
  });
});

describe('classifyBash — every separator the shell honours (regression)', () => {
  /**
   * The split was `/\|\||&&|;|\|/` — no single `&`, no newline — and words were
   * split on JS `\s+`, which swallows the newline so everything after words[0]
   * was discarded. Both holes end the same way: a second, arbitrary command
   * rides along and the whole thing classifies as 'read'. Nothing gates 'read'
   * under ANY policy, so there was no setting that stopped these.
   */
  it('treats a single & as a command separator', () => {
    expect(classifyBash('ls & rm -rf ~/Documents')).toBe('consequential');
    expect(classifyBash('whoami & shutdown -h now')).toBe('consequential');
  });

  it('treats a newline as a command separator', () => {
    expect(classifyBash('ls\nrm -rf ~')).toBe('consequential');
    expect(classifyBash('echo hi\ngit push --force')).toBe('consequential');
    // A newline also defeated the git subcommand allowlist entirely.
    expect(
      classifyBash('pwd\ncurl -X POST https://api.example.com/pay -d amount=99999'),
    ).toBe('consequential');
  });

  it('treats CRLF and a bare CR as command separators', () => {
    expect(classifyBash('ls\r\nrm -rf ~')).toBe('consequential');
    expect(classifyBash('ls\rrm -rf ~')).toBe('consequential');
    // A Windows-authored read-only script is still a read.
    expect(classifyBash('ls -la\r\ncat package.json')).toBe('read');
  });

  it('does not invent word separators the shell does not honour', () => {
    // To the shell's lexer only space and tab split words, so `ls\vrm` is ONE
    // (nonexistent) command. JS `\s` disagreed and split it, which is how a
    // newline used to hide a second command behind words[0]. Splitting on
    // horizontal whitespace only means an unrecognised word can never be
    // mistaken for a known read-only binary.
    expect(classifyBash('ls\vrm -rf ~')).toBe('consequential');
    // \u00a0 is whitespace to JS `\s` and an ordinary word character to the shell
    expect(classifyBash('ls\u00a0rm -rf ~')).toBe('consequential');
    // a genuine argument list is untouched
    expect(classifyBash('ls -la src')).toBe('read');
  });

  it('still splits && and ;; as one separator, not into empty segments', () => {
    expect(classifyBash('ls && cat a.txt')).toBe('read');
    expect(classifyBash('ls ;; cat a.txt')).toBe('read');
    expect(classifyBash('ls |& cat')).toBe('read');
    expect(classifyBash('ls && rm -rf /')).toBe('consequential');
  });

  it('keeps a trailing & consequential — the command detaches from the run', () => {
    expect(classifyBash('ls &')).toBe('consequential');
    expect(classifyBash('cat a.txt | sort &')).toBe('consequential');
    // whereas an & in the middle is a separator: both sides must read
    expect(classifyBash('ls & cat a.txt')).toBe('read');
  });

  it('a separator-only command is not a read', () => {
    for (const cmd of [';', '&&', '|', '\n;\n']) {
      expect(classifyBash(cmd), cmd).not.toBe('read');
    }
  });

  // Scoped to SEPARATORS. Argument-level escapes — `find -exec`, `env <cmd>`,
  // `sed -i` — are a different hole in the read-only binary list and are NOT
  // covered here.
  it('no second command smuggled past a separator survives as a read', () => {
    for (const cmd of [
      'ls;\nrm -rf ~',
      'ls\n\nrm -rf ~',
      'ls\t&\trm -rf ~',
      'git\nstatus\ngit push',
      'ls # ok\nrm -rf /',
      'ls \\\nrm -rf ~', // backslash line continuation: the tail is its own segment
      'FOO=bar\nrm -rf ~',
      '(rm -rf /)', // subshell: the bracket stays attached, so no binary matches
      'ls | tee out.txt',
    ]) {
      expect(classifyBash(cmd), JSON.stringify(cmd)).not.toBe('read');
    }
  });

  // The invariant the two holes broke: no separator the shell honours can carry
  // a second command past the classifier.
  it('property: an action appended after any separator is never a read', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('ls', 'cat a.txt', 'git status', 'ps aux', 'pwd'),
        fc.constantFrom(';', '&', '&&', '||', '|', ';;', '|&', '\n', '\n\n', '\r\n', '\r', ' & ', ' ; '),
        fc.constantFrom('rm -rf /', 'curl -X POST https://x -d y', 'git push --force', 'npm publish', 'shutdown -h now'),
        (read, separator, action) => {
          const cmd = `${read}${separator}${action}`;
          expect(classifyBash(cmd), JSON.stringify(cmd)).not.toBe('read');
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('evaluateApproval — no policy allows a smuggled command (regression)', () => {
  // 'read' is ungated under EVERY policy, including 'always' (which gates
  // `cls !== 'read'`). A read-looking Bash command that runs `rm` therefore had
  // no setting that stopped it.
  const payloads = [
    'ls & rm -rf ~',
    'ls\nrm -rf ~',
    'echo hi\ngit push --force',
    'pwd\ncurl -X POST https://api.example.com/pay -d amount=99999',
  ];

  for (const policy of ['consequential', 'always'] as const) {
    it(`'${policy}' refuses them`, () => {
      for (const command of payloads) {
        const out = evaluateApproval(policy, 'Bash', { command });
        expect(out.allow, `${policy}: ${command}`).toBe(false);
        expect(out.class, `${policy}: ${command}`).not.toBe('read');
      }
    });
  }
});

describe('classifyToolCall — compound names that hide a second verb (regression)', () => {
  /**
   * splitCamelCase runs before the verb lists and READ_VERBS is tested first,
   * so any compound name whose FIRST segment reads returned 'read' no matter
   * what the rest of it did. That is worse than the unattended-approval path it
   * looks like: tool-policy.ts maps 'read' to `always_allow` and pushes it DOWN
   * INTO THE SDK, so such a tool is pre-approved and canUseTool never runs.
   */
  it('never classifies a name as read when a later segment acts on the world', () => {
    for (const n of [
      'findAndReplace',
      'findAndReplaceText',
      'queryAndDeleteRows',
      'listAndArchiveThreads',
      'checkAndSendInvoice',
      'getOrCreateChannel',
      'readFileAndWrite',
      'showAndDeleteEverything',
      'mcp__slack__findAndReplace',
    ]) {
      expect(classifyToolCall(n), n).toBe('consequential');
    }
  });

  it('applies to snake_case and kebab-case compounds too', () => {
    // `^check([_-]|$)` matched, so this returned 'read' without ever consulting
    // the consequential list for the later `Send` segment.
    expect(classifyToolCall('check_And_Send_Invoice')).toBe('consequential');
    expect(classifyToolCall('find-and-replace')).toBe('consequential');
    expect(classifyToolCall('get_or_create_channel')).toBe('consequential');
  });

  it('fails closed when the second operation cannot be recognised at all', () => {
    // Not in either verb list, so it can only be judged by the conjunction:
    // a read AND something unknown is not a read.
    expect(classifyToolCall('findAndFrobnicate')).toBe('unknown');
    expect(classifyToolCall('listOrZap')).toBe('unknown');
  });

  it('catches a hidden action with no conjunction to hint at it', () => {
    // The reason CONSEQUENTIAL_VERBS is tested against EVERY segment rather than
    // only the one after a conjunction. Anyone narrowing that rule to buy back
    // precision has to keep these gated.
    expect(classifyToolCall('searchInboxDeleteSpam')).toBe('consequential');
    expect(classifyToolCall('getIssueAndDeleteAttachments')).toBe('consequential');
    expect(classifyToolCall('listUsersThenSendDigest')).toBe('consequential');
  });

  it('over-gates a read whose noun happens to be an action verb — deliberately', () => {
    // The acknowledged cost of scanning every segment. `Start`/`Move` are nouns
    // here, but the classifier cannot tell, and a spurious approval prompt is the
    // cheap failure: the user can approve the tool once and be done.
    expect(classifyToolCall('getStartDate')).toBe('consequential');
    expect(classifyToolCall('getMoveHistory')).toBe('consequential');
    // Anchoring keeps the blast radius small — these nouns merely BEGIN with a
    // verb and are still reads.
    for (const n of ['getSetting', 'listAddresses', 'searchClosedIssues', 'listRuns', 'getPostmortem']) {
      expect(classifyToolCall(n), n).toBe('read');
    }
  });

  it('a compound of two reads is still a read', () => {
    expect(classifyToolCall('searchAndListThreads')).toBe('read');
    expect(classifyToolCall('findOrGetUser')).toBe('read');
  });

  it('does not mistake a word beginning with "or"/"and" for a conjunction', () => {
    expect(classifyToolCall('getOrders')).toBe('read');
    expect(classifyToolCall('getAndroidDevices')).toBe('read');
  });

  // The camelCase split was a genuine improvement; these must not regress while
  // closing the hole above.
  it('preserves the classifications the camelCase split got right', () => {
    for (const n of ['getIssue', 'searchJiraIssuesUsingJql', 'getTransitionsForJiraIssue']) {
      expect(classifyToolCall(n), n).toBe('read');
    }
    for (const n of ['sendMessage', 'deleteAllRecords', 'addCommentToJiraIssue']) {
      expect(classifyToolCall(n), n).toBe('consequential');
    }
    // No verb either list knows: still fails closed rather than guessing.
    expect(classifyToolCall('transitionJiraIssue')).toBe('unknown');
  });

  it('property: a read verb never launders a following action verb', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('get', 'list', 'read', 'search', 'find', 'query', 'check', 'show', 'fetch'),
        fc.constantFrom('', 'And', 'Or', 'Then', 'All', 'Every'),
        fc.constantFrom('Delete', 'Send', 'Create', 'Publish', 'Write', 'Pay', 'Remove', 'Archive', 'Replace', 'Push'),
        (read, joiner, action) => {
          const name = `${read}${joiner}${action}Things`;
          expect(classifyToolCall(name), name).not.toBe('read');
        },
      ),
      { numRuns: 500 },
    );
  });

  it('a compound write is never allowed unattended', () => {
    expect(evaluateApproval('consequential', 'mcp__docs__findAndReplace').allow).toBe(false);
    expect(evaluateApproval('always', 'mcp__docs__findAndReplace').allow).toBe(false);
    expect(evaluateApproval('consequential', 'mcp__x__getIssue').allow).toBe(true);
  });
});

describe('classifyToolCall — camelCase tool names (regression)', () => {
  /**
   * Both verb lists anchor on `([_-]|$)`, so before splitCamelCase every
   * camelCase name fell through to 'unknown'. Real MCP servers name tools in
   * camelCase, so the classifier was blind to most of what it exists to judge:
   * reads were gated as unknowns — pausing unattended runs on plain lookups —
   * and write verbs were caught only by the fail-closed default.
   */
  it('classifies the real Atlassian tool names correctly', () => {
    // These exact names appear in canvas/dispatch.ts, so they are not invented.
    expect(classifyToolCall('mcp__aime-mcp-atlassian__searchJiraIssuesUsingJql')).toBe('read');
    expect(classifyToolCall('mcp__aime-mcp-atlassian__getTransitionsForJiraIssue')).toBe('read');
    expect(classifyToolCall('mcp__aime-mcp-atlassian__getAccessibleAtlassianResources')).toBe('read');
    expect(classifyToolCall('mcp__aime-mcp-atlassian__addCommentToJiraIssue')).toBe('consequential');
  });

  it('reads camelCase read verbs as reads', () => {
    for (const n of ['getIssue', 'searchIssues', 'listProjects', 'readFile', 'fetchThread', 'findUser']) {
      expect(classifyToolCall(n), n).toBe('read');
    }
  });

  it('reads camelCase write verbs as consequential', () => {
    for (const n of ['deleteIssue', 'sendEmail', 'createPage', 'updateRecord', 'setFlag', 'publishPost']) {
      expect(classifyToolCall(n), n).toBe('consequential');
    }
  });

  it('keeps acronyms intact — the first segment is still the verb', () => {
    expect(classifyToolCall('getURLData')).toBe('read');
    expect(classifyToolCall('deleteDNSRecord')).toBe('consequential');
  });

  it('still fails closed on a name with no recognisable verb', () => {
    expect(classifyToolCall('frobnicate')).toBe('unknown');
    expect(classifyToolCall('doTheThing')).toBe('unknown');
  });

  it('leaves snake_case and kebab-case classification unchanged', () => {
    expect(classifyToolCall('get_issue')).toBe('read');
    expect(classifyToolCall('delete_issue')).toBe('consequential');
    expect(classifyToolCall('search-threads')).toBe('read');
  });

  it('does not reclassify an exact built-in match', () => {
    // BUILTIN lookup happens before verb matching; Write must stay consequential
    // even though splitCamelCase would leave it alone.
    expect(classifyToolCall('Write')).toBe('consequential');
    expect(classifyToolCall('Read')).toBe('read');
  });

  it('a camelCase read no longer pauses an unattended run', () => {
    // The user-visible consequence: standing orders touching Jira used to stop
    // on every lookup because the read classified as unknown.
    expect(evaluateApproval('consequential', 'mcp__x__getIssue').allow).toBe(true);
    expect(evaluateApproval('consequential', 'mcp__x__deleteIssue').allow).toBe(false);
  });
});
