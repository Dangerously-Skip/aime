import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Customize copy names the product through APP_NAME and carries no internal
 * leftovers.
 *
 * Found in review: "Connect Claude to your apps", "Official Claude Code
 * plugins", "User or Claude", a hardcoded `AIME` in two places, an error
 * message about `rqp auth` and "the nib CLI" (an internal tool no open-source
 * user has), a Snowflake example that looked like a real account locator, and
 * "Ask IT to register an app". Each was a string literal, so this reads the
 * source rather than rendering every dialog.
 */

const DIR = __dirname;
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));

/** Lines that are code comments — prose there may name anything. */
const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);

function offending(pattern: RegExp, allow: (line: string) => boolean = () => false) {
  const hits: string[] = [];
  for (const f of FILES) {
    readFileSync(join(DIR, f), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (!isComment(line) && pattern.test(line) && !allow(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
  }
  return hits;
}

describe('Customize copy', () => {
  it('says "Claude" only when it means a path or Anthropic\'s plugin repo', () => {
    const hits = offending(/\bClaude\b/, (l) => /\.claude|claude-plugins-official/.test(l));
    expect(hits).toEqual([]);
  });

  it('never hardcodes the product name in user-visible text', () => {
    // `AIME_MCP` is a Snowflake identifier in setup SQL, not product copy.
    const hits = offending(/\bAIME\b(?!_)/);
    expect(hits).toEqual([]);
  });

  it('has no internal leftovers', () => {
    expect(offending(/rqp|\bnib\b|Quarry|ZY31549|LY01550|Ask IT\b/)).toEqual([]);
  });
});
