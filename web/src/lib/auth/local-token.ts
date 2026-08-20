/**
 * Authentication for the local API routes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every route under `/api` was unauthenticated. The only thing making that
 * survivable is that `main-web.js` binds the server to 127.0.0.1 — and "bound to
 * loopback" is not the same as "safe". Any page in any browser on this machine
 * can `fetch('http://localhost:<port>/api/...')`. Loopback stops the internet
 * reaching the API; it does nothing about the tab you have open on another site.
 *
 * It is also the named blocker for everything else: hosted features, the
 * headless/Tailscale recipe, and any future companion app all need the local
 * API to be able to say no to someone.
 *
 * WHY A COOKIE AND NOT A HEADER
 * -----------------------------
 * There are 95 `fetch('/api/...')` call sites across 54 files and no wrapper. A
 * scheme requiring each of them to attach a header would be wrong at 95 places
 * on day one and wrong again at every call site added afterwards — the enforcing
 * mechanism cannot be "everybody remembers". A session cookie is attached by the
 * browser to same-origin requests automatically, so the call sites need no
 * changes and a NEW one is covered without anyone knowing this file exists.
 *
 * WHY THE TOKEN COMES FROM THE ENVIRONMENT
 * ----------------------------------------
 * Next middleware runs on the Edge runtime: no `fs`, no `node:crypto`. Reading a
 * token file is not available to us, so `AIME_API_TOKEN` is the single source,
 * injected the same way `AIME_CRED_KEY` already is — minted by `main-web.js` for
 * the packaged app, by `dev-with-port.js` for development.
 *
 * FAIL CLOSED
 * -----------
 * No token configured means every API request is refused, not allowed. A
 * development bypass is exactly the shape of the four security toggles that
 * shipped doing nothing, and it would be the one thing that survives into a
 * build someone runs on a shared machine.
 */

/** Cookie holding the exchanged session. Name is deliberately unglamorous. */
export const SESSION_COOKIE = 'aime_local_session';

/** Query parameter that exchanges a token for the session cookie, once. */
export const TOKEN_PARAM = 't';

export type AuthDecision =
  | { ok: true; setCookie: false }
  /** A valid `?t=` — mint the cookie and redirect to strip the parameter. */
  | { ok: true; setCookie: true; token: string }
  | { ok: false; status: 401 | 403 | 503; reason: string };

/**
 * Compare in constant time.
 *
 * `node:crypto.timingSafeEqual` is unavailable on the Edge runtime, so this is
 * hand-rolled. Length is compared without an early return for the same reason
 * the bytes are: `a.length !== b.length` leaking is a smaller leak than the
 * content, but it is still one, and the loop costs nothing.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** The configured token, or null when the server was started without one. */
export function configuredToken(env: Record<string, string | undefined>): string | null {
  const t = env.AIME_API_TOKEN;
  return typeof t === 'string' && t.length >= 16 ? t : null;
}

/**
 * Is this request's Origin one of ours?
 *
 * A cross-origin `fetch` from a page on another site is the attack this whole
 * file exists to stop. `SameSite=Strict` on the cookie already prevents the
 * browser attaching it, and this is the second lock: a request that announces a
 * foreign origin is refused whatever it carries.
 *
 * Absent Origin is allowed — same-origin GETs and non-browser clients (curl, the
 * companion app) legitimately omit it, and they still need a valid credential.
 */
export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return true;
  if (!host) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  return parsed.host === host;
}

interface RequestFacts {
  pathname: string;
  origin: string | null;
  host: string | null;
  cookie: string | null;
  authorization: string | null;
  tokenParam: string | null;
}

/** Read one cookie out of a Cookie header without pulling in a parser. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * The whole decision, as a pure function, so it can be tested without a server.
 *
 * Order matters and is deliberate:
 *   1. no token configured  -> 503, because this is our misconfiguration
 *   2. foreign origin       -> 403, before any credential is even considered
 *   3. valid `?t=`          -> mint the session
 *   4. cookie or bearer     -> allow
 *   5. otherwise            -> 401
 */
export function decide(facts: RequestFacts, token: string | null): AuthDecision {
  if (!token) {
    return {
      ok: false,
      status: 503,
      reason:
        'The API has no AIME_API_TOKEN configured, so it cannot authenticate anything and refuses everything. ' +
        'Launch via `npm run electron:dev` or set AIME_API_TOKEN.',
    };
  }

  if (!isSameOrigin(facts.origin, facts.host)) {
    return { ok: false, status: 403, reason: 'Cross-origin requests are refused.' };
  }

  if (facts.tokenParam && constantTimeEqual(facts.tokenParam, token)) {
    return { ok: true, setCookie: true, token };
  }

  const cookie = readCookie(facts.cookie, SESSION_COOKIE);
  if (cookie && constantTimeEqual(cookie, token)) return { ok: true, setCookie: false };

  const bearer = facts.authorization?.startsWith('Bearer ')
    ? facts.authorization.slice('Bearer '.length)
    : null;
  if (bearer && constantTimeEqual(bearer, token)) return { ok: true, setCookie: false };

  return { ok: false, status: 401, reason: 'Missing or invalid local API credential.' };
}

/**
 * Cookie attributes.
 *
 * `Secure` is deliberately absent: the app is served over plain http on
 * loopback, and a Secure cookie would simply never be stored. `SameSite=Strict`
 * is the meaningful one here — it is what stops another site's page having the
 * cookie attached to a request it makes to our port.
 */
export function sessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=86400',
  ].join('; ');
}
