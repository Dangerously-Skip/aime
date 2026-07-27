import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Token refresh rewrites the on-disk MCP config, so these tests use a REAL file
 * and assert on its contents afterwards — a mocked fs would prove only that the
 * code called write. Only the token endpoint (network) and the path resolver are
 * stubbed.
 */

let dir: string;
let configPath: string;

vi.mock('@/lib/app-paths', () => ({
  getMcpConfigPath: () => configPath,
}));

const fetchMock = vi.fn();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-refresh-'));
  configPath = join(dir, '.mcp.json');
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ access_token: 'NEW_TOKEN', expires_in: 3600 }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

const write = (servers: Record<string, unknown>) =>
  writeFile(configPath, JSON.stringify({ mcpServers: servers }), { mode: 0o600 });

const readBack = async () =>
  JSON.parse(await readFile(configPath, 'utf-8')).mcpServers as Record<
    string,
    Record<string, unknown>
  >;

/** An entry whose token is expired, so refresh runs. */
const expired = (extra: Record<string, unknown>) => ({
  transport: 'stdio',
  command: 'node',
  ...extra,
  _meta: {
    connectorId: 'google-personal',
    refreshToken: 'rt',
    expiresAt: 1, // long past
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    clientId: 'cid',
    ...(extra._meta as object),
  },
});

describe('token refresh — which env var gets the new token', () => {
  it('replaces the connector-declared variable', async () => {
    await write({
      'aime-connector-google-personal': expired({ env: { GOOGLE_ACCESS_TOKEN: 'old' }, _meta: {} }),
    });

    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();

    const env = (await readBack())['aime-connector-google-personal'].env;
    expect(env).toEqual({ GOOGLE_ACCESS_TOKEN: 'NEW_TOKEN' });
  });

  it('does NOT clobber unrelated credentials that merely contain ACCESS or TOKEN', async () => {
    // The old rule replaced every key matching /TOKEN|ACCESS/, so a
    // hand-written or multi-var entry lost its real AWS credentials.
    await write({
      'aime-connector-google-personal': expired({
        env: {
          GOOGLE_ACCESS_TOKEN: 'old',
          AWS_ACCESS_KEY_ID: 'AKIAREAL',
          AWS_SECRET_ACCESS_KEY: 'secretreal',
          SUMOLOGIC_ACCESS_KEY: 'sumoreal',
        },
        _meta: {},
      }),
    });

    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();

    expect((await readBack())['aime-connector-google-personal'].env).toEqual({
      GOOGLE_ACCESS_TOKEN: 'NEW_TOKEN',
      AWS_ACCESS_KEY_ID: 'AKIAREAL',
      AWS_SECRET_ACCESS_KEY: 'secretreal',
      SUMOLOGIC_ACCESS_KEY: 'sumoreal',
    });
  });

  it('updates the sole variable of an unrecognised connector', async () => {
    await write({
      'aime-connector-custom': {
        transport: 'stdio',
        command: 'node',
        env: { MY_TOKEN: 'old' },
        _meta: {
          connectorId: 'not-in-registry',
          refreshToken: 'rt',
          expiresAt: 1,
          tokenEndpoint: 'https://oauth2.googleapis.com/token',
          clientId: 'cid',
        },
      },
    });

    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();

    expect((await readBack())['aime-connector-custom'].env).toEqual({ MY_TOKEN: 'NEW_TOKEN' });
  });

  it('leaves an ambiguous unrecognised entry alone rather than guessing', async () => {
    await write({
      'aime-connector-custom': {
        transport: 'stdio',
        command: 'node',
        env: { A_TOKEN: 'a', B_TOKEN: 'b' },
        _meta: {
          connectorId: 'not-in-registry',
          refreshToken: 'rt',
          expiresAt: 1,
          tokenEndpoint: 'https://oauth2.googleapis.com/token',
          clientId: 'cid',
        },
      },
    });

    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();

    expect((await readBack())['aime-connector-custom'].env).toEqual({ A_TOKEN: 'a', B_TOKEN: 'b' });
  });

  it('refreshes an http entry via the Authorization header, preserving the prefix', async () => {
    await write({
      'aime-connector-github': {
        transport: 'streamable-http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: 'Bearer old' },
        _meta: {
          connectorId: 'google-personal',
          refreshToken: 'rt',
          expiresAt: 1,
          tokenEndpoint: 'https://oauth2.googleapis.com/token',
          clientId: 'cid',
        },
      },
    });

    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();

    expect((await readBack())['aime-connector-github'].headers).toEqual({
      Authorization: 'Bearer NEW_TOKEN',
    });
  });
});

describe('token refresh — when it runs at all', () => {
  it('does not refresh a token that is still valid', async () => {
    await write({
      'aime-connector-google-personal': {
        transport: 'stdio',
        env: { GOOGLE_ACCESS_TOKEN: 'still-good' },
        _meta: {
          connectorId: 'google-personal',
          refreshToken: 'rt',
          expiresAt: Date.now() + 60 * 60 * 1000,
          tokenEndpoint: 'https://oauth2.googleapis.com/token',
          clientId: 'cid',
        },
      },
    });

    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await readBack())['aime-connector-google-personal'].env).toEqual({
      GOOGLE_ACCESS_TOKEN: 'still-good',
    });
  });

  it('leaves the config untouched when the refresh call fails', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 400 }));
    await write({
      'aime-connector-google-personal': expired({ env: { GOOGLE_ACCESS_TOKEN: 'old' }, _meta: {} }),
    });

    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();

    expect((await readBack())['aime-connector-google-personal'].env).toEqual({
      GOOGLE_ACCESS_TOKEN: 'old',
    });
  });

  it('translates streamable-http to the SDK http type', async () => {
    await write({
      'aime-connector-github': {
        transport: 'streamable-http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: 'Bearer t' },
      },
    });

    const { loadProvisionedMcpServers } = await import('./provisioned');
    const servers = (await loadProvisionedMcpServers()) as Record<string, Record<string, unknown>>;

    expect(servers['aime-connector-github'].type).toBe('http');
    expect(servers['aime-connector-github'].transport).toBeUndefined();
    // _meta must never reach the SDK
    expect(servers['aime-connector-github']._meta).toBeUndefined();
  });
});

describe('loadProvisionedMcpServers — per-tool policy (P3.6b)', () => {
  const observedPath = () => join(dir, '.aime-mcp-tools.json');

  it('attaches always_ask to a remote server\'s destructive tools', async () => {
    await write({
      'aime-mcp-acme': {
        transport: 'streamable-http',
        url: 'https://mcp.acme.com/mcp',
        headers: { Authorization: 'Bearer t' },
      },
    });
    await writeFile(
      observedPath(),
      JSON.stringify({
        'aime-mcp-acme': ['mcp__aime-mcp-acme__getIssue', 'mcp__aime-mcp-acme__deleteIssue'],
      }),
    );

    const { loadProvisionedMcpServers } = await import('./provisioned');
    const servers = (await loadProvisionedMcpServers()) as Record<string, Record<string, unknown>>;

    expect(servers['aime-mcp-acme'].tools).toEqual([
      { name: 'deleteIssue', permission_policy: 'always_ask' },
      { name: 'getIssue', permission_policy: 'always_allow' },
    ]);
    // the token still reaches the SDK
    expect(servers['aime-mcp-acme'].headers).toEqual({ Authorization: 'Bearer t' });
  });

  it('leaves a stdio server alone — the SDK config has no tools field', async () => {
    await write({
      'aime-connector-buildkite': {
        transport: 'stdio',
        command: 'npx',
        env: { BUILDKITE_API_TOKEN: 't' },
      },
    });
    await writeFile(
      observedPath(),
      JSON.stringify({ 'aime-connector-buildkite': ['mcp__aime-connector-buildkite__triggerBuild'] }),
    );

    const { loadProvisionedMcpServers } = await import('./provisioned');
    const servers = (await loadProvisionedMcpServers()) as Record<string, Record<string, unknown>>;

    expect(servers['aime-connector-buildkite'].tools).toBeUndefined();
    expect(servers['aime-connector-buildkite'].command).toBe('npx');
  });

  it('mounts a server with no observations unpoliced rather than with an empty policy', async () => {
    // An empty tools array could read as "nothing permitted" and break the
    // server on its first ever use — which is exactly the first session.
    await write({
      'aime-mcp-fresh': { transport: 'streamable-http', url: 'https://mcp.fresh.com/mcp' },
    });

    const { loadProvisionedMcpServers } = await import('./provisioned');
    const servers = (await loadProvisionedMcpServers()) as Record<string, Record<string, unknown>>;

    expect('tools' in servers['aime-mcp-fresh']).toBe(false);
    expect(servers['aime-mcp-fresh'].type).toBe('http');
  });

  it('is unaffected by a corrupt observations file', async () => {
    await write({ 'aime-mcp-acme': { transport: 'streamable-http', url: 'https://x/mcp' } });
    await writeFile(observedPath(), 'not json');

    const { loadProvisionedMcpServers } = await import('./provisioned');
    const servers = (await loadProvisionedMcpServers()) as Record<string, Record<string, unknown>>;
    expect(servers['aime-mcp-acme']).toBeDefined();
    expect(servers['aime-mcp-acme'].tools).toBeUndefined();
  });
});
