import { describe, it, expect } from 'vitest';
import { categorizeToolCall, isValidSidebarEntry, artifactsFromMessages } from './artifact-tracker';

describe('categorizeToolCall', () => {
  describe('artifact tools', () => {
    it('categorizes Write/Edit/NotebookEdit as artifacts', () => {
      expect(categorizeToolCall('Write', { file_path: '/tmp/report.md' })).toEqual({
        category: 'artifact',
        path: '/tmp/report.md',
      });
      expect(categorizeToolCall('Edit', { file_path: '/tmp/a.ts' })?.category).toBe('artifact');
      expect(categorizeToolCall('NotebookEdit', { notebook_path: '/tmp/nb.ipynb' })?.path).toBe('/tmp/nb.ipynb');
    });

    it('categorizes Excel MCP write tools regardless of prefix style', () => {
      expect(categorizeToolCall('mcp__excel__ExcelWrite', { path: '/tmp/w.xlsx' })?.category).toBe('artifact');
      expect(categorizeToolCall('excel:ExcelEdit', { path: '/tmp/w.xlsx' })?.category).toBe('artifact');
    });

    it('returns null when the artifact tool has no string path', () => {
      expect(categorizeToolCall('Write', {})).toBeNull();
      expect(categorizeToolCall('Write', { file_path: 42 })).toBeNull();
    });
  });

  describe('context tools', () => {
    it('categorizes Read as context', () => {
      expect(categorizeToolCall('Read', { file_path: '/proj/README.md' })).toEqual({
        category: 'context',
        path: '/proj/README.md',
      });
    });

    it('suppresses internal/noise paths from context', () => {
      expect(categorizeToolCall('Read', { file_path: '/home/u/.claude/settings.json' })).toBeNull();
      expect(categorizeToolCall('Read', { file_path: '/proj/CLAUDE.md' })).toBeNull();
      expect(categorizeToolCall('Read', { file_path: '/proj/node_modules/x/index.js' })).toBeNull();
      expect(categorizeToolCall('Read', { file_path: '/proj/run.sh' })).toBeNull();
      expect(categorizeToolCall('Read', { file_path: '/proj/tool.py' })).toBeNull();
      expect(categorizeToolCall('Read', { file_path: '/home/u/.quarry/tmp/doc.txt' })).toBeNull();
    });

    it('never adds Glob/Grep or WebFetch to the sidebar', () => {
      expect(categorizeToolCall('Glob', { pattern: '**/*.ts' })).toBeNull();
      expect(categorizeToolCall('Grep', { pattern: 'TODO' })).toBeNull();
      expect(categorizeToolCall('WebFetch', { url: 'https://example.com' })).toBeNull();
    });
  });

  describe('Bash commands', () => {
    it('detects redirect writes', () => {
      expect(categorizeToolCall('Bash', { command: 'echo "hi" > /tmp/out.txt' })).toEqual({
        category: 'artifact',
        path: '/tmp/out.txt',
      });
    });

    it('ignores stderr redirects like 2>&1', () => {
      expect(categorizeToolCall('Bash', { command: 'make build 2>&1' })).toBeNull();
    });

    it('skips /dev/null targets', () => {
      expect(categorizeToolCall('Bash', { command: 'grep -r foo . > /dev/null' })).toBeNull();
    });

    it('detects tee, cp, mv, mkdir and touch targets', () => {
      expect(categorizeToolCall('Bash', { command: 'cat log | tee /tmp/copy.log' })?.path).toBe('/tmp/copy.log');
      expect(categorizeToolCall('Bash', { command: 'cp a.txt b.txt' })?.path).toBe('b.txt');
      expect(categorizeToolCall('Bash', { command: 'mv old.txt new.txt' })?.path).toBe('new.txt');
      expect(categorizeToolCall('Bash', { command: 'mkdir -p out/dir' })?.path).toBe('out/dir');
      expect(categorizeToolCall('Bash', { command: 'touch marker.txt' })?.path).toBe('marker.txt');
    });

    it('detects document outputs from script invocations (rightmost token)', () => {
      const result = categorizeToolCall('Bash', {
        command: 'bash generate_presentation.sh input.md ~/slides/deck.pptx',
      });
      expect(result).toEqual({ category: 'artifact', path: '~/slides/deck.pptx' });
    });

    it('ignores noisy read-only commands', () => {
      expect(categorizeToolCall('Bash', { command: 'ls -la' })).toBeNull();
      expect(categorizeToolCall('Bash', { command: 'git status' })).toBeNull();
      expect(categorizeToolCall('Bash', { command: 'pwd' })).toBeNull();
    });

    it('returns null for empty or unrecognized commands', () => {
      expect(categorizeToolCall('Bash', {})).toBeNull();
      expect(categorizeToolCall('Bash', { command: 'npm run typecheck' })).toBeNull();
    });
  });

  it('returns null for unknown tools', () => {
    expect(categorizeToolCall('SomeOtherTool', { anything: true })).toBeNull();
  });
});

describe('isValidSidebarEntry', () => {
  it('accepts normal file paths', () => {
    expect(isValidSidebarEntry('/tmp/report.md')).toBe(true);
    expect(isValidSidebarEntry('~/docs/plan.docx')).toBe(true);
  });

  it('rejects empty and single-character paths', () => {
    expect(isValidSidebarEntry('')).toBe(false);
    expect(isValidSidebarEntry('a')).toBe(false);
  });

  it('rejects HTML fragments and URLs', () => {
    expect(isValidSidebarEntry('div>content')).toBe(false);
    expect(isValidSidebarEntry('<p>')).toBe(false);
    expect(isValidSidebarEntry('https://example.com/x')).toBe(false);
    expect(isValidSidebarEntry('foo?bar=1')).toBe(false);
  });

  it('rejects bare web-asset filenames but keeps them when in a directory', () => {
    expect(isValidSidebarEntry('styles.css')).toBe(false);
    expect(isValidSidebarEntry('site/styles.css')).toBe(true);
  });

  it('filters internal app paths but allows scratch artifacts', () => {
    expect(isValidSidebarEntry('/home/u/.aime/tmp/x.txt')).toBe(false);
    expect(isValidSidebarEntry('/home/u/.aime/scratch/chat1/out.pptx')).toBe(true);
    expect(isValidSidebarEntry('/home/u/.aime/scratch/chat1/documents/extracted.txt')).toBe(false);
  });

  it('keeps filtering legacy .quarry paths (pre-rename conversations)', () => {
    expect(isValidSidebarEntry('/home/u/.quarry/tmp/x.txt')).toBe(false);
    expect(isValidSidebarEntry('/home/u/.quarry/scratch/chat1/out.pptx')).toBe(true);
    expect(isValidSidebarEntry('/home/u/.quarry/scratch/chat1/documents/extracted.txt')).toBe(false);
  });
});

/**
 * The panel is read back from the transcript, not accumulated as the stream
 * runs. It showed "Artifacts 0" for a conversation whose deck was three
 * messages up, because the list lived in component state that a conversation
 * switch — or a reload — emptied.
 */
describe('artifactsFromMessages', () => {
  it('finds the deck a Bash heredoc wrote', () => {
    expect(
      artifactsFromMessages([
        { toolCalls: [{ name: 'Bash', input: { command: 'cat > /Users/me/work/deck.html << "EOF"' } }] },
      ]),
    ).toEqual(['/Users/me/work/deck.html']);
  });

  /*
   * `categorizeToolCall` answers with ONE path per tool call — the last document
   * it sees — which is why this walks every match instead of calling it and
   * stopping. A single command that emits a deck and its handout is one call and
   * two artifacts, and reporting only the handout is how a file goes missing
   * from a panel that is otherwise working.
   */
  it('finds every document a single command produced, not just the last', () => {
    expect(
      artifactsFromMessages([
        {
          toolCalls: [
            { name: 'Bash', input: { command: 'sh build.sh --deck /w/deck.pdf --handout /w/handout.pdf' } },
          ],
        },
      ]),
    ).toEqual(['/w/deck.pdf', '/w/handout.pdf']);
  });

  it('finds Write and Edit alongside shell writes, in order, without duplicates', () => {
    expect(
      artifactsFromMessages([
        { toolCalls: [{ name: 'Write', input: { file_path: '/w/a.md' } }] },
        { toolCalls: [{ name: 'Read', input: { file_path: '/w/source.md' } }] },
        {
          toolCalls: [
            { name: 'Edit', input: { file_path: '/w/a.md' } },
            { name: 'Bash', input: { command: 'echo x > /w/b.html' } },
          ],
        },
      ]),
    ).toEqual(['/w/a.md', '/w/b.html']);
  });

  /*
   * The point of deriving: the SAME transcript must give the SAME list on a
   * later render, with no live stream and no accumulated state. This is the
   * case that was broken — reopen the conversation and the panel read 0.
   */
  it('gives the same answer when the conversation is reopened', () => {
    const transcript = [
      { toolCalls: [{ name: 'Bash', input: { command: 'cat > /w/deck.html << "EOF"' } }] },
      { toolCalls: [{ name: 'Write', input: { file_path: '/w/notes.md' } }] },
    ];
    expect(artifactsFromMessages(transcript)).toEqual(artifactsFromMessages(transcript));
    expect(artifactsFromMessages(transcript)).toHaveLength(2);
  });

  it('leaves out reads, empty turns, and the app\'s own internals', () => {
    expect(
      artifactsFromMessages([
        {},
        { toolCalls: [] },
        { toolCalls: [{ name: 'Read', input: { file_path: '/w/x.md' } }] },
        { toolCalls: [{ name: 'Bash', input: { command: 'curl -s https://x.com > /dev/null' } }] },
        { toolCalls: [{ name: 'Write', input: { file_path: '/Users/me/.aime/documents/tmp.txt' } }] },
      ]),
    ).toEqual([]);
  });

  it('keeps finding documents across turns', () => {
    expect(
      artifactsFromMessages([
        { toolCalls: [{ name: 'Bash', input: { command: 'sh mk.sh /w/one.pdf' } }] },
        { toolCalls: [{ name: 'Bash', input: { command: 'sh mk.sh /w/two.pdf' } }] },
      ]),
      'the second document was missed',
    ).toEqual(['/w/one.pdf', '/w/two.pdf']);
  });
});

/**
 * Cowork's sidebar shows what the agent is DOING; Chat's lists files. That was
 * the only real difference between the two copies of this function, and keeping
 * two copies to express it meant only one of them was ever reachable from a
 * test — so Cowork's entire categorisation ran unverified.
 *
 * These drive both modes through the one implementation.
 */
describe('richContext (Cowork) vs files-only (Chat)', () => {
  const RICH = { richContext: true };

  it.each([
    ['spawn_agent', { agentName: 'researcher', task: 'find comparable filings' }],
    ['mcp__web-search__web_search', { query: 'iso 27001 scope' }],
    ['WebSearch', { query: 'iso 27001 scope' }],
    ['Bash', { command: 'npm run typecheck' }],
  ])('%s is an activity entry for Cowork', (tool, input) => {
    expect(categorizeToolCall(tool, input, RICH)?.category).toBe('context');
  });

  it.each([
    ['spawn_agent', { agentName: 'researcher', task: 'find comparable filings' }],
    ['mcp__web-search__web_search', { query: 'iso 27001 scope' }],
    ['WebSearch', { query: 'iso 27001 scope' }],
    ['Bash', { command: 'npm run typecheck' }],
  ])('%s is nothing for Chat', (tool, input) => {
    expect(categorizeToolCall(tool, input)).toBeNull();
  });

  it('labels activity entries so the sidebar can tell them from paths', () => {
    expect(categorizeToolCall('spawn_agent', { agentName: 'scout', task: 'dig' }, RICH)?.path)
      .toContain('scout');
    expect(categorizeToolCall('WebSearch', { query: 'acme ltd' }, RICH)?.path)
      .toContain('acme ltd');
    expect(categorizeToolCall('Bash', { command: 'npm run build' }, RICH)?.path)
      .toContain('npm run build');
  });

  it('falls back to a generic label when a subagent is unnamed', () => {
    expect(categorizeToolCall('spawn_agent', { task: 'dig' }, RICH)?.path).toContain('subagent');
  });

  it('truncates a long command rather than pasting it into the sidebar', () => {
    const path = categorizeToolCall('Bash', { command: 'x'.repeat(200) }, RICH)!.path;
    expect(path.length).toBeLessThan(80);
    expect(path).toContain('...');
  });

  /*
   * The half that must NOT vary by surface. A file is a file on both, and a mode
   * flag that changed this would be the drift the consolidation exists to stop.
   */
  it.each([
    ['Write', { file_path: '/w/a.md' }, 'artifact'],
    ['Bash', { command: 'cat > /w/deck.html' }, 'artifact'],
    ['Read', { file_path: '/w/src.md' }, 'context'],
    ['WebFetch', { url: 'https://x.com' }, null],
    ['Bash', { command: 'ls -la' }, null],
  ])('%s categorises identically in both modes', (tool, input, expected) => {
    const chat = categorizeToolCall(tool, input);
    const cowork = categorizeToolCall(tool, input, RICH);
    expect(cowork).toEqual(chat);
    expect(chat?.category ?? null).toBe(expected);
  });
});

/**
 * Gaps found by mutation-testing this file (74% score, 111 survivors). Most of
 * those are the regex TABLE, where survivors are largely equivalent mutants and
 * chasing them writes tests for the tool rather than for a bug — the same
 * conclusion stryker.conf.json already records for destructive-commands.ts.
 *
 * These are the survivors that were NOT that: guards in the code this change
 * added or consolidated, where nothing would have noticed if the condition
 * inverted. Two of the tests in this file were vacuous when first written, so
 * "I checked carefully" is not the standard here.
 */
describe('guards that nothing was checking', () => {
  it('does not mine a non-Bash tool for document names', () => {
    // `Read` with an input that happens to carry a `command` key must not have
    // its value swept — only Bash runs commands.
    expect(
      artifactsFromMessages([
        { toolCalls: [{ name: 'Read', input: { command: 'sh mk.sh /w/report.pdf' } }] },
      ]),
    ).toEqual([]);
  });

  it('survives a Bash call whose command is not a string', () => {
    expect(() =>
      artifactsFromMessages([{ toolCalls: [{ name: 'Bash', input: { command: 42 } }] }]),
    ).not.toThrow();
    expect(artifactsFromMessages([{ toolCalls: [{ name: 'Bash', input: { command: 42 } }] }])).toEqual([]);
  });

  it('skips dotfiles the sweep would otherwise pick up', () => {
    expect(
      artifactsFromMessages([
        { toolCalls: [{ name: 'Bash', input: { command: 'sh mk.sh .cache.pdf' } }] },
      ]),
      'a dotfile was listed as an artifact',
    ).toEqual([]);
  });

  it('truncates a long subagent task instead of pasting it into the sidebar', () => {
    const path = categorizeToolCall(
      'spawn_agent',
      { agentName: 'scout', task: 'x'.repeat(200) },
      { richContext: true },
    )!.path;
    expect(path).toContain('…');
    expect(path.length).toBeLessThan(70);
  });

  it('leaves a short subagent task whole', () => {
    const path = categorizeToolCall(
      'spawn_agent',
      { agentName: 'scout', task: 'find filings' },
      { richContext: true },
    )!.path;
    expect(path).toBe('agent: scout: find filings');
    expect(path).not.toContain('…');
  });

  it('leaves a short command whole', () => {
    expect(categorizeToolCall('Bash', { command: 'npm run build' }, { richContext: true })!.path)
      .toBe('bash: npm run build');
  });
});
