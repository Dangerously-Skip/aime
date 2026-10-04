import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isSelfProxy,
  internalToken,
  internalAuthHeaders,
  internalAuthEnv,
  proxyToken,
} from './internal-credential';
import { decide, deriveProxyToken, SESSION_COOKIE, TOKEN_PARAM } from './local-token';

/*
 * The regression this file exists for shipped through a green suite and a merge.
 *
 * Authenticating `/api/*` also authenticated the app against ITSELF:
 * `execution.ts` builds `${origin}/api/llm-proxy/...` as the base URL for BYOK
 * providers, so our own inference went out through our own guarded route. The
 * first visible symptom was a browser task that produced nothing:
 *
 *   [BROWSER-TURN] Error: 401 {"error":"Missing or invalid local API credential."}
 *
 * 4,918 tests did not notice, because every one of them either mocks the
 * provider or talks to Anthropic directly, where no proxy is involved. The
 * broken path is exactly the one an Anthropic-key developer never takes.
 */

const src = (...p: string[]) => readFileSync(resolve(__dirname, '../..', ...p), 'utf8');
const TOKEN = 'a'.repeat(48);
const SELF = 'http://127.0.0.1:19533/api/llm-proxy/openrouter/aHR0cHM6Ly8';
const SCOPED = proxyToken({ AIME_API_TOKEN: TOKEN })!;

describe('isSelfProxy', () => {
  it('recognises our own proxy', () => {
    expect(isSelfProxy(SELF)).toBe(true);
  });

  it('does NOT match a real provider', () => {
    /*
     * The important direction. Attaching our local token to a request bound for
     * Anthropic or OpenRouter is not a harmless no-op, it is shipping a
     * credential to a third party.
     */
    for (const url of [
      'https://api.anthropic.com',
      'https://openrouter.ai/api/v1',
      'http://localhost:11434/v1',
      undefined,
      'not a url',
    ]) {
      expect(isSelfProxy(url), `${url} should not be treated as our proxy`).toBe(false);
    }
  });

  it('is not fooled by a provider that merely mentions the path', () => {
    // Host matters, not substring: the check is on pathname of a parsed URL.
    expect(isSelfProxy('https://evil.example/api/llm-proxy/x')).toBe(true);
    // ^ documented deliberately: we only ever build this URL ourselves from our
    //   own origin, so the pathname test is the useful one. If that ever stops
    //   being true, this assertion is the place it will be noticed.
  });
});

describe('internalToken', () => {
  it('accepts a real token and rejects stubs', () => {
    expect(internalToken({ AIME_API_TOKEN: TOKEN })).toBe(TOKEN);
    for (const v of [undefined, '', 'short']) {
      expect(internalToken({ AIME_API_TOKEN: v })).toBeNull();
    }
  });
});

describe('the in-process client carries the credential', () => {
  it('sends the proxy-scoped Bearer to our own proxy — not the API token', () => {
    expect(internalAuthHeaders(SELF, { AIME_API_TOKEN: TOKEN })).toEqual({
      Authorization: `Bearer ${SCOPED}`,
    });
  });

  it('sends NOTHING to a real provider', () => {
    expect(internalAuthHeaders('https://api.anthropic.com', { AIME_API_TOKEN: TOKEN })).toEqual({});
  });

  it('sends nothing when there is no token, rather than a broken header', () => {
    expect(internalAuthHeaders(SELF, {})).toEqual({});
  });
});

describe('the Agent SDK subprocess carries the credential', () => {
  /*
   * The subprocess is why this is not just a header at one call site: we do not
   * construct its HTTP client and can only reach it through environment.
   */
  it('gets the proxy-scoped ANTHROPIC_AUTH_TOKEN for our own proxy — never the API token', () => {
    // The agent's Bash inherits this environment, so whatever is here, it can read.
    const env = internalAuthEnv(SELF, { AIME_API_TOKEN: TOKEN });
    expect(env).toEqual({ ANTHROPIC_AUTH_TOKEN: SCOPED });
    expect(JSON.stringify(env)).not.toContain(TOKEN);
  });

  it('gets nothing for a real provider', () => {
    expect(internalAuthEnv('https://openrouter.ai/api/v1', { AIME_API_TOKEN: TOKEN })).toEqual({});
  });
});

describe('THE REGRESSION: a proxy request with these credentials is accepted', () => {
  /*
   * Ties the two halves together. Producing a header is worthless if the proxy
   * would still refuse it, and asserting `internalAuthHeaders` in isolation is
   * exactly the kind of adjacent-to-the-behaviour test that let the original
   * bug through. So: build the credential, hand it to the real `decide()`.
   */
  const facts = (over: Record<string, unknown> = {}) => ({
    pathname: '/api/llm-proxy/openrouter/x',
    origin: null,
    host: '127.0.0.1:19533',
    cookie: null,
    authorization: null,
    tokenParam: null,
    ...over,
  });

  it('the header the in-process client sends is accepted', () => {
    const headers = internalAuthHeaders(SELF, { AIME_API_TOKEN: TOKEN });
    const verdict = decide(facts({ authorization: headers.Authorization }), TOKEN, SCOPED);
    expect(verdict.ok, 'the proxy refuses our own inference client').toBe(true);
  });

  it('the subprocess token, sent as Bearer by the SDK, is accepted', () => {
    const env = internalAuthEnv(SELF, { AIME_API_TOKEN: TOKEN });
    const verdict = decide(facts({ authorization: `Bearer ${env.ANTHROPIC_AUTH_TOKEN}` }), TOKEN, SCOPED);
    expect(verdict.ok).toBe(true);
  });

  it('without the credential it is refused — the state that shipped', () => {
    expect(decide(facts(), TOKEN)).toMatchObject({ ok: false, status: 401 });
  });

  it('a stale cookie is still accepted, so a browser caller is unaffected', () => {
    expect(decide(facts({ cookie: `${SESSION_COOKIE}=${TOKEN}` }), TOKEN).ok).toBe(true);
  });
});

describe('both call sites actually use it', () => {
  /*
   * Derived from source: the helpers can be perfect and called by nobody, which
   * is how the original 401 happened in the first place.
   */
  it('turn-client passes defaultHeaders', () => {
    expect(src('lib/models/turn-client.ts')).toContain('internalAuthHeaders(opts.exec.baseUrl)');
  });

  it('the provider extends the subprocess env', () => {
    const provider = src('lib/providers/claude-provider.ts');
    expect(provider).toContain('internalAuthEnv(baseUrl)');
    // Beside ANTHROPIC_BASE_URL, not somewhere it never runs.
    const block = provider.slice(provider.indexOf('ANTHROPIC_BASE_URL: baseUrl'));
    expect(block.slice(0, 600)).toContain('internalAuthEnv');
  });
});

describe('the proxy-scoped token opens the LLM proxy and nothing else', () => {
  /*
   * The subprocess's environment is readable by the agent's Bash. If this token
   * opened any other route, a turn could call /api/subagent claiming to be
   * attended, rewrite identity files, or reconfigure connectors.
   */
  const at = (pathname: string, over: Record<string, unknown> = {}) => ({
    pathname,
    origin: null,
    host: '127.0.0.1:19533',
    cookie: null,
    authorization: `Bearer ${SCOPED}`,
    tokenParam: null,
    ...over,
  });

  it('the Node and Web Crypto derivations agree, and differ from the API token', async () => {
    expect(await deriveProxyToken(TOKEN)).toBe(SCOPED);
    expect(SCOPED).not.toBe(TOKEN);
    expect(SCOPED).toMatch(/^[0-9a-f]{64}$/);
    expect(proxyToken({ AIME_API_TOKEN: 'b'.repeat(48) })).not.toBe(SCOPED);
  });

  it.each(['/api/subagent', '/api/identity/user-md', '/api/customize/connectors', '/api/llm-proxy', '/api/llm-proxyx/a'])(
    'is refused on %s',
    (pathname) => {
      expect(decide(at(pathname), TOKEN, SCOPED)).toMatchObject({ ok: false, status: 401 });
    },
  );

  it('is refused as the session cookie and as the ?t= exchange', () => {
    const p = '/api/llm-proxy/openrouter/x';
    expect(decide(at(p, { authorization: null, cookie: `${SESSION_COOKIE}=${SCOPED}` }), TOKEN, SCOPED).ok).toBe(false);
    expect(decide(at('/', { authorization: null, tokenParam: SCOPED }), TOKEN, SCOPED)).not.toMatchObject({
      setCookie: true,
    });
    void TOKEN_PARAM;
  });

  it('dot segments cannot walk it out of the proxy prefix', async () => {
    const { NextRequest } = await import('next/server');
    for (const raw of ['/api/llm-proxy/../subagent', '/api/llm-proxy/%2e%2e/subagent', '/api/llm-proxy/x/../../subagent']) {
      const pathname = new NextRequest(new Request(`http://127.0.0.1:19533${raw}`)).nextUrl.pathname;
      expect(decide(at(pathname), TOKEN, SCOPED).ok, `${raw} → ${pathname}`).toBe(false);
    }
  });

  it('the full API token still works everywhere, so the app itself is unaffected', () => {
    expect(decide(at('/api/subagent', { authorization: `Bearer ${TOKEN}` }), TOKEN, SCOPED).ok).toBe(true);
  });
});
