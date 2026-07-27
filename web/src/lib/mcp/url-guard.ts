/**
 * Validation for user-supplied MCP server URLs (P3.6).
 *
 * Adding a remote MCP server by URL is the feature that generalises the DCR fast
 * path past the sixteen hardcoded connectors. It also means a URL from the
 * request gets fetched server-side during discovery (RFC 9728/8414) and then
 * persisted for the agent to connect to — so an unvalidated value is a
 * server-side request forgery primitive pointed at whatever the caller likes,
 * including cloud metadata endpoints.
 *
 * The policy:
 *   - https anywhere. This is the normal case for a vendor endpoint.
 *   - http ONLY to loopback. A locally-run MCP server on http://localhost:3000
 *     is a completely ordinary development setup, and plaintext to your own
 *     machine crosses no network, so forbidding it would break real use for no
 *     security gain.
 *   - Never link-local (169.254.0.0/16, fe80::/10). That is where cloud instance
 *     metadata lives — the single most valuable SSRF target.
 *   - Never plaintext http to a non-loopback private address: on http there is no
 *     certificate to prove what answered, so a LAN address is exactly the
 *     confused-deputy case.
 *   - Never embedded credentials, which would end up written to disk.
 *
 * KNOWN LIMIT, stated rather than implied: only literal IPs are inspected. A
 * hostname that resolves to a private address passes, and DNS can change between
 * this check and the fetch (rebinding). Closing that needs resolve-then-pin at
 * connect time, which belongs in the fetch layer, not here.
 *
 * Pure and synchronous — no DNS, no network.
 */

export type UrlRejection =
  | 'not-a-url'
  | 'unsupported-scheme'
  | 'insecure-scheme'
  | 'credentials-in-url'
  | 'link-local'
  | 'private-over-http';

export type UrlVerdict =
  | { ok: true; url: string; loopback: boolean }
  | { ok: false; reason: UrlRejection; message: string };

/** 127.0.0.0/8, ::1, and the names that always mean this machine. */
function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  const v4 = parseIPv4(h);
  return v4 !== null && v4[0] === 127;
}

/** 169.254.0.0/16 and fe80::/10 — cloud metadata and IPv6 link-local. */
function isLinkLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = parseIPv4(h);
  if (v4 && v4[0] === 169 && v4[1] === 254) return true;
  // fe80::/10 covers fe80 through febf
  return /^fe[89ab][0-9a-f]:/.test(h);
}

/** RFC1918 plus IPv6 unique-local (fc00::/7). Loopback is handled separately. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = parseIPv4(h);
  if (v4) {
    const [a, b] = v4;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true; // 0.0.0.0/8 — "this network"
    return false;
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  return false;
}

/** Strict dotted-quad only; rejects the octal/short forms that bypass naive checks. */
function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // A leading zero means an octal literal to some resolvers; refuse to guess.
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums as [number, number, number, number];
}

export function validateMcpServerUrl(raw: unknown): UrlVerdict {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'not-a-url', message: 'Enter the MCP server URL.' };
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not-a-url', message: 'That is not a valid URL.' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      reason: 'unsupported-scheme',
      message: `MCP servers are reached over https (got ${url.protocol.replace(':', '')}).`,
    };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'credentials-in-url',
      message: 'Remove the username and password from the URL — credentials come from signing in.',
    };
  }

  if (isLinkLocalHost(url.hostname)) {
    return {
      ok: false,
      reason: 'link-local',
      message: 'That address is link-local and cannot host an MCP server.',
    };
  }

  const loopback = isLoopbackHost(url.hostname);

  if (url.protocol === 'http:') {
    if (loopback) return { ok: true, url: url.toString(), loopback: true };
    if (isPrivateHost(url.hostname)) {
      return {
        ok: false,
        reason: 'private-over-http',
        message: 'Use https for a server on your network — plaintext http is only allowed to localhost.',
      };
    }
    return {
      ok: false,
      reason: 'insecure-scheme',
      message: 'Use https — the access token would otherwise be sent in the clear.',
    };
  }

  return { ok: true, url: url.toString(), loopback };
}
