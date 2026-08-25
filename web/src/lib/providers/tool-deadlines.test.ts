import { describe, it, expect } from 'vitest';
import {
  toolDeadlineMs,
  isNetworkTool,
  NETWORK_TOOL_DEADLINE_MS,
  TOOL_DEADLINE_HEADROOM_MS,
} from './tool-deadlines';

describe('isNetworkTool', () => {
  it('classifies built-in web tools as network', () => {
    expect(isNetworkTool('WebFetch')).toBe(true);
    expect(isNetworkTool('WebSearch')).toBe(true);
  });

  it('classifies every MCP tool as network', () => {
    expect(isNetworkTool('mcp__aime__FetchUrl')).toBe(true);
    expect(isNetworkTool('mcp__github__create_issue')).toBe(true);
    expect(isNetworkTool('mcp__web-search__web_search')).toBe(true);
  });

  it('leaves local execution tools alone', () => {
    expect(isNetworkTool('Bash')).toBe(false);
    expect(isNetworkTool('Skill')).toBe(false);
    expect(isNetworkTool('Read')).toBe(false);
    // A name that merely contains the prefix mid-string is not an MCP tool.
    expect(isNetworkTool('Notmcp__x')).toBe(false);
  });
});

describe('toolDeadlineMs', () => {
  it('network tools get the tight deadline on every surface', () => {
    for (const secs of [null, 0, 300, 600, 3600]) {
      expect(toolDeadlineMs('mcp__slack__post_message', secs)).toBe(NETWORK_TOOL_DEADLINE_MS);
      expect(toolDeadlineMs('WebFetch', secs)).toBe(NETWORK_TOOL_DEADLINE_MS);
    }
  });

  it('local tools ride the surface budget minus headroom', () => {
    expect(toolDeadlineMs('Bash', 600)).toBe(570_000);
    expect(toolDeadlineMs('Bash', 601)).toBe(571_000);
    expect(toolDeadlineMs('Skill', 300)).toBe(270_000);
  });

  it('never gives a local tool less than the network deadline', () => {
    const tight = NETWORK_TOOL_DEADLINE_MS / 1000 + TOOL_DEADLINE_HEADROOM_MS / 1000;
    expect(toolDeadlineMs('Bash', tight)).toBe(NETWORK_TOOL_DEADLINE_MS);
    expect(toolDeadlineMs('Bash', 100)).toBe(NETWORK_TOOL_DEADLINE_MS);
  });

  it('with no surface budget, falls back to the network deadline rather than infinity', () => {
    expect(toolDeadlineMs('Bash', null)).toBe(NETWORK_TOOL_DEADLINE_MS);
    expect(toolDeadlineMs('Bash', undefined)).toBe(NETWORK_TOOL_DEADLINE_MS);
    expect(toolDeadlineMs('Bash', 0)).toBe(NETWORK_TOOL_DEADLINE_MS);
  });
});
