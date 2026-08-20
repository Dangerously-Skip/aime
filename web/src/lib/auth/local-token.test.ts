import { describe, it, expect } from 'vitest';
import {
  constantTimeEqual,
  configuredToken,
  isSameOrigin,
  readCookie,
  decide,
  sessionCookie,
  SESSION_COOKIE,
} from './local-token';

const TOKEN = 'a'.repeat(64);
const facts = (over: Partial<Parameters<typeof decide>[0]> = {}) => ({
  pathname: '/api/health',
  origin: null,
  host: 'localhost:19533',
  cookie: null,
  authorization: null,
  tokenParam: null,
  ...over,
});

describe('constantTimeEqual', () => {
  it('accepts equal strings and rejects different ones', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
  });

  it('rejects on length without an early return', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'a')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('does not short-circuit on the first differing character', () => {
    /*
     * Behavioural proxy for constant time: a mismatch at position 0 and a
     * mismatch at the last position must both be examined. We cannot assert
     * timing reliably in a test runner, so assert the property that makes the
     * timing constant — every character is read.
     */
    const reads: number[] = [];
    const probe = {
      length: TOKEN.length,
      charCodeAt(i: number) {
        reads.push(i);
        return 'b'.charCodeAt(0);
      },
    } as unknown as string;
    constantTimeEqual(probe, TOKEN);
    expect(reads.length).toBe(TOKEN.length);
  });
});

describe('configuredToken', () => {
  it('reads AIME_API_TOKEN', () => {
    expect(configuredToken({ AIME_API_TOKEN: TOKEN })).toBe(TOKEN);
  });

  it('treats absent, empty and short values as unconfigured', () => {
    // A three-character token is worse than none: it looks configured.
    for (const v of [undefined, '', 'abc', 'x'.repeat(15)]) {
      expect(configuredToken({ AIME_API_TOKEN: v })).toBeNull();
    }
  });
});

describe('isSameOrigin', () => {
  it('allows an absent Origin', () => {
    // curl, the companion app and same-origin GETs all omit it — they still
    // need a credential, which is the check that follows.
    expect(isSameOrigin(null, 'localhost:19533')).toBe(true);
  });

  it('allows our own origin', () => {
    expect(isSameOrigin('http://localhost:19533', 'localhost:19533')).toBe(true);
  });

  it('REFUSES another site', () => {
    expect(isSameOrigin('https://evil.example', 'localhost:19533')).toBe(false);
  });

  it('refuses the same hostname on another port', () => {
    // Another local app is not us.
    expect(isSameOrigin('http://localhost:3000', 'localhost:19533')).toBe(false);
  });

  it('refuses a garbage Origin rather than parsing around it', () => {
    expect(isSameOrigin('not a url', 'localhost:19533')).toBe(false);
  });
});

describe('readCookie', () => {
  it('finds a cookie among several', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=xyz; b=2`, SESSION_COOKIE)).toBe('xyz');
  });

  it('does not match a cookie whose name merely ends with ours', () => {
    expect(readCookie(`not_${SESSION_COOKIE}=xyz`, SESSION_COOKIE)).toBeNull();
  });

  it('returns null for absent header or absent cookie', () => {
    expect(readCookie(null, SESSION_COOKIE)).toBeNull();
    expect(readCookie('a=1', SESSION_COOKIE)).toBeNull();
  });
});

describe('decide — the gate', () => {
  it('FAILS CLOSED when no token is configured', () => {
    /*
     * The rule that matters most. An unconfigured server refuses everything
     * rather than allowing everything. A dev bypass here is the same shape as
     * the four security toggles that shipped doing nothing, except it would be
     * the one that survives into a build on a shared machine.
     */
    const v = decide(facts(), null);
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({ status: 503 });
  });

  it('refuses an unauthenticated request', () => {
    expect(decide(facts(), TOKEN)).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses a wrong cookie and a wrong bearer', () => {
    const bad = 'b'.repeat(64);
    expect(decide(facts({ cookie: `${SESSION_COOKIE}=${bad}` }), TOKEN)).toMatchObject({ status: 401 });
    expect(decide(facts({ authorization: `Bearer ${bad}` }), TOKEN)).toMatchObject({ status: 401 });
  });

  it('accepts a valid session cookie', () => {
    expect(decide(facts({ cookie: `${SESSION_COOKIE}=${TOKEN}` }), TOKEN)).toEqual({
      ok: true,
      setCookie: false,
    });
  });

  it('accepts a valid bearer token, for non-browser clients', () => {
    expect(decide(facts({ authorization: `Bearer ${TOKEN}` }), TOKEN)).toEqual({
      ok: true,
      setCookie: false,
    });
  });

  it('exchanges a valid ?t= for a session', () => {
    expect(decide(facts({ pathname: '/', tokenParam: TOKEN }), TOKEN)).toEqual({
      ok: true,
      setCookie: true,
      token: TOKEN,
    });
  });

  it('does not exchange an invalid ?t=', () => {
    expect(decide(facts({ pathname: '/', tokenParam: 'nope' }), TOKEN)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('refuses a foreign origin BEFORE considering the credential', () => {
    /*
     * The attack this file exists for: a page on another site fetching our port.
     * It is refused even holding a valid token, because if a foreign page has
     * the token we have already lost and should not also hand it a 200.
     */
    const v = decide(
      facts({ origin: 'https://evil.example', cookie: `${SESSION_COOKIE}=${TOKEN}` }),
      TOKEN,
    );
    expect(v).toMatchObject({ ok: false, status: 403 });
  });

  it('the 503 is distinguishable from the 401', () => {
    // Different causes, different fixes: one is our misconfiguration, the other
    // is a caller without a credential.
    expect(decide(facts(), null)).toMatchObject({ status: 503 });
    expect(decide(facts(), TOKEN)).toMatchObject({ status: 401 });
  });
});

describe('sessionCookie', () => {
  it('is HttpOnly and SameSite=Strict', () => {
    const c = sessionCookie(TOKEN);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Path=/');
  });

  it('is NOT Secure, deliberately', () => {
    // The app is served over plain http on loopback. A Secure cookie would
    // never be stored, and the app would loop trying to authenticate.
    expect(sessionCookie(TOKEN)).not.toContain('Secure');
  });
});
