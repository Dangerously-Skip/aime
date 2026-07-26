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
