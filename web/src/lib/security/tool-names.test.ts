import { describe, it, expect } from 'vitest';
import { baseToolName, toolMatches } from './tool-names';

/**
 * The mismatch this exists for: the SDK dispatches in-process MCP tools as
 * `mcp__<server>__<Tool>`, while the surface configs name some of them bare
 * (cowork-config lists `'ExcelWrite'` unprefixed and `'mcp__aime__canvas'`
 * prefixed, in the same array). Comparing with `===` therefore checked a name
 * the SDK never passes — so `FILE_WRITE_TOOLS.has('mcp__aime__ExcelWrite')` was
 * false and the write-scope gate skipped every MCP writer.
 */
describe('baseToolName', () => {
  it('strips the server prefix', () => {
    expect(baseToolName('mcp__aime__ExcelWrite')).toBe('ExcelWrite');
    expect(baseToolName('mcp__aime__canvas')).toBe('canvas');
  });

  it('handles a server name containing underscores', () => {
    expect(baseToolName('mcp__aime-mcp-github__createIssue')).toBe('createIssue');
    expect(baseToolName('mcp__web-search__web_search')).toBe('web_search');
  });

  it('keeps a tool name whose own name contains underscores', () => {
    expect(baseToolName('mcp__aime__web_search_tool')).toBe('web_search_tool');
  });

  it('leaves a plain built-in alone', () => {
    for (const n of ['Bash', 'Write', 'NotebookEdit', 'spawn_agent', '']) {
      expect(baseToolName(n)).toBe(n);
    }
  });

  it('leaves something that merely looks prefixed alone', () => {
    expect(baseToolName('mcp__nodoubleunderscore')).toBe('mcp__nodoubleunderscore');
  });
});

describe('toolMatches', () => {
  it('matches when the set holds the exact name', () => {
    expect(toolMatches('Bash', new Set(['Bash']))).toBe(true);
    expect(toolMatches('mcp__aime__canvas', new Set(['mcp__aime__canvas']))).toBe(true);
  });

  it('matches a PREFIXED call against a BARE set entry — the actual bug', () => {
    expect(toolMatches('mcp__aime__ExcelWrite', new Set(['ExcelWrite']))).toBe(true);
    expect(toolMatches('mcp__aime__DocumentCreate', new Set(['DocumentCreate']))).toBe(true);
  });

  it('does not match an unrelated tool', () => {
    expect(toolMatches('Read', new Set(['Write', 'Edit']))).toBe(false);
    expect(toolMatches('mcp__aime__ExcelRead', new Set(['ExcelWrite']))).toBe(false);
  });

  it('is empty-set safe', () => {
    expect(toolMatches('Bash', new Set())).toBe(false);
  });

  /**
   * Documented over-match: the server is deliberately not part of the
   * comparison, so a hostile server naming a tool `Bash` collapses onto the
   * built-in. Safe for a DENY set (over-match), which is all this is used for.
   */
  it('collapses a same-named tool from any server onto the bare name', () => {
    expect(toolMatches('mcp__evil__Bash', new Set(['Bash']))).toBe(true);
  });
});
