export const runtime = 'nodejs';

import { readFile, writeFile, mkdir, chmod } from 'fs/promises';
import { dirname } from 'path';
import { getMcpConfigPath } from '@/lib/app-paths';
import { decideProvision } from '@/lib/connectors/provision-guard';
import { CONNECTOR_MAP } from '@/lib/connectors/registry';
import type { ConnectorDefinition } from '@/lib/connectors/types';
import type { EntrySecrets } from '@/lib/mcp/secrets';

/**
 * MCP provisioner API route — manages connector entries in the MCP config.
 *
 * The request supplies a connector id and its OAuth token; the *entry* is built
 * server-side from the connector registry (see provision-guard). The route
 * never accepts transport, command, args or url from the caller — those decide
 * what the agent executes.
 *
 * ── DISABLE vs DISCONNECT ────────────────────────────────────────────────────
 * These are different operations and the API keeps them apart:
 *
 *   DELETE ?connectorId=x                  → DISABLE (default). Reversible.
 *   DELETE ?connectorId=x&intent=disable   → the same, said out loud.
 *   DELETE ?connectorId=x&intent=disconnect→ DISCONNECT. Destroys credentials.
 *   (anything else)                        → 400.
 *
 * The Connectors screen's on/off toggle calls the first form, and a toggle must
 * round-trip: disable stashes the entry and leaves the encrypted store alone, so
 * re-enabling still has the refresh token, expiry, client id and token endpoint
 * that make renewal possible. Only the explicit `intent=disconnect` deletes
 * secrets and revokes the grant upstream — a value nobody types by accident, and
 * an unrecognised one is refused rather than guessed at, so a typo can never be
 * the thing that destroys a credential.
 *
 * A dead connection that looks alive is worse than no connection (P3.4), and a
 * reversible toggle that quietly wasn't is how you manufacture one.
 */

/**
 * Resolve the directory the app's bundled MCP servers live in. Dev: web/.
 * Packaged app: process.resourcesPath (from electron-builder extraResources).
 * Used to substitute {appDir} placeholders in connector args.
 */
function resolveAppDir(): string {
  // process.resourcesPath is set by Electron at runtime; the Node types don't
  // know about it, so we read through the process as a loose record.
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    // In packaged Electron, our mcp-servers are copied via extraResources.
    return resourcesPath;
  }
  return process.cwd();
}

type Entry = Record<string, unknown>;

interface McpConfig {
  mcpServers?: Record<string, Entry>;
  /**
   * Entries the user switched OFF. Kept out of `mcpServers` so nothing mounts
   * them — `loadProvisionedMcpServers` and `readConnectionHealth` both read only
   * that map — and kept at all so switching back on is not a reconnect.
   */
  disabledMcpServers?: Record<string, Entry>;
}

/** Every key shape a connector may have been provisioned under. */
function serverKeysFor(connectorId: string): string[] {
  return ['aime-connector-', 'aime-mcp-', 'nib-connector-', 'nib-mcp-'].map(
    (p) => `${p}${connectorId}`,
  );
}

async function readMcpConfig(): Promise<McpConfig> {
  try {
    const content = await readFile(getMcpConfigPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return { mcpServers: {} };
  }
}

/**
 * The config holds live access tokens, refresh tokens and client secrets, so it
 * is owner-only. `mode` on writeFile only applies when the file is created, so
 * the explicit chmod re-tightens configs written before this was enforced.
 *
 * The directory is derived from the config path rather than hardcoded, so it
 * cannot drift from getMcpConfigPath().
 */
async function writeMcpConfig(config: McpConfig): Promise<void> {
  const path = getMcpConfigPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
}

/**
 * Auth types that yield no credential at all: the MCP server reads ambient cloud
 * credentials, or signs in by itself on first use. A caller-supplied token for
 * one of these is meaningless at best — for `aws` it becomes the stdio server's
 * `AWS_ACCESS_KEY_ID`, so writing the connect flow's `'aws-iam'` marker (or
 * anything else a caller sends) breaks credential resolution instead of enabling
 * it — so nothing is injected, whatever arrives.
 */
const CREDENTIAL_FREE_AUTH = new Set<ConnectorDefinition['auth']['type']>([
  'aws_iam',
  'mcp-self-auth',
]);

/**
 * Strings the client sends in a token field that are markers, not credentials.
 *
 * `provisioned` is the Connectors screen's hydrate sentinel: a connector
 * reconciled from the config gets `setToken(id, 'provisioned')` because the real
 * token never leaves the server, and re-enabling then POSTs that word as the
 * credential. Writing it replaces a live token with a string no service accepts,
 * which 401s every tool call while health still reports "Connected" — so it is
 * read as "no token supplied" and the stored credential is kept.
 */
const NON_CREDENTIAL_TOKENS = new Set(['provisioned', 'aws-iam', 'mcp-self-auth']);

/** Where this connector's credential sits, by name, in a stored secret record. */
function storedCredential(
  connector: ConnectorDefinition,
  secrets: EntrySecrets | undefined,
): string | undefined {
  if (!secrets) return undefined;
  // A connector with no MCP server (iCloud speaks IMAP/DAV in-process) has no
  // token to inject and never provisions; returning early beats asserting.
  const injection = connector.mcp?.tokenInjection;
  if (!injection) return undefined;
  const named =
    injection.method === 'env' ? secrets.env?.[injection.envVar] : secrets.headers?.[injection.headerName];
  if (named) return named;
  // A legacy entry may have been stored under a different name than the registry
  // now declares; any single credential is still better than losing it.
  return [...Object.values(secrets.env ?? {}), ...Object.values(secrets.headers ?? {})].find(
    (v) => typeof v === 'string' && v.length > 0,
  );
}

/** The same, for a keyless install where secrets are still inline in the entry. */
function inlineCredential(connector: ConnectorDefinition, entry: Entry | undefined): string | undefined {
  if (!entry) return undefined;
  const injection = connector.mcp?.tokenInjection;
  if (!injection) return undefined;
  if (injection.method === 'env') {
    const value = (entry.env as Record<string, string> | undefined)?.[injection.envVar];
    return value && !value.includes('${') ? value : undefined;
  }
  const raw = (entry.headers as Record<string, string> | undefined)?.[injection.headerName];
  if (!raw || raw.includes('${')) return undefined;
  return raw.replace(/^(Bearer|Token)\s+/, '');
}

/**
 * POST — Add/update a connector's MCP server entry.
 * Body: { connectorId, token, refreshToken?, expiresAt?, oauthClientId?,
 *         oauthClientSecret?, oauthTokenEndpoint? }
 *
 * Also the RE-ENABLE path, so it merges rather than replaces: `_meta` fields the
 * request does not carry are inherited from the existing (or stashed) entry, and
 * a stored credential survives a request that has none.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const appDir = resolveAppDir();
    // Validate first: this rejects unknown connectors and off-origin token
    // endpoints before anything is read or written.
    const validated = decideProvision(body, { appDir });
    if (!validated.ok) {
      return Response.json({ error: validated.error }, { status: 400 });
    }

    const connector = CONNECTOR_MAP[body.connectorId as string];
    const serverKey = validated.serverKey;
    const config = await readMcpConfig();
    if (!config.mcpServers) config.mcpServers = {};
    const previous = config.mcpServers[serverKey] ?? config.disabledMcpServers?.[serverKey];

    const { extractSecrets, isEmptySecrets } = await import('@/lib/mcp/secrets');
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    const store = getMcpSecretStore();
    const storedSecrets = await store.get(serverKey).catch(() => undefined);

    // ── Which token actually gets written ────────────────────────────────────
    const existingCredential =
      storedCredential(connector, storedSecrets) ?? inlineCredential(connector, previous);
    const supplied = typeof body.token === 'string' ? body.token : '';
    let token = supplied;
    if (CREDENTIAL_FREE_AUTH.has(connector.auth.type)) {
      token = '';
    } else if (!supplied || NON_CREDENTIAL_TOKENS.has(supplied)) {
      token = existingCredential ?? '';
    }
    // Re-enabling posts the credential the client already holds, so "did a token
    // arrive?" cannot tell a toggle from a reconnect — whether it is a DIFFERENT
    // credential can.
    const isNewCredential = token !== '' && token !== existingCredential;

    const decision = token === supplied ? validated : decideProvision({ ...body, token }, { appDir });
    if (!decision.ok) {
      return Response.json({ error: decision.error }, { status: 400 });
    }

    // ── Metadata: inherited only when the credential is the one already there ─
    //
    // A RE-ENABLE reuses the stored credential, so its expiry, client id, token
    // endpoint — and any recorded probe failure — all still describe it, and
    // dropping them is what left a re-enabled connector unable to ever refresh.
    //
    // A genuine RECONNECT is the opposite case: the credential is new, so the old
    // one's `expiresAt` says nothing about it. Inheriting that would date a
    // freshly pasted long-lived token with a dead OAuth token's expiry and report
    // it as needing a reconnect it just had.
    const inherited = isNewCredential
      ? {}
      : ((previous?._meta as Record<string, unknown> | undefined) ?? {});
    const meta: Record<string, unknown> = {
      ...inherited,
      connectorId: body.connectorId,
      connectorName: decision.connectorName,
      managedBy: 'aime',
      // Token refresh metadata — used by loadProvisionedMcpServers() to
      // auto-refresh. For byoCredentials connectors this includes the user's
      // own OAuth client so refresh runs without re-authenticating.
      ...decision.meta,
    };

    const fullEntry: Entry = { ...decision.entry, _meta: meta };

    // ── argv is refused, never written ───────────────────────────────────────
    //
    // `env` and `headers` get split into the encrypted store. `args` cannot be:
    // it is positional, unnamed, and executed — and the SDK serialises mcpServers
    // into the `claude` CLI argv anyway, so an "encrypted" argv secret would still
    // be in `ps auxww`. Refusing is the only answer that is not theatre; see
    // credentialBearingArgs. Checked BEFORE any write, so a bad entry reaches
    // neither the config nor the store.
    //
    // Unreachable today — `tokenInjection` supports only `env` and `header`, and
    // args come from the static registry — which is exactly why it is a guard and
    // not a migration. It fires the moment a registry entry starts carrying a token
    // in argv, when moving it to `env` is still a one-line change.
    const { credentialBearingArgs, describeArgvCredentials } = await import('@/lib/mcp/secrets');
    // Split once and reuse. extractSecrets is pure and idempotent, but running it
    // twice on an entry carrying a real token is a needless second copy.
    const { entry: publicEntry, secrets } = extractSecrets(fullEntry);
    const argvLeaks = credentialBearingArgs(fullEntry, secrets);
    if (argvLeaks.length > 0) {
      // The connector id, the positions and the reasons — never the value.
      console.error(
        `[Provisioner] Refusing to provision ${body.connectorId}: ` +
          `command-line arguments would carry a credential — ${describeArgvCredentials(argvLeaks)}. ` +
          `Move it to the entry's env (tokenInjection.method 'env'), which is encrypted at rest.`,
      );
      return Response.json(
        {
          error:
            'This connector would pass a credential on the command line, where it is visible ' +
            'to any process listing. Refusing to provision it.',
        },
        { status: 500 },
      );
    }

    // Secrets go to the encrypted store; the config keeps structure and a visible
    // placeholder (DR-14). With no master key the store is inert and the entry is
    // written as-is, which is the documented fallback rather than a silent one.
    if (store.mode === 'encrypted') {
      if (!isEmptySecrets(secrets)) {
        // MERGED, not replaced: a record is one blob, so setting it from a request
        // that carries no refresh token (an api_key reconnect, a re-enable) used to
        // erase the refresh token already stored for that server.
        await store.set(serverKey, { ...(storedSecrets ?? {}), ...secrets });
      }
      config.mcpServers[serverKey] = publicEntry;
    } else {
      config.mcpServers[serverKey] = fullEntry;
    }

    // It is mounted again, so it is no longer disabled.
    if (config.disabledMcpServers) {
      delete config.disabledMcpServers[serverKey];
      if (Object.keys(config.disabledMcpServers).length === 0) delete config.disabledMcpServers;
    }

    await writeMcpConfig(config);

    return Response.json({ success: true, serverKey });
  } catch (error) {
    console.error('[Provisioner] POST error:', error);
    return Response.json({ error: 'Failed to provision connector' }, { status: 500 });
  }
}

/**
 * DELETE — switch a connector off (default) or disconnect it for good.
 *
 * `?intent=disable` (or omitted): unmount it, keep everything needed to re-enable.
 * `?intent=disconnect`: delete the stored credentials and revoke the grant.
 */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const connectorId = url.searchParams.get('connectorId');

    if (!connectorId) {
      return Response.json({ error: 'Missing connectorId parameter' }, { status: 400 });
    }

    // No default guessing on an unrecognised value: the two intents differ by
    // whether credentials survive, so a typo must fail loudly rather than pick one.
    const rawIntent = url.searchParams.get('intent');
    if (rawIntent !== null && rawIntent !== 'disable' && rawIntent !== 'disconnect') {
      return Response.json(
        { error: 'intent must be "disable" (reversible) or "disconnect" (deletes credentials)' },
        { status: 400 },
      );
    }
    const intent: 'disable' | 'disconnect' = rawIntent === 'disconnect' ? 'disconnect' : 'disable';

    const config = await readMcpConfig();
    const serverKeys = serverKeysFor(connectorId);

    if (!config.mcpServers && !config.disabledMcpServers) {
      return Response.json({ success: true, intent });
    }

    if (intent === 'disable') {
      // Stash rather than delete. The client store keeps its token, and P3.5
      // already stops a disabled connector from being mounted; what was missing is
      // the refresh metadata, which lives only here.
      for (const key of serverKeys) {
        const entry = config.mcpServers?.[key];
        if (!entry) continue;
        (config.disabledMcpServers ??= {})[key] = entry;
        delete config.mcpServers![key];
      }
      await writeMcpConfig(config);
      return Response.json({ success: true, intent, credentialsPreserved: true });
    }

    // ── Destructive, and asked for explicitly ────────────────────────────────
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    const store = getMcpSecretStore();
    const connector = CONNECTOR_MAP[connectorId];

    // Recover the credential before deleting it — revocation needs it.
    let token: string | undefined;
    for (const key of serverKeys) {
      const secrets = await store.get(key).catch(() => undefined);
      const entry = config.mcpServers?.[key] ?? config.disabledMcpServers?.[key];
      token ??= connector
        ? (storedCredential(connector, secrets) ?? inlineCredential(connector, entry))
        : undefined;
    }

    for (const key of serverKeys) {
      delete config.mcpServers?.[key];
      delete config.disabledMcpServers?.[key];
      // Or disconnecting would leave live credentials behind in the encrypted
      // store. An `unreadable` store refuses deletes, which is correct — it must
      // not be written over — and must not fail the disconnect.
      await store.delete(key).catch(() => {});
    }
    if (config.disabledMcpServers && Object.keys(config.disabledMcpServers).length === 0) {
      delete config.disabledMcpServers;
    }

    await writeMcpConfig(config);

    // Best-effort: deleting our copy does not end the grant, and reconnecting
    // would silently reuse the old authorisation with its old scopes.
    let revokedUpstream = false;
    if (token) {
      try {
        const { POST: revoke } = await import('@/app/api/connectors/revoke/route');
        const res = await revoke(
          new Request('http://localhost/api/connectors/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectorId, token }),
          }),
        );
        revokedUpstream = !!(await res.json().catch(() => ({}))).revoked;
      } catch (err) {
        console.warn(
          `[Provisioner] Revocation failed for ${connectorId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return Response.json({ success: true, intent, credentialsDeleted: true, revokedUpstream });
  } catch (error) {
    console.error('[Provisioner] DELETE error:', error);
    return Response.json({ error: 'Failed to deprovision connector' }, { status: 500 });
  }
}
