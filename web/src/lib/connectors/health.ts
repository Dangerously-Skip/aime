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
  /** Set by a failed live probe — see markProbeResult. */
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

/**
 * Classify every provisioned entry. Accepts the raw `mcpServers` map so the
 * caller does no unwrapping; entries we don't manage are skipped.
 */
export function classifyProvisioned(
  mcpServers: Record<string, { _meta?: ConnectionMeta }> | undefined,
  now: number = Date.now(),
): ConnectorHealthReport[] {
  const reports: ConnectorHealthReport[] = [];
  for (const [serverKey, entry] of Object.entries(mcpServers ?? {})) {
    const match = /^(?:aime|nib)-(?:connector|mcp)-(.+)$/.exec(serverKey);
    if (!match) continue;
    const meta = entry?._meta;
    reports.push({
      id: (meta?.connectorId ?? meta?.mcpName ?? match[1]) as string,
      serverKey,
      health: classifyConnectionHealth(meta, now),
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
  const { getMcpSecretStore } = await import('../mcp/secret-store');

  let mcpServers: Record<string, { _meta?: ConnectionMeta }> = {};
  try {
    const { readFile } = await import('fs/promises');
    const raw = await readFile(getMcpConfigPath(), 'utf-8');
    mcpServers = (JSON.parse(raw) as { mcpServers?: typeof mcpServers }).mcpServers ?? {};
  } catch {
    return [];
  }

  const store = getMcpSecretStore();
  const merged: Record<string, { _meta?: ConnectionMeta }> = {};
  for (const [serverKey, entry] of Object.entries(mcpServers)) {
    const stored = await store.get(serverKey);
    merged[serverKey] = {
      ...entry,
      _meta: {
        ...(entry._meta ?? {}),
        // The refresh token is the difference between "will renew itself" and
        // "dead"; after DR-14 it lives only in the store.
        ...(stored?.refreshToken ? { refreshToken: stored.refreshToken } : {}),
      },
    };
  }

  return classifyProvisioned(merged, now);
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
