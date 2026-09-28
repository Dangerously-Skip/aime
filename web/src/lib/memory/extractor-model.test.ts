import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
 * was a 400 in a log nobody reads.
 *
 * WHY THIS FILE WAS REWRITTEN. The previous version asserted things like
 * `expect(src).toMatch(/model:\s*model \|\| FALLBACK_MODEL/)` and, explicitly,
 * `it('still has a fallback for the Anthropic case')`. Every assertion was a
 * string search over the source, and one of them PINNED THE BUG IN PLACE: the
 * hardcoded id stayed reachable and stayed the default, so the fix amounted to
 * a diagnosis in a comment plus an env var nobody sets.
 *
 * These drive the real function against a mocked SDK and assert which model
 * actually went out — or that no request was made at all.
 */

const create = vi.fn();
const construct = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor(opts: unknown) {
      construct(opts);
    }
    messages = { create };
  },
}));

// Long enough to clear the `< 50` triviality guard.
const RESPONSE = 'x'.repeat(80);
const ok = (body: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(body) }] });

/** The `model` field of the request that was actually issued. */
const sentModel = () => create.mock.calls[0]?.[0]?.model;

let extractMemories: typeof import('./extractor').extractMemories;

beforeEach(async () => {
  vi.resetModules();
  create.mockReset();
  construct.mockReset();
  create.mockResolvedValue(ok([]));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  delete process.env.MEMORY_EXTRACTION_MODEL;
  ({ extractMemories } = await import('./extractor'));
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MEMORY_EXTRACTION_MODEL;
});

describe('the model comes from the caller', () => {
  it('uses exactly the model it was given', async () => {
    await extractMemories('hi', RESPONSE, 'key', 'deepseek/deepseek-v4-pro');
    expect(sentModel()).toBe('deepseek/deepseek-v4-pro');
  });

  it('does not rewrite or normalise it', async () => {
    // Whatever the turn ran on is, by construction, a model this user's
    // provider accepts. Anything we do to it can only make that less true.
    await extractMemories('hi', RESPONSE, 'key', 'anthropic/claude-sonnet-4.6');
    expect(sentModel()).toBe('anthropic/claude-sonnet-4.6');
  });
});

describe('with no model resolved, it skips rather than guessing', () => {
  it('makes NO request at all', async () => {
    /*
     * The load-bearing test. A guess here is a 400 against the user's real
     * provider once per turn, invisibly, which is precisely the bug — and the
     * old suite asserted the guess should stay.
     */
    const out = await extractMemories('hi', RESPONSE, 'key', null);
    expect(create).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it('skips when the argument is omitted entirely', async () => {
    await extractMemories('hi', RESPONSE, 'key');
    expect(create).not.toHaveBeenCalled();
  });

  it('says so, rather than failing silently', async () => {
    // Returning [] is indistinguishable from "nothing worth remembering". The
    // original bug survived because nothing ever said which had happened.
    await extractMemories('hi', RESPONSE, 'key', null);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Skipped extraction'));
  });

  it('falls back to MEMORY_EXTRACTION_MODEL when an operator set one', async () => {
    // A deliberate configuration value is not a hardcoded vendor id.
    process.env.MEMORY_EXTRACTION_MODEL = 'openai/gpt-5-mini';
    vi.resetModules();
    ({ extractMemories } = await import('./extractor'));
    await extractMemories('hi', RESPONSE, 'key', null);
    expect(sentModel()).toBe('openai/gpt-5-mini');
  });

  it('the caller still wins over the operator default', async () => {
    process.env.MEMORY_EXTRACTION_MODEL = 'openai/gpt-5-mini';
    vi.resetModules();
    ({ extractMemories } = await import('./extractor'));
    await extractMemories('hi', RESPONSE, 'key', 'deepseek/deepseek-v4-pro');
    expect(sentModel()).toBe('deepseek/deepseek-v4-pro');
  });
});

describe('no Anthropic model id survives anywhere in the module', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');

  it('names no vendor model outside comments', () => {
    // Belt and braces on top of the behavioural tests: the string cannot come
    // back as a default in some new branch without failing here.
    const src = read('src/lib/memory/extractor.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/claude-[a-z0-9-]+/);
    expect([...src.matchAll(/model:\s*'[^']+'/g)].map((m) => m[0])).toEqual([]);
  });

  // Which model the chat route passes is asserted behaviourally in its own
  // suite (route.test.ts → "memory extraction") and in extraction-model.test.ts.
});

describe('where the call goes', () => {
  it('uses the turn’s provider endpoint when there is one', async () => {
    await extractMemories('hi', RESPONSE, 'key', 'm', { baseUrl: 'https://openrouter.ai/api' });
    expect(construct).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://openrouter.ai/api' }));
  });

  it('does not retry and honours the caller’s cancellation', async () => {
    const signal = AbortSignal.timeout(20_000);
    await extractMemories('hi', RESPONSE, 'key', 'm', { signal });
    expect(construct).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }));
    expect(create.mock.calls[0][1]).toEqual({ signal });
  });

  it('comes back empty rather than throwing when it is cancelled', async () => {
    create.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(extractMemories('hi', RESPONSE, 'key', 'm', { signal: AbortSignal.abort() })).resolves.toEqual([]);
  });
});
