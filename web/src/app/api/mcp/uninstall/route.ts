export const runtime = 'nodejs';

import { rm, readFile, writeFile, chmod } from 'fs/promises';
import { dirname, join } from 'path';
import { getMcpConfigPath, getMcpClientsPath } from '@/lib/app-paths';
import { sanitizePluginName, resolveInstallDir } from '@/lib/mcp/install-guard';
import { forgetObservedTools } from '@/lib/mcp/observed-tools';
import type { EntrySecrets } from '@/lib/mcp/secrets';

/** Both files hold live tokens and client secrets — owner-only. */
async function writeSecret(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
}

/**
 * Every key shape a server may have been provisioned under: the MCP OAuth route
 * writes `aime-mcp-<name>`, the connector route writes `aime-connector-<name>`,
 * and both had `nib-` prefixes before the rename.
 */
function serverKeysFor(name: string): string[] {
  return ['aime-mcp-', 'aime-connector-', 'nib-mcp-', 'nib-connector-'].map((p) => `${p}${name}`);
}

/**
 * Derived from the config path rather than `homedir()` so it cannot drift from
 * it — and so a test can point the recursive rm somewhere other than the
 * developer's real ~/.claude/plugins.
 */
function pluginsDir(): string {
  return join(dirname(getMcpConfigPath()), 'plugins');
}

/**
 * The credential a provider would need in order to revoke it.
 *
 * After DR-14 the config holds only a placeholder, so the live value is in the
 * encrypted store: in `headers` for an http server (scheme prefix already
 * stripped) or in `env` for a stdio one.
 */
function credentialFrom(secrets: EntrySecrets | undefined): string | undefined {
  const candidates = [
    ...Object.values(secrets?.headers ?? {}),
    ...Object.values(secrets?.env ?? {}),
  ];
  return candidates.find((value) => typeof value === 'string' && value.length > 0);
}

/**
 * Tell the provider the grant is finished. Best-effort by design.
 *
 * Deleting our copy of a token does not end the grant: the provider still lists
 * the app on the user's account page, and reconnecting silently reuses the old
 * authorisation with whatever scopes it had. The browser previously did this for
 * OAuth2 connectors and skipped it entirely for MCP-OAuth ones (its mcp-oauth
 * branch returns before reaching the revoke call), so it belongs here, on the one
 * path every disconnect goes through.
 */
async function revokeUpstream(connectorId: string, token: string | undefined): Promise<void> {
  if (!token) return;
  try {
    const { POST: revoke } = await import('@/app/api/connectors/revoke/route');
    await revoke(
      new Request('http://localhost/api/connectors/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectorId, token }),
      }),
    );
  } catch (err) {
    // A provider outage must never leave the user unable to disconnect.
    console.warn(
      `[MCP Uninstall] Revocation failed for ${connectorId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * POST /api/mcp/uninstall
 * Body: { name }
 *
 * The DESTRUCTIVE half of the connector lifecycle — a full DISCONNECT. Removes
 * the installed plugin directory, the provisioned MCP entries, the registered
 * OAuth client, the recorded tool names, and the credentials at rest, and asks
 * the provider to revoke the grant.
 *
 * Its reversible counterpart is `DELETE /api/connectors/provision` with no
 * `intent` (or `intent=disable`), which preserves everything needed to re-enable.
 * The two are separate endpoints precisely so a toggle cannot reach this one.
 */
export async function POST(request: Request) {
  const mcpConfigFile = getMcpConfigPath();
  const mcpClientsFile = getMcpClientsPath();
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { name } = body as { name?: unknown };

    // Same allowlist the install route uses — this path is passed to a
    // recursive rm, so it must be a single safe segment inside the plugins dir.
    // Runs before ANY deletion: a rejected name must leave the disk untouched.
    const safeName = sanitizePluginName(name);
    if (!safeName.ok) {
      return Response.json({ error: safeName.error }, { status: 400 });
    }
    const pluginDir = resolveInstallDir(pluginsDir(), safeName.value);
    if (!pluginDir.ok) {
      return Response.json({ error: pluginDir.error }, { status: 400 });
    }

    const serverKeys = serverKeysFor(safeName.value);

    // Read the credential BEFORE deleting it — revocation needs it — then delete
    // it whether or not the provider accepted the revoke. Leaving a live access
    // token, refresh token and client secret encrypted at rest after the user
    // pressed Disconnect is the failure this route existed with; the sibling
    // provision route has always done this and the fix landed on only one path.
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    const store = getMcpSecretStore();
    let token: string | undefined;
    for (const key of serverKeys) {
      const secrets = await store.get(key).catch(() => undefined);
      token ??= credentialFrom(secrets);
    }
    await revokeUpstream(safeName.value, token);
    for (const key of serverKeys) {
      // An `unreadable` store refuses deletes; that is correct (it must not be
      // written over) and must not fail the uninstall.
      await store.delete(key).catch(() => {});
    }

    await rm(pluginDir.value, { recursive: true, force: true });

    // Remove from MCP config
    try {
      const config = JSON.parse(await readFile(mcpConfigFile, 'utf-8'));
      if (config.mcpServers) {
        for (const key of serverKeys) delete config.mcpServers[key];
        // A disabled entry is stashed outside mcpServers (see the provision
        // route); disconnecting must take that copy too.
        if (config.disabledMcpServers) {
          for (const key of serverKeys) delete config.disabledMcpServers[key];
        }
        await writeSecret(mcpConfigFile, config);
      }
    } catch {}

    // Remove from registered clients
    try {
      const clients = JSON.parse(await readFile(mcpClientsFile, 'utf-8'));
      delete clients[safeName.value];
      await writeSecret(mcpClientsFile, clients);
    } catch {}

    // Forget the tool names this server taught us. Two hosts can derive the same
    // server name, so a stale list would govern a DIFFERENT server on its first
    // session — the one session with no SDK-level policy of its own.
    await forgetObservedTools(mcpConfigFile, serverKeys);

    return Response.json({ success: true });
  } catch (error) {
    console.error('[MCP Uninstall] Error:', error);
    return Response.json({ error: 'Uninstall failed' }, { status: 500 });
  }
}
