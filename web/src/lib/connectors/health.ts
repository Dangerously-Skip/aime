/**
 * Is this connection actually still alive? (P3.4)
 *
 * `expiresAt` has been recorded in the MCP config all along and never read for
 * display, so a connection whose refresh token is gone reads "Connected"
 * forever. The agent then picks its tools, the call fails with a 401 deep inside
 * an MCP server, and the user sees a confusing tool error instead of "your
 * Google connection expired, reconnect it". A dead connection that looks alive
 * is worse than no connection.
 *
 * Almost everything worth knowing is derivable from the stored metadata with no
 * network calls at all:
 *
 *   - no expiry recorded        → a long-lived credential (PAT, ambient IAM)
 *   - expiry in the future      → healthy
 *   - expiring, refresh token   → will auto-refresh on next use
 *   - expired, no refresh token → dead; only a reconnect fixes it
 *
 * That last state is exactly what a Google connection made before
 * `access_type=offline` looked like: an access token that lapsed after an hour
 * with nothing able to renew it.
 *
 * What is NOT knowable locally is revocation — a user removing the app from
 * their Google account leaves our metadata untouched. That needs a live probe,
 * which is network-bound and rate-limited, so it stays a deliberate "check now"
 * action rather than something that runs on every render.
 *
 * Pure: metadata and clock in, verdict out.
 */
import { isBuiltInServerId, builtInIdOwnsUrl } from '@/lib/mcp/url-guard';

export type HealthStatus =
  | 'healthy'
  | 'refreshable'
  | 'expired'
  | 'revoked'
  | 'unknown';

export interface ConnectionHealth {
  status: HealthStatus;
  /** True when only re-running the connect flow will fix it. */
  needsReconnect: boolean;
  /** Short, user-facing explanation. */
  detail: string;
  /** When the access token lapses, if known. */
  expiresAt?: number;
}

/** The `_meta` block written alongside a provisioned MCP entry. */
export interface ConnectionMeta {
  connectorId?: string;
  mcpName?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint?: string;
  clientId?: string;
  /**
   * Set by a failed live probe. NOTHING IN PRODUCTION WRITES THIS YET — the
   * "check now" action described above is still the deliberate future work, so
   * the 'revoked' verdict below is currently reachable only from a hand-edited
   * config (and from tests). Stated rather than implied, because the previous
   * comment pointed at a `markProbeResult` that does not exist.
   */
  lastProbeFailed?: boolean;
  lastProbeAt?: number;
}

/**
 * Matches the refresh buffer in provisioned.ts: a token inside this window is
 * renewed on the next load, so it is "refreshable", not broken.
 */
export const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function classifyConnectionHealth(
  meta: ConnectionMeta | undefined,
  now: number = Date.now(),
): ConnectionHealth {
  if (!meta) {
    return {
      status: 'unknown',
      needsReconnect: false,
      detail: 'Provisioned, but no token details were recorded.',
    };
  }

  // A live probe that failed is stronger evidence than any local reasoning:
  // the credential was rejected by the service itself.
  if (meta.lastProbeFailed) {
    return {
      status: 'revoked',
      needsReconnect: true,
      detail: 'The service rejected this credential — reconnect to restore access.',
      ...(meta.expiresAt ? { expiresAt: meta.expiresAt } : {}),
    };
  }

  // No expiry recorded: an API token or ambient credentials. Nothing to age out.
  if (typeof meta.expiresAt !== 'number' || !Number.isFinite(meta.expiresAt)) {
    return {
      status: 'healthy',
      needsReconnect: false,
      detail: 'Connected.',
    };
  }

  const remaining = meta.expiresAt - now;

  if (remaining > REFRESH_BUFFER_MS) {
    return {
      status: 'healthy',
      needsReconnect: false,
      detail: 'Connected.',
      expiresAt: meta.expiresAt,
    };
  }

  // Inside the buffer, or already lapsed. A refresh token means it recovers by
  // itself; without one, the connection is finished.
  if (meta.refreshToken) {
    return {
      status: 'refreshable',
      needsReconnect: false,
      detail:
        remaining > 0
          ? 'Access token expiring — it will renew automatically.'
          : 'Access token expired — it will renew automatically on next use.',
      expiresAt: meta.expiresAt,
    };
  }

  return {
    status: 'expired',
    needsReconnect: true,
    detail: 'Access expired and there is no refresh token — reconnect to restore access.',
    expiresAt: meta.expiresAt,
  };
}

export interface ConnectorHealthReport {
  id: string;
  serverKey: string;
  health: ConnectionHealth;
}

/** An entry as it sits in the config: metadata plus, for remote servers, its URL. */
export interface ProvisionedEntry {
  _meta?: ConnectionMeta;
  /** Present on every http/sse entry — the only local evidence of who answers. */
  url?: unknown;
}

/** The keys this app manages. Everything else in the config belongs to the user. */
const MANAGED_KEY = /^(?:aime|nib)-(connector|mcp)-(.+)$/;

/**
 * Which connector id an entry may claim.
 *
 * Same three grades of proof `connectedIdsFromServerKeys` uses, and for the same
 * reason: `aime-mcp-<name>` is built from a name the USER's URL derived, so a
 * server on `https://mcp.github.evil.com/mcp` lands at `aime-mcp-github`. Handing
 * back `github` puts an attacker's host into the id space that
 * `staleConnectorIds()` feeds to the chat prompt. The prompt intersects stale ids
 * with origin-proven connected ids, so this cannot forge a claim on its own — it
 * is aligned here so the two cannot drift apart later.
 *
 * An unproven claim is reported under its server key instead of being dropped:
 * the entry is still the user's, and they should still see it expire.
 */
function claimedId(serverKey: string, kind: string, name: string, entry: ProvisionedEntry): string {
  const meta = entry._meta;
  // Only /api/connectors/provision writes connectorId, and only after matching
  // the id against CONNECTOR_MAP.
  if (typeof meta?.connectorId === 'string' && meta.connectorId) return meta.connectorId;
  // The `-connector-` infix likewise only comes from that route, so the id in the
  // key was already validated. Covers stdio entries, which have no URL to check.
  if (kind === 'connector') return name;

  const claimed = typeof meta?.mcpName === 'string' && meta.mcpName ? meta.mcpName : name;
  if (isBuiltInServerId(claimed)) {
    const url = typeof entry.url === 'string' ? entry.url : undefined;
    return builtInIdOwnsUrl(claimed, url) ? claimed : serverKey;
  }
  // A name that is not one of our ids claims nothing.
  return claimed;
}

/**
 * Classify every provisioned entry. Accepts the raw `mcpServers` map so the
 * caller does no unwrapping; entries we don't manage are skipped.
 */
export function classifyProvisioned(
  mcpServers: Record<string, ProvisionedEntry> | undefined,
  now: number = Date.now(),
): ConnectorHealthReport[] {
  const reports: ConnectorHealthReport[] = [];
  for (const [serverKey, raw] of Object.entries(mcpServers ?? {})) {
    const match = MANAGED_KEY.exec(serverKey);
    if (!match) continue;
    const entry = raw ?? {};
    reports.push({
      id: claimedId(serverKey, match[1], match[2], entry),
      serverKey,
      health: classifyConnectionHealth(entry._meta, now),
    });
  }
  return reports.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Health for everything provisioned, reading the config AND the encrypted store.
 *
 * DR-14 moved refresh tokens out of the config, which silently broke both callers
 * of `classifyProvisioned`:
 *
 *  - `/api/connectors/health` read the file alone, so once an access token passed
 *    its hour EVERY healthy mcp-oauth connector reported "expired, reconnect".
 *  - The chat route was handed `loadProvisionedMcpServers()` output, which strips
 *    `_meta` entirely — so `expiresAt` never arrived, nothing was ever stale, and
 *    the "Connected but EXPIRED" prompt block was unreachable.
 *
 * Both now go through here, so the two cannot disagree again.
 */
export async function readConnectionHealth(
  now: number = Date.now(),
): Promise<ConnectorHealthReport[]> {
  const { getMcpConfigPath } = await import('../app-paths');

  let raw: string;
  try {
    const { readFile } = await import('fs/promises');
    raw = await readFile(getMcpConfigPath(), 'utf-8');
  } catch {
    return [];
  }

  // `now` is applied to the CACHED metadata, never cached with it: the verdict
  // for the same metadata changes as tokens age.
  return classifyProvisioned(await mergedMetadata(raw), now);
}

/**
 * Config + stored refresh tokens, merged, memoised on both inputs.
 *
 * Three things this deliberately does NOT do any more, all measured:
 *
 *  1. One `store.get()` per server IN THE CONFIG — each of which is a full
 *     AES-256-GCM decrypt of the entire credential blob — including for the
 *     user's own `playwright`/hand-written entries that the managed-key filter
 *     then threw away. The filter now runs first.
 *  2. Those reads sequentially. They are independent.
 *  3. All of it again on the next call. `staleConnectorIds()` runs on every chat
 *     message and the health route polls on screen open, while neither file has
 *     changed between them.
 *
 * Invalidation is exact rather than time-based: the config's own bytes (already
 * read, so free to compare) plus the credential blob's identity. Every write to
 * that blob lands on a new inode (temp file + rename), which is the same signal
 * `probeCredentialFile` keys its memo on.
 */
let metadataCache:
  | { configRaw: string; credentialId: string; merged: Record<string, ProvisionedEntry> }
  | undefined;

/**
 * Stands in for the refresh token in the cached metadata.
 *
 * Only its PRESENCE decides "will renew itself" versus "dead", and the cache
 * outlives the request, so keeping the real value would park a long-lived
 * credential in a module-level variable for the life of the server process —
 * precisely the needless copy DR-14 exists to remove. Nothing downstream reads
 * the value: `classifyProvisioned` returns statuses, ids and expiries only.
 */
const REFRESH_TOKEN_PRESENT = '<present>';

async function credentialFileIdentity(): Promise<string> {
  try {
    // Dynamically imported like every other fs use here, so nothing drags node:fs
    // into a client bundle that only wants the types.
    const { stat } = await import('fs/promises');
    const { getCredentialFilePath } = await import('../models/credentials');
    const s = await stat(getCredentialFilePath());
    return `${s.ino}:${s.mtimeMs}:${s.size}`;
  } catch {
    return 'absent'; // no blob yet — writing one changes this
  }
}

async function mergedMetadata(configRaw: string): Promise<Record<string, ProvisionedEntry>> {
  const credentialId = await credentialFileIdentity();

  if (metadataCache?.configRaw === configRaw && metadataCache.credentialId === credentialId) {
    return metadataCache.merged;
  }

  let mcpServers: Record<string, ProvisionedEntry> = {};
  try {
    mcpServers = (JSON.parse(configRaw) as { mcpServers?: typeof mcpServers }).mcpServers ?? {};
  } catch {
    return {};
  }

  const managed = Object.entries(mcpServers).filter(([key]) => MANAGED_KEY.test(key));
  const { getMcpSecretStore } = await import('../mcp/secret-store');
  const store = getMcpSecretStore();
  const stored = await Promise.all(managed.map(([key]) => store.get(key)));

  const merged: Record<string, ProvisionedEntry> = {};
  managed.forEach(([serverKey, entry], i) => {
    // The refresh token is the difference between "will renew itself" and "dead";
    // after DR-14 it lives only in the store. Its presence is all that is kept.
    const refreshToken = stored[i]?.refreshToken ? REFRESH_TOKEN_PRESENT : undefined;
    const meta = entry?._meta;
    // _meta is attached ONLY when there is something to attach. Rebuilding it as
    // an unconditional object literal gave every entry a truthy _meta, which made
    // classifyConnectionHealth's 'unknown' branch — "Provisioned, but no token
    // details were recorded" — unreachable for the one case it exists to describe.
    const nextMeta: ConnectionMeta | undefined =
      meta || refreshToken ? { ...(meta ?? {}), ...(refreshToken ? { refreshToken } : {}) } : undefined;
    merged[serverKey] = { url: entry?.url, ...(nextMeta ? { _meta: nextMeta } : {}) };
  });

  metadataCache = { configRaw, credentialId, merged };
  return merged;
}

/** Connector ids that are provisioned but unusable without reconnecting. */
export async function staleConnectorIds(now: number = Date.now()): Promise<Set<string>> {
  const reports = await readConnectionHealth(now);
  return new Set(reports.filter((r) => r.health.needsReconnect).map((r) => r.id));
}

export interface DriftReport {
  /** Provisioned on disk but the UI thinks they're disconnected. */
  missingInClient: string[];
  /** The UI shows them connected but nothing is provisioned — a dead entry. */
  missingOnDisk: string[];
}

/**
 * Compare what the UI believes against what is actually provisioned.
 *
 * These are two separate copies of the same fact. The MCP config is what the
 * agent really uses; the client store is a cache that (before this) was only
 * reconciled when the user happened to open the Connectors screen. Drift shows
 * as an app that claims a service is connected while the agent cannot see it,
 * or the reverse.
 */
export function diffConnections(
  clientConnectedIds: Iterable<string>,
  provisionedIds: Iterable<string>,
): DriftReport {
  const client = new Set(clientConnectedIds);
  const disk = new Set(provisionedIds);
  return {
    missingInClient: [...disk].filter((id) => !client.has(id)).sort(),
    missingOnDisk: [...client].filter((id) => !disk.has(id)).sort(),
  };
}
