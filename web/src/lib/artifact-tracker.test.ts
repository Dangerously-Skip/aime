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
