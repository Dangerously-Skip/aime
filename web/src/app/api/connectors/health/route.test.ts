import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/** Real config file on disk — the route's whole job is reading it. */
let dir: string;
let configPath: string;

vi.mock('@/lib/app-paths', () => ({ getMcpConfigPath: () => configPath }));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-health-'));
  configPath = join(dir, '.mcp.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = (servers: Record<string, unknown>) =>
  writeFile(configPath, JSON.stringify({ mcpServers: servers }), { mode: 0o600 });

const get = async (query = '') => {
  const { GET } = await import('./route');
  const res = await GET(new Request(`http://localhost/api/connectors/health${query}`));
  return { status: res.status, body: await res.json() };
};

describe('GET /api/connectors/health', () => {
  it('reports an expired-with-no-refresh connection as needing a reconnect', async () => {
    await write({
      'aime-connector-google-personal': {
        transport: 'stdio',
        env: { GOOGLE_ACCESS_TOKEN: 'stale' },
        _meta: { connectorId: 'google-personal', expiresAt: Date.now() - 60_000 },
      },
    });

    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.needsReconnect).toEqual(['google-personal']);
    expect(body.connectors[0].health).toMatchObject({ status: 'expired', needsReconnect: true });
  });

  it('reports a healthy long-lived credential', async () => {
    await write({
      'aime-connector-github': { transport: 'streamable-http', _meta: { connectorId: 'github' } },
    });
    const { body } = await get();
    expect(body.connectors[0].health.status).toBe('healthy');
    expect(body.needsReconnect).toEqual([]);
  });

  it('reports a refreshable connection as fine', async () => {
    await write({
      'aime-connector-atlassian': {
        _meta: { connectorId: 'atlassian', expiresAt: Date.now() - 1000, refreshToken: 'rt' },
      },
    });
    const { body } = await get();
    expect(body.connectors[0].health.status).toBe('refreshable');
    expect(body.needsReconnect).toEqual([]);
  });

  it('never returns tokens or secrets', async () => {
    await write({
      'aime-connector-google-personal': {
        env: { GOOGLE_ACCESS_TOKEN: 'ACCESS-SECRET' },
        headers: { Authorization: 'Bearer HEADER-SECRET' },
        _meta: {
          connectorId: 'google-personal',
          refreshToken: 'REFRESH-SECRET',
          clientSecret: 'CLIENT-SECRET',
          expiresAt: Date.now() + 3600_000,
        },
      },
    });
    const { body } = await get();
    const json = JSON.stringify(body);
    for (const secret of ['ACCESS-SECRET', 'HEADER-SECRET', 'REFRESH-SECRET', 'CLIENT-SECRET']) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it('ignores MCP servers the user configured themselves', async () => {
    await write({
      'aime-connector-github': { _meta: { connectorId: 'github' } },
      playwright: { command: 'npx', args: ['playwright-mcp'] },
      'web-search': { command: 'npx' },
    });
    const { body } = await get();
    expect(body.connectors.map((c: { id: string }) => c.id)).toEqual(['github']);
  });

  it('returns an empty report when no config exists rather than failing', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toMatchObject({ connectors: [], needsReconnect: [] });
  });

  it('survives a corrupt config', async () => {
    await writeFile(configPath, 'not json at all');
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.connectors).toEqual([]);
  });

  it('omits the drift report unless asked', async () => {
    await write({ 'aime-connector-github': { _meta: { connectorId: 'github' } } });
    expect((await get()).body.drift).toBeUndefined();
  });

  it('reports drift both ways when the client state is supplied', async () => {
    await write({ 'aime-connector-github': { _meta: { connectorId: 'github' } } });
    // UI thinks slack is connected (it isn't) and hasn't noticed github (it is)
    const { body } = await get('?clientConnected=slack');
    expect(body.drift).toEqual({ missingInClient: ['github'], missingOnDisk: ['slack'] });
  });

  it('handles an empty clientConnected value without inventing drift', async () => {
    await write({ 'aime-connector-github': { _meta: { connectorId: 'github' } } });
    const { body } = await get('?clientConnected=');
    expect(body.drift).toBeUndefined();
  });
});
