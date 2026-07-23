import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseAgentsMd, matchAgentForMessage, readAgentSystemPrompt, type AgentConfig } from './agents-parser';

const AGENTS_MD = `---
agents:
  - name: researcher
    description: Deep research and web retrieval
    model: claude-opus-4-6
    allowedTools: [WebSearch, WebFetch, Read]
    triggers: [research, investigate, look up]
  - name: coder
    description: Writes code
    systemPrompt: |
      You write excellent code.
---

# Notes below the frontmatter are ignored.
`;

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-parser-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseAgentsMd', () => {
  // Regression: agents-parser requires js-yaml at runtime inside a try/catch.
  // Before js-yaml was added as a dependency this silently returned [] for
  // every AGENTS.md, disabling agent routing entirely.
  it('parses a well-formed AGENTS.md (js-yaml must be installed)', () => {
    const file = path.join(tmpDir, 'AGENTS.md');
    fs.writeFileSync(file, AGENTS_MD);

    const agents = parseAgentsMd(file);
    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({
      name: 'researcher',
      description: 'Deep research and web retrieval',
      model: 'claude-opus-4-6',
      allowedTools: ['WebSearch', 'WebFetch', 'Read'],
      triggers: ['research', 'investigate', 'look up'],
    });
    expect(agents[1].name).toBe('coder');
    expect(agents[1].systemPrompt).toContain('excellent code');
  });

  it('returns [] for a missing file', () => {
    expect(parseAgentsMd(path.join(tmpDir, 'nope.md'))).toEqual([]);
  });

  it('returns [] when there is no frontmatter', () => {
    const file = path.join(tmpDir, 'plain.md');
    fs.writeFileSync(file, '# Just a doc\nNo frontmatter here.');
    expect(parseAgentsMd(file)).toEqual([]);
  });

  it('returns [] when frontmatter has no agents array', () => {
    const file = path.join(tmpDir, 'noagents.md');
    fs.writeFileSync(file, '---\ntitle: hello\n---\nbody');
    expect(parseAgentsMd(file)).toEqual([]);
  });

  it('returns [] for malformed YAML instead of throwing', () => {
    const file = path.join(tmpDir, 'broken.md');
    fs.writeFileSync(file, '---\nagents: [unclosed\n  - ]: {{\n---\n');
    expect(parseAgentsMd(file)).toEqual([]);
  });
});

describe('matchAgentForMessage', () => {
  const agents: AgentConfig[] = [
    { name: 'researcher', description: '', triggers: ['research', 'look up'] },
    { name: 'coder', description: '', triggers: ['refactor'] },
    { name: 'no-triggers', description: '' },
  ];

  it('matches a trigger case-insensitively anywhere in the message', () => {
    expect(matchAgentForMessage('Please RESEARCH this topic', agents)?.name).toBe('researcher');
    expect(matchAgentForMessage('can you look up the docs', agents)?.name).toBe('researcher');
  });

  it('returns the first matching agent in declaration order', () => {
    expect(matchAgentForMessage('research then refactor', agents)?.name).toBe('researcher');
  });

  it('skips agents without triggers and returns null when nothing matches', () => {
    expect(matchAgentForMessage('hello there', agents)).toBeNull();
    expect(matchAgentForMessage('hello there', [])).toBeNull();
  });
});

describe('readAgentSystemPrompt', () => {
  it('prefers the inline systemPrompt', () => {
    const agent: AgentConfig = {
      name: 'a',
      description: '',
      systemPrompt: '  inline prompt  ',
      systemPromptFile: '/does/not/matter.md',
    };
    expect(readAgentSystemPrompt(agent)).toBe('inline prompt');
  });

  it('falls back to reading systemPromptFile', () => {
    const file = path.join(tmpDir, 'prompt.md');
    fs.writeFileSync(file, 'You are a careful reviewer.\n');
    const agent: AgentConfig = { name: 'a', description: '', systemPromptFile: file };
    expect(readAgentSystemPrompt(agent)).toBe('You are a careful reviewer.');
  });

  it('returns empty string when neither prompt source exists', () => {
    expect(readAgentSystemPrompt({ name: 'a', description: '' })).toBe('');
    expect(
      readAgentSystemPrompt({ name: 'a', description: '', systemPromptFile: path.join(tmpDir, 'missing.md') }),
    ).toBe('');
  });
});
