/**
 * Splitting provisioned MCP entries into public structure and secrets (DR-14).
 *
 * `.aime-mcp.json` has held live access tokens, refresh tokens and OAuth client
 * secrets in cleartext at 0600. The SDK never reads that file — the loader hands
 * it an in-memory object — so plaintext was a choice rather than a constraint.
 *
 * What encryption at rest actually buys, stated plainly: protection when the
 * file leaves the machine or outlives the process. Backups, home-directory
 * cloud sync, a resold disk, a config pasted into a bug report. It does NOT
 * defend against a process running as the same user, because the master key is
 * injected into the server's environment. Three of the four secret kinds are
 * durable though — an API key or refresh token from a year-old backup still
 * works — so the vector is worth closing.
 *
 * The public entry keeps its full shape with a visible sentinel in place of each
 * secret, rather than dropping fields. That way the file still documents which
 * env var and which header the server uses, and a human reading it can see at a
 * glance that the value is held elsewhere instead of wondering if it is missing.
 *
 * Pure: no fs, no crypto. The caller owns storage.
 */

/** Obvious on sight, and not a plausible token. */
export const SECRET_PLACEHOLDER = '${AIME_SECRET}';

/**
 * Per-entry secrets, keyed by where they came from.
 *
 * `env` and `headers` are maps rather than a single token because an entry can
 * legitimately carry more than one credential — the refresh work in P3.1c ran
 * into exactly that case. A single "the token" field silently left every
 * additional value in cleartext on disk, which a property test caught.
 */
export interface EntrySecrets {
  /** env var name → value. */
  env?: Record<string, string>;
  /** header name → the credential part, with any scheme prefix stripped. */
  headers?: Record<string, string>;
  refreshToken?: string;
  clientSecret?: string;
}

type Entry = Record<string, unknown>;

/** Which `_meta` fields are secret. Everything else there is public by design. */
const SECRET_META_FIELDS = ['refreshToken', 'clientSecret'] as const;

function isPlaceholder(value: unknown): boolean {
  return value === SECRET_PLACEHOLDER;
}

/**
 * Split an entry. Returns the entry as it should be written to disk plus the
 * secrets to store separately.
 *
 * Values already replaced by a placeholder are left alone and contribute no
 * secret, so this is idempotent — running it over an already-split entry does
 * not blank the stored credential.
 */
export function extractSecrets(entry: Entry): { entry: Entry; secrets: EntrySecrets } {
  const out: Entry = { ...entry };
  const secrets: EntrySecrets = {};

  // stdio: every env value is a credential; the NAMES stay public.
  if (out.env && typeof out.env === 'object' && !Array.isArray(out.env)) {
    const env = { ...(out.env as Record<string, unknown>) };
    for (const [name, value] of Object.entries(env)) {
      if (typeof value !== 'string' || value === '' || isPlaceholder(value)) continue;
      (secrets.env ??= {})[name] = value;
      env[name] = SECRET_PLACEHOLDER;
    }
    out.env = env;
  }

  // http/sse: the credential sits inside a header, after any scheme prefix.
  if (out.headers && typeof out.headers === 'object' && !Array.isArray(out.headers)) {
    const headers = { ...(out.headers as Record<string, unknown>) };
    for (const [name, value] of Object.entries(headers)) {
      if (typeof value !== 'string' || value === '') continue;
      // [\s\S]* rather than .* with the `s` flag — the tsconfig target predates it.
      const match = /^(Bearer\s+|Token\s+)?([\s\S]*)$/.exec(value);
      const prefix = match?.[1] ?? '';
      const credential = match?.[2] ?? '';
      if (credential === '' || isPlaceholder(credential)) continue;
      (secrets.headers ??= {})[name] = credential;
      // Keep the prefix — it is part of the protocol, not the secret.
      headers[name] = `${prefix}${SECRET_PLACEHOLDER}`;
    }
    out.headers = headers;
  }

  if (out._meta && typeof out._meta === 'object' && !Array.isArray(out._meta)) {
    const meta = { ...(out._meta as Record<string, unknown>) };
    for (const field of SECRET_META_FIELDS) {
      const value = meta[field];
      if (typeof value !== 'string' || value === '' || isPlaceholder(value)) continue;
      secrets[field] = value;
      // Dropped rather than placeholdered: unlike env/header names, the presence
      // of a refresh token is not structure the file needs to document, and
      // omitting it keeps refresh logic from mistaking a sentinel for a token.
      delete meta[field];
    }
    out._meta = meta;
  }

  return { entry: out, secrets };
}

/**
 * Put the secrets back, producing the entry the SDK should receive.
 *
 * A missing secret leaves the placeholder in place rather than substituting an
 * empty string: an empty credential would be sent to the service and rejected
 * with a confusing 401, whereas the sentinel makes the cause obvious in a log.
 */
export function injectSecrets(entry: Entry, secrets: EntrySecrets | undefined): Entry {
  if (!secrets || isEmptySecrets(secrets)) return entry;
  const out: Entry = { ...entry };

  // Restored by NAME, so an entry with several credentials gets each one back in
  // the right place rather than the same value everywhere.
  if (secrets.env && out.env && typeof out.env === 'object' && !Array.isArray(out.env)) {
    const env = { ...(out.env as Record<string, unknown>) };
    for (const [name, value] of Object.entries(env)) {
      const stored = secrets.env[name];
      if (isPlaceholder(value) && stored !== undefined) env[name] = stored;
    }
    out.env = env;
  }

  if (secrets.headers && out.headers && typeof out.headers === 'object' && !Array.isArray(out.headers)) {
    const headers = { ...(out.headers as Record<string, unknown>) };
    for (const [name, value] of Object.entries(headers)) {
      const stored = secrets.headers[name];
      if (typeof value === 'string' && value.includes(SECRET_PLACEHOLDER) && stored !== undefined) {
        // A REPLACER FUNCTION, not a string: String.replace interprets `$$`,
        // `$&` and `` $` `` in a replacement string, so a token containing a
        // dollar sign would be silently corrupted on the way to the service.
        // Found by the round-trip property test with `Bearer $$`.
        headers[name] = value.replace(SECRET_PLACEHOLDER, () => stored);
      }
    }
    out.headers = headers;
  }

  // Refresh metadata is restored so refreshTokenIfNeeded sees what it expects.
  if (secrets.refreshToken !== undefined || secrets.clientSecret !== undefined) {
    const meta = { ...((out._meta as Record<string, unknown>) ?? {}) };
    if (secrets.refreshToken !== undefined) meta.refreshToken = secrets.refreshToken;
    if (secrets.clientSecret !== undefined) meta.clientSecret = secrets.clientSecret;
    out._meta = meta;
  }

  return out;
}

/**
 * Does this entry still carry a secret inline? Used to decide whether an
 * existing config needs migrating.
 */
export function hasInlineSecrets(entry: Entry): boolean {
  return !isEmptySecrets(extractSecrets(entry).secrets);
}

/** True when there is nothing to store — avoids writing empty records. */
export function isEmptySecrets(secrets: EntrySecrets): boolean {
  return Object.keys(secrets.env ?? {}).length === 0
    && Object.keys(secrets.headers ?? {}).length === 0
    && secrets.refreshToken === undefined
    && secrets.clientSecret === undefined;
}

/** The credential-store key for a provisioned server. */
export function secretKeyForServer(serverKey: string): string {
  return `mcp:${serverKey}`;
}
