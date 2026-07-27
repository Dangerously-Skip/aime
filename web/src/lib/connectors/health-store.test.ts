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

/**
 * Counts decrypts without faking any of them: the wrapper delegates to the REAL
 * keychain-backed store, so the crypto, the file and the failure modes are
 * genuine and only the call count is observed. Needed because the cost being
 * asserted (one full AES-256-GCM decrypt of the whole store per server) is
 * invisible to a behavioural test.
 */
let storeGets: string[] = [];

vi.mock('@/lib/mcp/secret-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mcp/secret-store')>();
  return {
    ...actual,
    getMcpSecretStore: () => {
      const real = actual.getMcpSecretStore();
      return {
        ...real,
        get: (key: string) => {
          storeGets.push(key);
          return real.get(key);
        },
      };
    },
  };
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-health-store-'));
  configPath = join(dir, '.aime-mcp.json');
  process.env.AIME_CRED_KEY = randomBytes(32).toString('hex');
  storeGets = [];
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

describe('readConnectionHealth — the "no token details recorded" state', () => {
  it('REGRESSION: reports unknown for a provisioned entry with no metadata at all', async () => {
    // The merge loop rebuilt _meta as an unconditional object literal, so every
    // entry reaching classifyProvisioned had a truthy _meta and the 'unknown'
    // branch — with its "Provisioned, but no token details were recorded" copy —
    // could never run. Unreachable code with a docstring claiming otherwise is a
    // trap for whoever next branches on status.
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: { 'aime-connector-github': { transport: 'streamable-http', url: 'https://x/' } },
      }),
      { mode: 0o600 },
    );

    const { readConnectionHealth } = await import('./health');
    const [report] = await readConnectionHealth();
    expect(report.health.status).toBe('unknown');
    expect(report.health.detail).toMatch(/no token details/);
    expect(report.health.needsReconnect).toBe(false);
  });

  it('does not invent an unknown state for an entry that does have metadata', async () => {
    await writeMigratedConfig(Date.now() + 3_600_000);
    const { readConnectionHealth } = await import('./health');
    expect((await readConnectionHealth())[0].health.status).toBe('healthy');
  });
});

describe('readConnectionHealth — cost per call', () => {
  const writeMixedConfig = () =>
    writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          // the user's own servers: not ours, and never in the secret store
          playwright: { command: 'npx', args: ['playwright'] },
          'some-other-mcp': { transport: 'streamable-http', url: 'https://x/' },
          'aime-mcp-atlassian': {
            transport: 'streamable-http',
            url: 'https://mcp.atlassian.com/v1/mcp',
            headers: { Authorization: 'Bearer ${AIME_SECRET}' },
            _meta: { mcpName: 'atlassian', expiresAt: Date.now() + 3_600_000 },
          },
        },
      }),
      { mode: 0o600 },
    );

  it('REGRESSION: does not decrypt the whole store for keys it then discards', async () => {
    // Every get() is one full AES-256-GCM decrypt of the entire credential blob.
    // The old loop ran one per server in the config — including `playwright` and
    // anything else the user added by hand, which the managed-key filter threw
    // away immediately afterwards.
    await writeMixedConfig();
    const { readConnectionHealth } = await import('./health');
    await readConnectionHealth();
    expect(storeGets).toEqual(['aime-mcp-atlassian']);
  });

  it('reads each managed key at most once, however many times it is asked', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: Object.fromEntries(
          ['atlassian', 'miro', 'figma'].map((id) => [
            `aime-connector-${id}`,
            { transport: 'streamable-http', url: 'https://x/', _meta: { connectorId: id } },
          ]),
        ),
      }),
      { mode: 0o600 },
    );
    const { readConnectionHealth, staleConnectorIds } = await import('./health');
    await readConnectionHealth();
    await staleConnectorIds();
    await readConnectionHealth();
    // Three managed servers, three reads in total — not nine.
    expect([...storeGets].sort()).toEqual([
      'aime-connector-atlassian',
      'aime-connector-figma',
      'aime-connector-miro',
    ]);
  });

  it('does not re-read anything when neither the config nor the store has changed', async () => {
    // staleConnectorIds() runs on every chat message and the health route polls on
    // screen open; nothing about either file changes between them.
    await writeMixedConfig();
    const { readConnectionHealth } = await import('./health');
    await readConnectionHealth();
    const afterFirst = storeGets.length;
    await readConnectionHealth();
    expect(storeGets.length).toBe(afterFirst);
  });

  it('still notices a refresh token that arrives after the first call', async () => {
    // Caching must never be the reason a verdict goes stale: reconnecting writes
    // the store, and the very next call has to see it.
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          'aime-mcp-atlassian': {
            transport: 'streamable-http',
            url: 'https://mcp.atlassian.com/v1/mcp',
            _meta: { mcpName: 'atlassian', expiresAt: Date.now() - 60_000 },
          },
        },
      }),
      { mode: 0o600 },
    );
    const { readConnectionHealth } = await import('./health');
    expect((await readConnectionHealth())[0].health.status).toBe('expired');

    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    await getMcpSecretStore().set('aime-mcp-atlassian', { refreshToken: 'rt' });

    expect((await readConnectionHealth())[0].health.status).toBe('refreshable');
  });

  it('notices a config change even when the store is untouched', async () => {
    await writeMigratedConfig(Date.now() + 3_600_000);
    const { readConnectionHealth } = await import('./health');
    expect((await readConnectionHealth())[0].health.status).toBe('healthy');

    await writeMigratedConfig(Date.now() - 60_000);
    expect((await readConnectionHealth())[0].health.status).toBe('expired');
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
