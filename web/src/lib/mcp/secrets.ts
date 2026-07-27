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
 * `args` is the third place a credential could sit, and it is REFUSED rather than
 * split — see `credentialBearingArgs` at the bottom for why encrypting an argv
 * secret would be theatre.
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

  // DELIBERATELY NOT restoring _meta.refreshToken / _meta.clientSecret.
  //
  // The SDK serialises the whole mcpServers object into the `claude` CLI argv
  // (`--mcp-config <json>`), so anything left here is visible in `ps auxww` and
  // /proc/<pid>/cmdline. readMcpConfigFile strips _meta for exactly that reason,
  // and an earlier version of this function put the LONG-LIVED refresh token and
  // client secret straight back — making process-listing exposure worse than
  // before the commit whose purpose was removing plaintext secrets.
  //
  // Nothing needs them here: refreshTokenIfNeeded reads the store directly. Only
  // the credential the server must actually present (env / header) is restored.

  return out;
}

/**
 * Is a credential still MISSING from this entry — i.e. does the sentinel survive
 * where a secret should be?
 *
 * True means `injectSecrets` had nothing to put back: the store is keyless,
 * unreadable, or simply has no record for this server. Such an entry must not be
 * handed to the SDK, because the sentinel would be transmitted to the third party
 * as the bearer token. (The previous predicate here, `hasInlineSecrets`, answered
 * the opposite question, had no production caller, and its docstring claimed a
 * role in migration that `extractSecrets` + `isEmptySecrets` actually fill.)
 *
 * Only env and headers are checked: those are the values that go over the wire.
 * `_meta` secrets are dropped rather than placeholdered, and never reach the SDK.
 */
export function hasUnresolvedSecrets(entry: Entry): boolean {
  const carriesPlaceholder = (bag: unknown): boolean =>
    !!bag &&
    typeof bag === 'object' &&
    !Array.isArray(bag) &&
    Object.values(bag as Record<string, unknown>).some(
      (value) => typeof value === 'string' && value.includes(SECRET_PLACEHOLDER),
    );
  return carriesPlaceholder(entry.env) || carriesPlaceholder(entry.headers);
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

// ── argv: refused, not encrypted ──────────────────────────────────────────────

/**
 * Would writing this entry put a credential into a command line?
 *
 * `env` and `headers` are SPLIT above. `args` is REFUSED instead, and the
 * asymmetry is deliberate:
 *
 *  1. There is nothing to split by. `env` and `headers` are name→value maps, so a
 *     secret can be lifted out and a sentinel left in the same slot with the name
 *     still documenting the structure. `args` is a positional array of flags,
 *     package specs and paths with no names, and `tokenInjection` has no `argv`
 *     method to say which element is the credential. Placeholdering elements by
 *     guess would corrupt argv the SDK then executes.
 *
 *  2. Encrypting it at rest would buy nothing anyway. `injectSecrets` would have to
 *     put the value back before the entry reaches the SDK, and the SDK serialises
 *     the whole `mcpServers` object into the `claude` CLI argv (`--mcp-config
 *     <json>`) — so it lands in `ps auxww` and /proc/<pid>/cmdline regardless, and
 *     again in the argv of the stdio server itself. That is exactly the exposure
 *     `injectSecrets` refuses to reintroduce for `_meta.refreshToken`. Building the
 *     machinery would hand the next registry author a credential-in-argv path that
 *     LOOKS protected.
 *
 * So the honest move is to fail closed at the write, at the moment a registry
 * entry starts carrying a token in argv — when it is still cheap to move it to
 * `env`, which is split, refreshable and not world-readable.
 *
 * Returns the offending positions with a reason, NEVER the value. Empty = safe.
 */
export interface ArgvCredentialFinding {
  index: number;
  reason: string;
}

/**
 * Flag names whose inline value is a credential. Matched on the whole flag name,
 * so `--client-id` and `--token-file` (a PATH to a credential, not the credential)
 * are untouched — see EXEMPT_SUFFIXES.
 */
const CREDENTIAL_FLAGS =
  /^--?(?:api[-_]?key|access[-_]?token|auth[-_]?token|refresh[-_]?token|client[-_]?secret|bearer|credential|pass(?:word)?|pat|secret|token)$/i;

/**
 * A flag ending in one of these names a LOCATION or an IDENTIFIER, not a secret:
 * `--token-file=/run/secrets/x`, `--api-key-env=GH_TOKEN`, `--client-id=1234`.
 * Flagging those would push registry authors toward inlining the real value.
 */
const EXEMPT_SUFFIXES = /(?:[-_](?:file|path|env|var|name|id))$/i;

/**
 * Credential formats with a fixed, unmistakable prefix. Narrow on purpose: every
 * entry here is a shape no npm package spec, flag or path can collide with. This
 * is a backstop for a token that appears ONLY in argv and so is invisible to the
 * exact check below, not the primary rule.
 */
const KNOWN_TOKEN_PREFIXES = [
  'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_', // GitHub
  'xoxb-', 'xoxp-', 'xoxa-', 'xoxs-', 'xapp-',            // Slack
  'sk-', 'sk_live_', 'sk_test_', 'rk_live_',              // OpenAI / Stripe
  'ya29.', '1//',                                          // Google
  'eyJ',                                                   // a JWT header
  'figd_', 'AKIA', 'ASIA',                                 // Figma, AWS
];

function flagName(arg: string): string | null {
  if (!arg.startsWith('-')) return null;
  const eq = arg.indexOf('=');
  return eq === -1 ? arg : arg.slice(0, eq);
}

function namesACredential(arg: string): boolean {
  const name = flagName(arg);
  if (name === null) return false;
  if (EXEMPT_SUFFIXES.test(name)) return false;
  return CREDENTIAL_FLAGS.test(name);
}

export function credentialBearingArgs(
  entry: Entry,
  /**
   * The secrets this same entry is storing. Compared BY VALUE, which is the
   * load-bearing rule here: an arg byte-identical to the token going into the
   * encrypted store is a credential in argv by construction, with no guessing.
   * The pattern rules below only cover a token that never went through
   * `env`/`headers` at all.
   */
  secrets?: EntrySecrets,
): ArgvCredentialFinding[] {
  const args = entry.args;
  if (!Array.isArray(args)) return [];

  const known = [
    ...Object.values(secrets?.env ?? {}),
    ...Object.values(secrets?.headers ?? {}),
    ...(secrets?.refreshToken ? [secrets.refreshToken] : []),
    ...(secrets?.clientSecret ? [secrets.clientSecret] : []),
  ].filter((v) => typeof v === 'string' && v.length >= 8);

  const findings: ArgvCredentialFinding[] = [];
  args.forEach((raw, index) => {
    if (typeof raw !== 'string') return;

    if (known.some((secret) => raw.includes(secret))) {
      findings.push({ index, reason: "carries this entry's own credential" });
      return;
    }
    // `--token=<value>`: the flag names a credential and the value is inline.
    if (namesACredential(raw) && raw.includes('=') && raw.slice(raw.indexOf('=') + 1) !== '') {
      findings.push({ index, reason: 'inline value of a credential-named flag' });
      return;
    }
    // `--token <value>`: the credential is the NEXT arg. Reported against that
    // arg, since that is the one holding the secret.
    const prev = index > 0 ? args[index - 1] : undefined;
    if (typeof prev === 'string' && !prev.includes('=') && namesACredential(prev) && !raw.startsWith('-')) {
      findings.push({ index, reason: `value of the credential-named flag ${prev}` });
      return;
    }
    if (KNOWN_TOKEN_PREFIXES.some((p) => raw.startsWith(p))) {
      findings.push({ index, reason: 'matches a known credential format' });
    }
  });

  return findings;
}

/**
 * One line safe to log or return in an error: positions and reasons, no values.
 * `[1]` style indices so the reader can find the arg in the registry entry.
 */
export function describeArgvCredentials(findings: ArgvCredentialFinding[]): string {
  return findings.map((f) => `args[${f.index}] (${f.reason})`).join(', ');
}
