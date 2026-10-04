import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { shortenHomePaths } from './shorten-home-paths';

describe('shortenHomePaths', () => {
  it.each([
    ['Create /Users/alex/.claude/SOUL.md to configure it', 'Create ~/.claude/SOUL.md to configure it'],
    ['Check /home/alex/.claude/.aime-mcp.json', 'Check ~/.claude/.aime-mcp.json'],
    ['Delete C:\\Users\\alex\\.claude\\x.json', 'Delete ~\\.claude\\x.json'],
    ['Home is /Users/alex.', 'Home is ~.'],
    ['Two: /Users/a/x and /home/b/y', 'Two: ~/x and ~/y'],
  ])('%s', (input, expected) => {
    expect(shortenHomePaths(input)).toBe(expected);
  });

  it('leaves text without a home path unchanged', () => {
    expect(shortenHomePaths('Run: chmod u+w ~/.claude')).toBe('Run: chmod u+w ~/.claude');
    expect(shortenHomePaths('/usr/local/bin/node')).toBe('/usr/local/bin/node');
    expect(shortenHomePaths('/Users/Shared/tools')).toBe('/Users/Shared/tools');
  });

  it('never leaves a user name behind a /Users/ or /home/ prefix', () => {
    const name = fc.stringMatching(/^[A-Za-z][A-Za-z0-9._-]{0,15}$/).filter((n) => n !== 'Shared');
    fc.assert(
      fc.property(name, fc.constantFrom('/Users/', '/home/'), fc.stringMatching(/^[a-z./]{0,20}$/), (n, root, rest) => {
        const out = shortenHomePaths(`see ${root}${n}/${rest}`);
        expect(out).toBe(`see ~/${rest}`);
      }),
    );
  });
});
