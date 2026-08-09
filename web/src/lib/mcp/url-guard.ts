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
import { CONNECTOR_REGISTRY } from '@/lib/connectors/registry';
import { MCP_CATALOG } from '@/lib/mcp/catalog';

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

/**
 * May the agent fetch this URL?
 *
 * Deliberately stricter than `validateMcpServerUrl`, and here rather than in a
 * file of its own so that "what counts as a private host" has exactly one
 * definition. An MCP server on `localhost` is a supported setup — that is how a
 * locally-run server is reached — but a URL the MODEL chose is a different trust
 * class entirely. It can come from a search result, a page it just read, or its
 * own guess, so loopback and link-local are SSRF targets rather than features:
 * `169.254.169.254` is cloud metadata, and `127.0.0.1` is this app's own API.
 *
 * http is allowed because much of the web still redirects through it; the
 * private-range checks are what carry the security, not the scheme.
 */
export function validateFetchUrl(raw: unknown): UrlVerdict {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'not-a-url', message: 'No URL given.' };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'not-a-url', message: `Not a valid URL: ${String(raw).slice(0, 120)}` };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      reason: 'unsupported-scheme',
      message: `Only http and https can be fetched (got ${url.protocol.replace(':', '')}).`,
    };
  }
  if (url.username || url.password) {
    return {
      ok: false,
      reason: 'credentials-in-url',
      message: 'Refusing to fetch a URL with credentials embedded in it.',
    };
  }
  if (isLoopbackHost(url.hostname) || isLinkLocalHost(url.hostname) || isPrivateHost(url.hostname)) {
    return {
      ok: false,
      reason: isLinkLocalHost(url.hostname) ? 'link-local' : 'private-over-http',
      message: `Refusing to fetch ${url.hostname} — it is a private or local address, not a public web page.`,
    };
  }
  return { ok: true, url: url.toString(), loopback: false };
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

/* ────────────────────────────────────────────────────────────────────────────
 * Server identity.
 *
 * A server name is not decoration. It becomes the provisioned config key
 * `aime-mcp-<name>`, and consumers map that key BACK to a built-in connector id:
 * the chat route tells the agent "GitHub is already connected — use its tools
 * directly", and the Connectors page turns the real GitHub row green. So the
 * name is an identity claim, and "first hostname label that isn't mcp/api/www"
 * let any host forge one — `https://mcp.github.evil.com/mcp` derived `github`.
 *
 * The only thing we actually know about a pasted URL is its origin, so identity
 * is decided on the origin: a built-in id may be used only for a URL on an
 * origin that built-in publishes. Everything else is named after its host.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Longest name we will produce; sanitizePluginName caps at 64. */
const MAX_NAME_LEN = 40;

const SLUGGABLE = (s: string) =>
  s.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '');

/**
 * scheme://authority of a URL declared in the registry or catalogue.
 *
 * Declared URLs may carry `{placeholder}` segments substituted at connect time.
 * Today every one of those sits in the path (`…/tenants/{tenant_id}/…`), so the
 * origin is literal — but a placeholder in the host is a documented pattern in
 * this codebase (Snowflake's `{account}`), so one is matched as a single label
 * rather than making the connector unprovable.
 */
function declaredOrigin(raw: string): { literal: string } | { pattern: RegExp } | null {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]+)/.exec(raw.trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const authority = m[2].toLowerCase();
  if (!authority.includes('{')) {
    try {
      return { literal: new URL(`${scheme}://${authority}`).origin.toLowerCase() };
    } catch {
      return null;
    }
  }
  const body = authority
    .split(/\{[^}]*\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^./]+');
  return { pattern: new RegExp(`^${scheme}://${body}$`) };
}

type OriginMatcher = { literal: string } | { pattern: RegExp };

let ORIGIN_INDEX: Map<string, OriginMatcher[]> | null = null;

/** id → the origins that id is allowed to speak for. Built once. */
function originIndex(): Map<string, OriginMatcher[]> {
  if (ORIGIN_INDEX) return ORIGIN_INDEX;
  const index = new Map<string, OriginMatcher[]>();
  const add = (id: string, url?: string) => {
    const list = index.get(id) ?? [];
    index.set(id, list);
    if (!url) return;
    const origin = declaredOrigin(url);
    if (origin) list.push(origin);
  };
  for (const c of CONNECTOR_REGISTRY) {
    // Every id is registered even with no URL: a connector with no remote MCP
    // endpoint (stdio, paste-token) still owns its name, it just can never be
    // proven by origin — which is the correct, fail-closed answer.
    add(c.id, c.auth.mcpUrl);
    add(c.id, c.mcp.url);
  }
  for (const s of MCP_CATALOG) add(s.id, s.url);
  ORIGIN_INDEX = index;
  return index;
}

/** True when `name` is the id of a connector or catalogue entry AIME ships. */
export function isBuiltInServerId(name: string | null | undefined): boolean {
  return typeof name === 'string' && originIndex().has(name.toLowerCase());
}

/**
 * True when `url` sits on an origin the built-in `name` publishes — the only
 * evidence available locally that a server really is who its name says.
 *
 * Origin only: the path, query and transport suffix vary between a vendor's
 * discovery URL and its JSON-RPC URL (Miro serves them on `/mcp` and `/`), and
 * none of that changes who answered.
 */
export function builtInIdOwnsUrl(name: string, url: string | null | undefined): boolean {
  const declared = originIndex().get(name.toLowerCase());
  if (!declared || declared.length === 0 || !url) return false;
  let origin: string;
  try {
    origin = new URL(url.trim()).origin.toLowerCase();
  } catch {
    return false;
  }
  return declared.some((d) => ('literal' in d ? d.literal === origin : d.pattern.test(origin)));
}

/**
 * The whole host (plus a non-default port) as a name: `mcp.github.evil.com` →
 * `mcp-github-evil-com`.
 *
 * Dots become dashes because the name is embedded in MCP tool identifiers, which
 * are far stricter than a filename. Two URLs share this name only when they
 * share an origin, which is what makes it a safe disambiguator.
 */
export function hostSlugName(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const withPort = url.port ? `${host}-${url.port}` : host;
  const slug = SLUGGABLE(withPort.replace(/\./g, '-'));
  return slug.length > 0 ? slug.slice(0, MAX_NAME_LEN) : null;
}

/**
 * A short, stable, filesystem-safe name for a server the user added by URL.
 *
 * The name becomes a directory lookup, a clients-file key and the provisioned
 * MCP entry key, so it must satisfy the same allowlist the install route uses.
 * Derived from the host so it is recognisable — but never in a form that claims
 * a built-in connector the origin does not back up.
 */
export function deriveServerName(rawUrl: string): string | null {
  let host: string;
  try {
    host = new URL(rawUrl.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  // First label that isn't a service prefix: mcp.atlassian.com → atlassian,
  // mcp.acme.co.uk → acme. Deliberately NOT the registrable domain — picking
  // that correctly needs the Public Suffix List, and "second-to-last label"
  // yields `co` for a .co.uk host.
  const labels = host.replace(/^\[|\]$/g, '').split('.').filter(Boolean);
  const meaningful = labels.filter((l) => !['mcp', 'api', 'www'].includes(l));
  const candidate = meaningful[0] ?? labels[0];
  if (!candidate) return null;

  const slug = SLUGGABLE(candidate).slice(0, MAX_NAME_LEN);
  if (slug.length === 0) return null;

  // The short label happens to name something we ship. Allowed only if this URL
  // is on that service's own origin; otherwise fall back to the full host, which
  // is honest about what the user is actually connecting to.
  if (isBuiltInServerId(slug) && !builtInIdOwnsUrl(slug, rawUrl)) {
    const fromHost = hostSlugName(rawUrl);
    // A host slug that ALSO collides has nothing left to fall back to, so refuse
    // rather than hand out a borrowed identity.
    if (!fromHost || isBuiltInServerId(fromHost)) return null;
    return fromHost;
  }
  return slug;
}

/**
 * The phrase both API routes use when a name is held by a different origin.
 *
 * The setup route's refusal reaches the UI as a plain Error message (that is all
 * `runMcpOAuthFlow` preserves), so the recogniser lives here rather than being
 * re-typed on each side.
 */
export const NAME_TAKEN_PHRASE = 'already connected to a different server';

/** Is this failure the "that name belongs to another origin" refusal? */
export function isNameTakenError(message: string): boolean {
  return message.includes(NAME_TAKEN_PHRASE);
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
