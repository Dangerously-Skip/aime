import { describe, it, expect } from 'vitest';
import {
  classifyContextEntry,
  contextEntryDisplayName,
  isOpenableEntry,
  isSearchEntry,
  SEARCH_PREFIX,
  AGENT_PREFIX,
  COMMAND_PREFIX,
} from './context-entry';

/**
 * These prefixes are a type tag, not decoration. Before this module the tag was
 * an emoji sniffed out with `path.startsWith("🔍 ")` in two separate places, and
 * the two lists disagreed — one checked search only, the other search + bash +
 * agent. Clicking a row that is a *description of work* rather than a location
 * must do nothing; getting that wrong sends a search query to the OS as a path.
 */
describe('classifyContextEntry', () => {
  it('reads a plain path as a file', () => {
    expect(classifyContextEntry('/Users/x/proj/main.ts')).toEqual({
      kind: 'file',
      label: '/Users/x/proj/main.ts',
    });
  });

  it('reads the current prefixes and strips them from the label', () => {
    expect(classifyContextEntry(`${SEARCH_PREFIX}how to fix hydration`)).toEqual({
      kind: 'search',
      label: 'how to fix hydration',
    });
    expect(classifyContextEntry(`${AGENT_PREFIX}reviewer: check the diff`)).toEqual({
      kind: 'agent',
      label: 'reviewer: check the diff',
    });
    expect(classifyContextEntry(`${COMMAND_PREFIX}git status`)).toEqual({
      kind: 'command',
      label: 'git status',
    });
  });

  it('still reads the LEGACY emoji prefixes from older conversations', () => {
    // Persisted rows from earlier builds carry these. If they stopped matching,
    // an old search row would be treated as a file and become clickable.
    expect(classifyContextEntry('🔍 old query')).toEqual({ kind: 'search', label: 'old query' });
    expect(classifyContextEntry('⚡ subagent: old task')).toEqual({
      kind: 'agent',
      label: 'subagent: old task',
    });
  });

  it('reads an http(s) entry as a url', () => {
    expect(classifyContextEntry('https://example.com/a').kind).toBe('url');
    expect(classifyContextEntry('http://example.com/a').kind).toBe('url');
  });

  it('does not mistake a path containing a prefix word for a tagged entry', () => {
    // A real file may legitimately be named like the tag.
    expect(classifyContextEntry('/tmp/search: notes.txt').kind).toBe('file');
    expect(classifyContextEntry('/tmp/bash: script.sh').kind).toBe('file');
  });
});

describe('isOpenableEntry', () => {
  it('allows files and urls', () => {
    expect(isOpenableEntry('/Users/x/a.ts')).toBe(true);
    expect(isOpenableEntry('https://example.com')).toBe(true);
  });

  it('refuses every description-of-work row, current and legacy', () => {
    for (const entry of [
      `${SEARCH_PREFIX}q`,
      `${AGENT_PREFIX}a`,
      `${COMMAND_PREFIX}ls`,
      '🔍 q',
      '⚡ a',
    ]) {
      expect(isOpenableEntry(entry), entry).toBe(false);
    }
  });
});

describe('isSearchEntry', () => {
  it('is true for both spellings and false otherwise', () => {
    expect(isSearchEntry(`${SEARCH_PREFIX}q`)).toBe(true);
    expect(isSearchEntry('🔍 q')).toBe(true);
    expect(isSearchEntry(`${COMMAND_PREFIX}ls`)).toBe(false);
    expect(isSearchEntry('/Users/x/a.ts')).toBe(false);
  });
});

describe('contextEntryDisplayName', () => {
  it('shows the basename of a file', () => {
    expect(contextEntryDisplayName('/Users/x/proj/main.ts')).toBe('main.ts');
  });

  it('shows tagged entries whole, without the tag and without basename-ing them', () => {
    // A query containing slashes must not be truncated to its last segment.
    expect(contextEntryDisplayName(`${SEARCH_PREFIX}react hooks / effects`)).toBe(
      'react hooks / effects',
    );
    expect(contextEntryDisplayName('🔍 a/b')).toBe('a/b');
    expect(contextEntryDisplayName(`${COMMAND_PREFIX}ls -la /tmp`)).toBe('ls -la /tmp');
  });

  it('falls back to the whole string when there is no basename', () => {
    expect(contextEntryDisplayName('/')).toBe('/');
  });

  it('contains no emoji for a newly written entry', () => {
    const written = [`${SEARCH_PREFIX}q`, `${AGENT_PREFIX}a`, `${COMMAND_PREFIX}ls`];
    for (const e of written) {
      expect(e).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });
});
