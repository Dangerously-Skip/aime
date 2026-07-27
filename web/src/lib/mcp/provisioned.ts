/**
 * Load + token-refresh provisioned MCP servers for SDK queries.
 *
 * Reads `~/.claude/.mcp.json` (Claude Code's config) and the app's own
 * OAuth-provisioned MCP config (see app-paths — legacy names migrate),
 * refreshes any near-expired OAuth tokens, and returns the merged config in
 * the shape the Claude Agent SDK expects.
 *
 * Extracted from the chat surface route so /api/subagent and any other
 * server-spawning endpoint can load the same MCP set. Without this, spawned
 * subagents have no MCP tools at all and can't perform canvas writebacks like
 * Jira transitions / comments.
 */

async function readMcpConfigFile(configPath: string): Promise<Record<string, unknown>> {
  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content) as { mcpServers?: Record<string, unknown> };
    if (!config.mcpServers) return {};
    return Object.fromEntries(
      Object.entries(config.mcpServers).map(([key, entry]) => {
        const { _meta, transport, ...rest } = entry as Record<string, unknown>;
        void _meta;
        // SDK accepts 'stdio' | 'sse' | 'http' — translate streamable-http
        const sdkType = transport === 'streamable-http' ? 'http' : transport || rest.type || 'stdio';
        return [key, { type: sdkType, ...rest }];
      }),
    );
  } catch {
    return {};
  }
}

/** Mirrored by REFRESH_BUFFER_MS in connectors/health.ts, which says so. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Everything `refreshTokenIfNeeded` can rule out from the CONFIG alone, split out
 * so the caller can ask before paying for a credential-store read.
 *
 * That read is a full AES-256-GCM decrypt of the whole blob, and it used to happen
 * for every entry with a `_meta` — including the overwhelmingly common case of a
 * token with fifty minutes left, and every long-lived credential with no expiry at
 * all (a PAT, ambient AWS IAM), where the answer is always "nothing to do".
 *
 * `refreshTokenIfNeeded` calls this too rather than repeating the conditions, so
 * the pre-screen cannot start disagreeing with the real decision. Note the
 * non-numeric `expiresAt` case is preserved exactly: a corrupt value still attempts
 * a refresh, as it did before.
 */
function refreshCouldBeDue(meta: Record<string, unknown>): boolean {
  const { expiresAt, connectorId, mcpName } = meta;
  if (!expiresAt) return false;
  if (!connectorId && !mcpName) return false;
  if (typeof expiresAt === 'number' && Date.now() < expiresAt - REFRESH_BUFFER_MS) return false;
  return true;
}

async function refreshTokenIfNeeded(
  serverKey: string,
  meta: Record<string, unknown>,
  configPath: string,
): Promise<string | null> {
  const { refreshToken, connectorId, mcpName, tokenEndpoint, clientId, clientSecret } = meta;
  if (!refreshToken) return null;
  if (!refreshCouldBeDue(meta)) return null;

  const label = (connectorId || mcpName) as string;
  console.log(`[Token Refresh] Token for ${label} is expired or near expiry, refreshing...`);

  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken as string,
    });

    let url: string;
    if (tokenEndpoint && clientId) {
      url = tokenEndpoint as string;
      tokenParams.set('client_id', clientId as string);
      if (clientSecret) tokenParams.set('client_secret', clientSecret as string);
    } else {
      const { CONNECTOR_MAP } = await import('@/lib/connectors/registry');
      const { getCredentials } = await import('@/lib/connectors/credentials');
      const connector = CONNECTOR_MAP[connectorId as string];
      if (!connector?.auth?.tokenUrl) return null;
      const credentials = getCredentials(connectorId as string);
      if (!credentials?.clientId) return null;
      if (!credentials.publicClient && !credentials.clientSecret) return null;
      url = connector.auth.tokenUrl;
      tokenParams.set('client_id', credentials.clientId);
      if (!credentials.publicClient) {
        tokenParams.set('client_secret', credentials.clientSecret);
      }
      if (credentials.publicClient && connector.auth.scopes?.length) {
        tokenParams.set('scope', connector.auth.scopes.join(' '));
      }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: tokenParams.toString(),
    });
    if (!res.ok) {
      console.error(`[Token Refresh] Failed for ${label}: ${res.status}`);
      return null;
    }
    const data = await res.json();
    const newAccessToken = data.access_token;
    if (!newAccessToken) return null;

    const { readFile, writeFile } = await import('fs/promises');
    const raw = await readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as { mcpServers?: Record<string, Record<string, unknown>> };
    const entry = config.mcpServers?.[serverKey];
    if (entry) {
      if (entry.env && typeof entry.env === 'object') {
        const envObj = entry.env as Record<string, string>;
        // Replace only the variable this connector declares as its token.
        // The previous rule — every key containing TOKEN or ACCESS — happened to
        // be correct while entries carried exactly one env var, but it would
        // overwrite unrelated credentials (AWS_ACCESS_KEY_ID,
        // SUMOLOGIC_ACCESS_KEY) in any entry carrying more than one.
        const { CONNECTOR_MAP } = await import('@/lib/connectors/registry');
        const injection = CONNECTOR_MAP[connectorId as string]?.mcp.tokenInjection;
        const keys = Object.keys(envObj);
        if (injection?.method === 'env' && injection.envVar in envObj) {
          envObj[injection.envVar] = newAccessToken;
        } else if (keys.length === 1) {
          // Unknown connector (hand-written or legacy entry) but only one
          // variable, so the target is unambiguous.
          envObj[keys[0]] = newAccessToken;
        } else {
          console.warn(
            `[Token Refresh] ${label}: cannot tell which of ${keys.length} env vars holds the token; leaving them unchanged`,
          );
        }
      }
      if (entry.headers && typeof entry.headers === 'object') {
        const headerObj = entry.headers as Record<string, string>;
        if (headerObj['Authorization']) {
          const prefix = headerObj['Authorization'].startsWith('Bearer ') ? 'Bearer ' : '';
          headerObj['Authorization'] = `${prefix}${newAccessToken}`;
        }
      }
      if (entry._meta && typeof entry._meta === 'object') {
        const metaObj = entry._meta as Record<string, unknown>;
        metaObj.expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : undefined;
        if (data.refresh_token) metaObj.refreshToken = data.refresh_token;
      }

      // Lift the freshly written credentials back out before the file is saved
      // (DR-14). Without this, refresh would quietly re-introduce plaintext
      // tokens into a config that had already been migrated.
      const { extractSecrets, isEmptySecrets } = await import('./secrets');
      const { getMcpSecretStore } = await import('./secret-store');
      const store = getMcpSecretStore();
      if (store.mode === 'encrypted') {
        const existing = (await store.get(serverKey)) ?? {};
        const { entry: publicEntry, secrets } = extractSecrets(entry);
        if (!isEmptySecrets(secrets)) {
          // Merge so a rotation that omits a new refresh_token keeps the old one.
          await store.set(serverKey, { ...existing, ...secrets });
        }
        config.mcpServers![serverKey] = publicEntry as Record<string, unknown>;
      }

      await writeFile(configPath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
      console.log(`[Token Refresh] Updated ${label} token`);
    }
    return newAccessToken;
  } catch (err) {
    console.error(`[Token Refresh] Error refreshing ${label}:`, err);
    return null;
  }
}

/**
 * Move secrets out of an existing config into the encrypted store (DR-14).
 *
 * Runs on every load but writes only when something was actually inline, so it is
 * a no-op after the first pass. A no-key process leaves the file untouched —
 * lifting secrets out with nowhere to put them would destroy them.
 */
async function migrateInlineSecrets(
  config: { mcpServers?: Record<string, Record<string, unknown>> },
  configPath: string,
): Promise<void> {
  if (!config.mcpServers) return;
  const { getMcpSecretStore } = await import('./secret-store');
  const store = getMcpSecretStore();
  if (store.mode !== 'encrypted') return;

  const { extractSecrets, isEmptySecrets } = await import('./secrets');
  let changed = false;
  for (const [key, entry] of Object.entries(config.mcpServers)) {
    const { entry: publicEntry, secrets } = extractSecrets(entry);
    if (isEmptySecrets(secrets)) continue;
    const existing = (await store.get(key)) ?? {};
    await store.set(key, { ...existing, ...secrets });
    config.mcpServers[key] = publicEntry as Record<string, unknown>;
    changed = true;
  }

  if (changed) {
    const { writeFile, chmod } = await import('fs/promises');
    await writeFile(configPath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await chmod(configPath, 0o600).catch(() => {});
    console.log('[MCP] Migrated connector secrets into the encrypted store');
  }
}

export async function loadProvisionedMcpServers(): Promise<Record<string, unknown>> {
  const { join } = await import('path');
  const { homedir } = await import('os');
  const { getMcpConfigPath } = await import('@/lib/app-paths');
  const claudeDir = join(homedir(), '.claude');
  const appConfigPath = getMcpConfigPath();

  try {
    const { readFile } = await import('fs/promises');
    const raw = await readFile(appConfigPath, 'utf-8');
    const config = JSON.parse(raw) as { mcpServers?: Record<string, Record<string, unknown>> };
    if (config.mcpServers) {
      // Migrate any entry still holding secrets inline, then refresh (DR-14).
      // Migration runs first so refresh works from the store on the same pass.
      await migrateInlineSecrets(config, appConfigPath);

      const { getMcpSecretStore } = await import('./secret-store');
      const store = getMcpSecretStore();
      for (const [key, entry] of Object.entries(config.mcpServers)) {
        const meta = entry._meta as Record<string, unknown> | undefined;
        if (!meta) continue;
        // Screened from the config BEFORE the store read, which is a full decrypt of
        // the entire credential blob. Nothing here needs the token to know that a
        // credential with no expiry, or one with fifty minutes left, has nothing to
        // do — and that is nearly every entry on nearly every message.
        if (!refreshCouldBeDue(meta)) continue;
        // The refresh token now lives in the store, so hand refresh a view of
        // _meta that includes it rather than the bare on-disk metadata.
        const stored = await store.get(key);
        const effectiveMeta = stored
          ? { ...meta, ...(stored.refreshToken ? { refreshToken: stored.refreshToken } : {}), ...(stored.clientSecret ? { clientSecret: stored.clientSecret } : {}) }
          : meta;
        await refreshTokenIfNeeded(key, effectiveMeta, appConfigPath);
      }
    }
  } catch {
    // Config doesn't exist or is invalid — fine
  }

  const [claudeCodeServers, appServers] = await Promise.all([
    readMcpConfigFile(join(claudeDir, '.mcp.json')),
    readMcpConfigFile(appConfigPath),
  ]);
  // Re-unite each entry with its secrets (DR-14). They live in the encrypted
  // store; the config holds only structure plus a visible placeholder.
  //
  // An entry whose placeholder SURVIVES injection is dropped rather than mounted.
  // The old comment here claimed this could not happen — "with no master key the
  // store is inert and the secrets were never lifted out, so the entries already
  // carry them" — which is false for a config that a KEYED run already migrated.
  // `npm run electron:dev` passes no AIME_CRED_KEY while the packaged app does, and
  // both read the same ~/.claude/.aime-mcp.json, so running one after the other
  // left every entry placeholdered with nothing to fill it. Mounting those sent
  // `Bearer ${AIME_SECRET}` to the service as if it were a token. Dropping the
  // entry instead means the connector is simply not connected for this run, which
  // the connectors prompt already surfaces to the agent as reconnectable.
  const { getMcpSecretStore } = await import('./secret-store');
  const { injectSecrets, hasUnresolvedSecrets } = await import('./secrets');
  const secretStore = getMcpSecretStore();
  const withSecrets: Record<string, unknown> = {};
  const unresolved: string[] = [];

  // Two measured costs, both removed here (and both already fixed on the health
  // side of the same data — see `mergedMetadata` in connectors/health.ts):
  //
  //  1. One `store.get()` per entry IN THE CONFIG. Each is a full AES-256-GCM
  //     decrypt of the entire credential blob, and it ran for entries that carry no
  //     sentinel at all — the user's own `playwright`, a stdio server with an
  //     ambient credential — where `injectSecrets` then had nothing to put back.
  //     `hasUnresolvedSecrets` is the exact test for "needs something put back",
  //     which is why it decides the lookup rather than a managed-key filter:
  //     `migrateInlineSecrets` lifts secrets out of the user's own entries too, so
  //     those genuinely DO have records and must still be looked up.
  //  2. Those reads sequentially, on a path that runs for every message. They are
  //     independent.
  const appEntries = Object.entries(appServers) as Array<[string, Record<string, unknown>]>;
  const storedSecrets = await Promise.all(
    appEntries.map(([key, entry]) =>
      hasUnresolvedSecrets(entry) ? secretStore.get(key) : Promise.resolve(undefined),
    ),
  );

  appEntries.forEach(([key, entry], i) => {
    const injected = injectSecrets(entry, storedSecrets[i]);
    if (hasUnresolvedSecrets(injected)) {
      unresolved.push(key);
      return;
    }
    withSecrets[key] = injected;
  });
  if (unresolved.length > 0) {
    const why =
      secretStore.mode === 'encrypted'
        ? 'the encrypted store holds no record for them'
        : secretStore.mode === 'unreadable'
          ? 'the encrypted store cannot be decrypted with the current master key'
          : 'this process has no credential master key, and their secrets were already moved into the encrypted store';
    console.warn(
      `[MCP] Not mounting ${unresolved.join(', ')} — ${why}. Reconnect the connector, ` +
        `or run the packaged app so the OS keychain can supply the key. ` +
        `(Mounting them would send the placeholder to the service as the credential.)`,
    );
  }

  const merged = { ...claudeCodeServers, ...withSecrets };

  // Declare the C3 classifier to the SDK as a per-tool permission policy
  // (P3.6b), together with any standing decisions the user has made. Only
  // http/sse configs accept this — stdio cannot, an SDK constraint.
  //
  // This is ADVISORY: on chat and cowork the SDK runs with bypassPermissions, so
  // `permission_policy` gates nothing. The enforceable gate is buildToolGate +
  // canUseTool in claude-provider.ts, which covers stdio and unobserved servers
  // as well. The log below therefore says where the gate is, and no longer
  // claims that N tools "require approval" — under bypassPermissions, none of
  // them required anything, so that line certified protection that was absent.
  const { readObservedTools } = await import('./observed-tools');
  const { applyToolPolicies, readToolDecisions, decisionOptions } = await import('./tool-policy');
  const observed = await readObservedTools(appConfigPath);
  // The production source for BuildPolicyOptions.approved/denied. Without it
  // `optsFor` defaulted to `() => ({})` and always_deny was unreachable.
  const decisions = await readToolDecisions(appConfigPath);
  const { servers, applied, unsupported } = applyToolPolicies(
    merged,
    observed,
    decisionOptions(decisions),
  );
  if (applied.length > 0) {
    const sum = (pick: (a: ApplyRow) => number) => applied.reduce((n, a) => n + pick(a), 0);
    console.log(
      `[MCP] Tool policy declared for ${applied.length} server(s): ` +
        `${sum((a) => a.asked)} ask, ${sum((a) => a.allowed)} allow, ${sum((a) => a.denied)} block. ` +
        `Enforced in canUseTool (the SDK's own permission_policy is inert under bypassPermissions).`,
    );
  }
  if (unsupported.length > 0) {
    console.log(
      `[MCP] stdio server(s) take no SDK tool policy: ${unsupported.join(', ')} — ` +
        `governed by canUseTool only.`,
    );
  }
  return servers;
}

type ApplyRow = import('./tool-policy').ApplyResult['applied'][number];
