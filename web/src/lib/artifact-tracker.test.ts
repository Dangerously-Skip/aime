import { describe, it, expect } from 'vitest';
import { categorizeToolCall, isValidSidebarEntry } from './artifact-tracker';

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

  it('filters internal quarry paths but allows scratch artifacts', () => {
    expect(isValidSidebarEntry('/home/u/.quarry/tmp/x.txt')).toBe(false);
    expect(isValidSidebarEntry('/home/u/.quarry/scratch/chat1/out.pptx')).toBe(true);
    expect(isValidSidebarEntry('/home/u/.quarry/scratch/chat1/documents/extracted.txt')).toBe(false);
  });
});
