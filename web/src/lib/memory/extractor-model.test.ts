import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Memory extraction was dead for anyone not on Anthropic.
 *
 * It hardcoded `claude-haiku-4-5-20251001` and built a bare Anthropic client.
 * `ANTHROPIC_BASE_URL` points at this app's llm-proxy, so that id travelled to
 * whatever provider the user actually configured and came straight back:
 *
 *   [llm-proxy] upstream 400: "claude-haiku-4-5-20251001 is not a valid model ID"
 *
 * On every turn. Silently — extraction returns [] on error, so the only trace
 * was a 400 in a log nobody reads, and the feature simply never worked for an
 * OpenRouter user.
 *
 * `CLAUDE.md` already describes this exact failure for SURFACES: code that skips
 * the model chokepoint resolves against the built-in Anthropic registry and then
 * demands an Anthropic account. This was the same bug in a library nobody had
 * thought of as a model caller.
 */

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');

describe('extraction uses the model the user actually has', () => {
  it('takes the model from the caller', () => {
    const src = read('src/lib/memory/extractor.ts');
    expect(src, 'the model is still fixed at module scope').toMatch(
      /model\?:\s*string \| null/,
    );
    expect(src).toMatch(/model:\s*model \|\| FALLBACK_MODEL/);
  });

  it('the chat route passes the model the turn ran on', () => {
    const route = read('src/app/api/chat/[surfaceId]/route.ts');
    const call = /extractMemories\([\s\S]{0,500}?\);/.exec(route)?.[0] ?? '';
    expect(call, 'extractMemories is called without a model').toMatch(/effectiveModel/);
  });

  /**
   * The fallback stays, for a first-party user with nothing configured — but it
   * must not be the only path, which is what made it wrong.
   */
  it('still has a fallback for the Anthropic case', () => {
    expect(read('src/lib/memory/extractor.ts')).toMatch(/FALLBACK_MODEL/);
  });
});

/**
 * The wider shape: any module that names a model without resolving it will do
 * this again. These are the ones that exist today; each is either routed or
 * deliberately first-party-only.
 */
describe('no library hardcodes a model as its only option', () => {
  it('extractor no longer does', () => {
    const src = read('src/lib/memory/extractor.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    const uses = [...src.matchAll(/model:\s*'[^']+'/g)].map((m) => m[0]);
    expect(uses, 'a literal model id is passed to the API').toEqual([]);
  });
});
