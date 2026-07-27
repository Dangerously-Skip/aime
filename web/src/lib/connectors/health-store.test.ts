import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * The regression: DR-14 moved refresh tokens into the encrypted store, and health
 * kept judging from the config alone. Post-DR-14 that meant EVERY healthy
 * mcp-oauth connector reported "expired — reconnect" once its access token passed
 * the hour, because the config no longer holds a refresh token.
 *
 * Uses a REAL key and the REAL cipher and writes the REAL post-DR-14 config
 * shape. The previous tests hand-wrote the pre-DR-14 inline shape, which is
 * exactly why they could not see this.
 */

let dir: string;
let configPath: string;

vi.mock('@/lib/app-paths', () => ({
  getMcpConfigPath: () => configPath,
  getDataDir: () => dir,
}));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-health-store-'));
  configPath = join(dir, '.aime-mcp.json');
  process.env.AIME_CRED_KEY = randomBytes(32).toString('hex');
});

afterEach(async () => {
  delete process.env.AIME_CRED_KEY;
  vi.resetModules();
  await rm(dir, { recursive: true, force: true });
});

/** The post-DR-14 on-disk shape: placeholder value, NO refresh token. */
const writeMigratedConfig = (expiresAt: number) =>
  writeFile(
    configPath,
    JSON.stringify({
      mcpServers: {
        'aime-mcp-atlassian': {
          transport: 'streamable-http',
          url: 'https://mcp.atlassian.com/v1/mcp',
          headers: { Authorization: 'Bearer ${AIME_SECRET}' },
          _meta: { mcpName: 'atlassian', expiresAt, clientId: 'cid' },
        },
      },
    }),
    { mode: 0o600 },
  );

describe('readConnectionHealth — after DR-14', () => {
  it('reports a refreshable connection, not "expired", when the store holds the token', async () => {
    await writeMigratedConfig(Date.now() - 60_000); // lapsed an hour ago
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    await getMcpSecretStore().set('aime-mcp-atlassian', { refreshToken: 'rt-in-store' });

    const { readConnectionHealth } = await import('./health');
    const reports = await readConnectionHealth();

    expect(reports).toHaveLength(1);
    // Before the fix this was 'expired' + needsReconnect, telling the user to
    // reconnect a connection that renews itself on next use.
    expect(reports[0].health.status).toBe('refreshable');
    expect(reports[0].health.needsReconnect).toBe(false);
  });

  it('still reports genuinely dead connections as needing a reconnect', async () => {
    // Nothing in the store: this is the pre-access_type=offline Google case.
    await writeMigratedConfig(Date.now() - 60_000);

    const { readConnectionHealth } = await import('./health');
    const reports = await readConnectionHealth();
    expect(reports[0].health.status).toBe('expired');
    expect(reports[0].health.needsReconnect).toBe(true);
  });

  it('returns no secrets', async () => {
    await writeMigratedConfig(Date.now() + 3_600_000);
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    await getMcpSecretStore().set('aime-mcp-atlassian', { refreshToken: 'SECRET-RT' });

    const { readConnectionHealth } = await import('./health');
    expect(JSON.stringify(await readConnectionHealth())).not.toContain('SECRET-RT');
  });

  it('returns empty when there is no config', async () => {
    const { readConnectionHealth } = await import('./health');
    expect(await readConnectionHealth()).toEqual([]);
  });
});

describe('staleConnectorIds — the chat route path', () => {
  it('finds a dead connection so the prompt can warn the agent', async () => {
    await writeMigratedConfig(Date.now() - 60_000);
    const { staleConnectorIds } = await import('./health');
    expect([...(await staleConnectorIds())]).toEqual(['atlassian']);
  });

  it('is empty when the connection renews itself', async () => {
    await writeMigratedConfig(Date.now() - 60_000);
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    await getMcpSecretStore().set('aime-mcp-atlassian', { refreshToken: 'rt' });

    const { staleConnectorIds } = await import('./health');
    expect((await staleConnectorIds()).size).toBe(0);
  });
});
