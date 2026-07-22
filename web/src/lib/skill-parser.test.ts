import { describe, it, expect } from 'vitest';
import { parseSkillMd, serializeSkillMd, evaluateSkillRequires } from './skill-parser';

describe('parseSkillMd', () => {
  it('parses frontmatter and body', () => {
    const { frontmatter, body } = parseSkillMd(`---
name: deploy
description: Deploys the app
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
---

# Deploy steps
Run the thing.`);

    expect(frontmatter.name).toBe('deploy');
    expect(frontmatter.description).toBe('Deploys the app');
    expect(frontmatter['disable-model-invocation']).toBe(true);
    expect(frontmatter['allowed-tools']).toEqual(['Bash', 'Read']);
    expect(body).toBe('# Deploy steps\nRun the thing.');
  });

  it('returns empty frontmatter when there is none', () => {
    const { frontmatter, body } = parseSkillMd('# Just markdown');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# Just markdown');
  });

  it('treats unterminated frontmatter as body', () => {
    const content = '---\nname: broken\nno closing delimiter';
    const { frontmatter, body } = parseSkillMd(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it('parses booleans, integers and strips quotes', () => {
    const { frontmatter } = parseSkillMd(`---
user-invocable: false
priority: 42
model: "claude-sonnet-5"
hint: 'quoted'
---
body`);
    expect(frontmatter['user-invocable']).toBe(false);
    expect(frontmatter.priority).toBe(42);
    expect(frontmatter.model).toBe('claude-sonnet-5');
    expect(frontmatter.hint).toBe('quoted');
  });

  it('skips comments and blank lines', () => {
    const { frontmatter } = parseSkillMd(`---
# a comment
name: x

description: y
---
body`);
    expect(frontmatter).toEqual({ name: 'x', description: 'y' });
  });

  it('parses a trailing array at the end of the frontmatter', () => {
    const { frontmatter } = parseSkillMd(`---
context:
  - file1.md
  - file2.md
---
body`);
    expect(frontmatter.context).toEqual(['file1.md', 'file2.md']);
  });
});

describe('serializeSkillMd', () => {
  it('round-trips frontmatter and body', () => {
    const original = {
      name: 'deploy',
      description: 'Deploys the app',
      'disable-model-invocation': true,
      'allowed-tools': ['Bash', 'Read'],
    };
    const serialized = serializeSkillMd(original, '# Body');
    const { frontmatter, body } = parseSkillMd(serialized);
    expect(frontmatter).toEqual(original);
    expect(body).toBe('# Body');
  });

  it('omits undefined/null values', () => {
    const serialized = serializeSkillMd({ name: 'x', model: undefined, agent: undefined }, 'body');
    expect(serialized).not.toContain('model');
    expect(serialized).not.toContain('agent');
  });

  it('returns bare body when frontmatter is empty', () => {
    expect(serializeSkillMd({}, 'just body')).toBe('just body');
  });
});

describe('evaluateSkillRequires', () => {
  it('passes when there are no requirements', () => {
    expect(evaluateSkillRequires(undefined)).toEqual({ disabled: false });
    expect(evaluateSkillRequires({})).toEqual({ disabled: false });
  });

  it('disables on platform mismatch', () => {
    const other = process.platform === 'darwin' ? 'win32' : 'darwin';
    const result = evaluateSkillRequires({ platform: other });
    expect(result.disabled).toBe(true);
    expect(result.reason).toContain(other);
  });

  it('passes on matching platform', () => {
    expect(evaluateSkillRequires({ platform: process.platform }).disabled).toBe(false);
  });

  it('disables when a required env var is missing', () => {
    const result = evaluateSkillRequires({ env: ['QUARRY_TEST_DEFINITELY_UNSET_VAR'] });
    expect(result.disabled).toBe(true);
    expect(result.reason).toContain('QUARRY_TEST_DEFINITELY_UNSET_VAR');
  });

  it('passes when required env vars are present', () => {
    process.env.QUARRY_TEST_SET_VAR = '1';
    try {
      expect(evaluateSkillRequires({ env: ['QUARRY_TEST_SET_VAR'] }).disabled).toBe(false);
    } finally {
      delete process.env.QUARRY_TEST_SET_VAR;
    }
  });

  it('disables when a required binary is missing', () => {
    const result = evaluateSkillRequires({ bins: ['definitely-not-a-real-binary-xyz'] });
    expect(result.disabled).toBe(true);
    expect(result.reason).toContain('definitely-not-a-real-binary-xyz');
  });

  it('passes when required binaries exist', () => {
    expect(evaluateSkillRequires({ bins: ['sh'] }).disabled).toBe(false);
  });
});
