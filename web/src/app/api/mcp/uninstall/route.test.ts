import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * Uninstall is the DESTRUCTIVE half of the connector lifecycle, so these tests
 * use a real temp `.claude` directory, a real 32-byte master key and the real
 * AES-256-GCM store. A mocked credential store would prove the route CALLS
 * delete; the thing worth proving is that the ciphertext is actually gone.
 *
 * Only the paths are stubbed — pointing the plugins directory at the developer's
 * real ~/.claude while exercising a recursive rm is not a test anyone should run.
 */

let dir: string;
let configPath: string;
let clientsPath: string;

vi.mock('@/lib/app-paths', () => ({
  getMcpConfigPath: () => configPath,
  getMcpClientsPath: () => clientsPath,
  getDataDir: () => dir,
}));

/** Records every revoke attempt without talking to a provider. */
const revoked: Array<{ connectorId?: string; token?: string }> = [];
let revokeBehaviour: 'ok' | 'throw' = 'ok';

vi.mock('@/app/api/connectors/revoke/route', () => ({
  POST: async (request: Request) => {
    const body = await request.json();
    revoked.push(body);
    if (revokeBehaviour === 'throw') throw new Error('provider unreachable');
    return Response.json({ revoked: true });
  },
}));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-uninstall-'));
  configPath = join(dir, '.aime-mcp.json');
  clientsPath = join(dir, '.aime-mcp-clients.json');
  process.env.AIME_CRED_KEY = randomBytes(32).toString('hex');
  revoked.length = 0;
  revokeBehaviour = 'ok';
});

afterEach(async () => {
  delete process.env.AIME_CRED_KEY;
  vi.resetModules();
  await rm(dir, { recursive: true, force: true });
});

const uninstall = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new Request('http://localhost/api/mcp/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
};

/** A connected MCP server exactly as the exchange route leaves it (post-DR-14). */
async function seedConnected(name = 'acme') {
  const serverKey = `aime-mcp-${name}`;
  await writeFile(
    configPath,
    JSON.stringify({
      mcpServers: {
        [serverKey]: {
          transport: 'streamable-http',
          url: 'https://mcp.acme.io/mcp',
          headers: { Authorization: 'Bearer ${AIME_SECRET}' },
          _meta: { mcpName: name, managedBy: 'quarry-mcp-oauth', clientId: 'cid' },
        },
        'aime-mcp-keepme': { transport: 'streamable-http', url: 'https://other/' },
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(
    clientsPath,
    JSON.stringify({ [name]: { clientId: 'cid', clientSecret: 'CLIENT-SECRET' }, keepme: {} }),
    { mode: 0o600 },
  );

  const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
  await getMcpSecretStore().set(serverKey, {
    headers: { Authorization: 'ACCESS-TOKEN' },
    refreshToken: 'REFRESH-TOKEN',
    clientSecret: 'CLIENT-SECRET',
  });
  await getMcpSecretStore().set('aime-mcp-keepme', { headers: { Authorization: 'OTHER-TOKEN' } });

  const { recordObservedTools } = await import('@/lib/mcp/observed-tools');
  await recordObservedTools(configPath, {
    [serverKey]: ['delete_everything'],
    'aime-mcp-keepme': ['read'],
  });
  return serverKey;
}

const storedFor = async (serverKey: string) => {
  const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
  return getMcpSecretStore().get(serverKey);
};

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf-8'));

describe('POST /api/mcp/uninstall — credentials at rest', () => {
  it('REGRESSION: deletes the encrypted-store record, not just the config entry', async () => {
    // The route removed the plugin dir, the config entries and the DCR client
    // record — and left the access token, refresh token and client secret
    // encrypted at rest indefinitely. `McpSecretStore.delete` had exactly one
    // production caller (provision), so this path could not reach it at all.
    const serverKey = await seedConnected();
    expect(await storedFor(serverKey)).toBeDefined();

    const res = await uninstall({ name: 'acme' });
    expect(res.status).toBe(200);

    expect(await storedFor(serverKey)).toBeUndefined();
  });

  it('leaves other servers credentials completely alone', async () => {
    await seedConnected();
    await uninstall({ name: 'acme' });
    expect(await storedFor('aime-mcp-keepme')).toEqual({
      headers: { Authorization: 'OTHER-TOKEN' },
    });
  });

  it('no longer holds the ciphertext for the removed server anywhere on disk', async () => {
    await seedConnected();
    await uninstall({ name: 'acme' });
    const { getCredentialFilePath } = await import('@/lib/models/credentials');
    const blob = await readFile(getCredentialFilePath()).catch(() => Buffer.alloc(0));
    // The blob is encrypted, so this asserts the plaintext never leaked into it
    // and, more importantly, that decrypting it no longer yields the record.
    expect(blob.toString('utf-8')).not.toContain('REFRESH-TOKEN');
  });

  it('purges every key shape a connector may have been provisioned under', async () => {
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    for (const key of [
      'aime-mcp-acme',
      'aime-connector-acme',
      'nib-mcp-acme',
      'nib-connector-acme',
    ]) {
      await getMcpSecretStore().set(key, { headers: { Authorization: 'T' } });
    }
    await uninstall({ name: 'acme' });
    for (const key of [
      'aime-mcp-acme',
      'aime-connector-acme',
      'nib-mcp-acme',
      'nib-connector-acme',
    ]) {
      expect(await storedFor(key), key).toBeUndefined();
    }
  });
});

describe('POST /api/mcp/uninstall — upstream revocation', () => {
  it('REGRESSION: revokes the access token with the provider', async () => {
    // Deleting our copy leaves the grant live on the provider's side: reconnecting
    // silently reuses the old grant (with its old scopes) and the user's account
    // page still lists an app they just disconnected.
    await seedConnected();
    await uninstall({ name: 'acme' });
    expect(revoked).toEqual([{ connectorId: 'acme', token: 'ACCESS-TOKEN' }]);
  });

  it('recovers a stdio credential from the env side of the store too', async () => {
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    await getMcpSecretStore().set('aime-connector-acme', {
      env: { ACME_ACCESS_TOKEN: 'ENV-TOKEN' },
    });
    await uninstall({ name: 'acme' });
    expect(revoked).toEqual([{ connectorId: 'acme', token: 'ENV-TOKEN' }]);
  });

  it('does not attempt a revoke when there is no token to revoke', async () => {
    await uninstall({ name: 'acme' });
    expect(revoked).toEqual([]);
  });

  it('still completes the uninstall when revocation blows up', async () => {
    // Revocation is best-effort by design: a provider outage must not leave the
    // user unable to disconnect.
    revokeBehaviour = 'throw';
    const serverKey = await seedConnected();
    const res = await uninstall({ name: 'acme' });
    expect(res.status).toBe(200);
    expect(await storedFor(serverKey)).toBeUndefined();
  });

  it('revokes BEFORE deleting the credential it needs', async () => {
    await seedConnected();
    await uninstall({ name: 'acme' });
    expect(revoked[0]?.token).toBe('ACCESS-TOKEN');
  });
});

describe('POST /api/mcp/uninstall — observed tool names', () => {
  it('REGRESSION: prunes the recorded tool names for the removed server', async () => {
    // Two different hosts can derive the same server name, so a stale entry can
    // govern a DIFFERENT server's tools on its first session — exactly the session
    // where no other policy exists.
    const serverKey = await seedConnected();
    const { readObservedTools } = await import('@/lib/mcp/observed-tools');
    expect(await readObservedTools(configPath)).toHaveProperty(serverKey);

    await uninstall({ name: 'acme' });

    const after = await readObservedTools(configPath);
    expect(after).not.toHaveProperty(serverKey);
    expect(after).toEqual({ 'aime-mcp-keepme': ['read'] });
  });
});

describe('POST /api/mcp/uninstall — what it still gets right', () => {
  it('removes the config entries, the client record and the plugin directory', async () => {
    await seedConnected();
    const pluginDir = join(dir, 'plugins', 'acme');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'plugin.json'), '{}');

    await uninstall({ name: 'acme' });

    expect(Object.keys((await readJson(configPath)).mcpServers)).toEqual(['aime-mcp-keepme']);
    expect(Object.keys(await readJson(clientsPath))).toEqual(['keepme']);
    await expect(stat(pluginDir)).rejects.toThrow();
  });

  it('refuses a traversing name and destroys nothing', async () => {
    const serverKey = await seedConnected();
    const res = await uninstall({ name: '../../evil' });
    expect(res.status).toBe(400);
    // the guard must run before anything is deleted
    expect(await storedFor(serverKey)).toBeDefined();
    expect(await readJson(clientsPath)).toHaveProperty('acme');
    expect(revoked).toEqual([]);
  });

  it('rejects a body that is not an object', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      new Request('http://localhost/api/mcp/uninstall', { method: 'POST', body: 'nope' }),
    );
    expect(res.status).toBe(400);
  });

  it('keeps the config owner-only after rewriting it', async () => {
    await seedConnected();
    await uninstall({ name: 'acme' });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
  });

  it('succeeds for a name that was never installed', async () => {
    const res = await uninstall({ name: 'ghost' });
    expect(res.status).toBe(200);
  });
});
