import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * The boundary this route defends is "what ends up in .mcp.json" — the agent
 * spawns whatever `command`/`args` it finds there. So these tests write a REAL
 * file to a temp dir and read it back. Only the path resolver is stubbed; the
 * filesystem write, the permissions and the JSON contents are genuine.
 */

let dir: string;
let configPath: string;

vi.mock('@/lib/app-paths', () => ({
  getMcpConfigPath: () => configPath,
  // Also stubbed so the credential store lands in the temp dir and no test can
  // touch the developer's real ~/.aime/credentials.enc.
  getDataDir: () => dir,
}));

/** Records revoke attempts instead of calling a provider. */
const revoked: Array<{ connectorId?: string; token?: string }> = [];

vi.mock('@/app/api/connectors/revoke/route', () => ({
  POST: async (request: Request) => {
    revoked.push(await request.json());
    return Response.json({ revoked: true });
  },
}));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-provision-'));
  configPath = join(dir, '.mcp.json');
  revoked.length = 0;
});

afterEach(async () => {
  delete process.env.AIME_CRED_KEY;
  vi.resetModules();
  await rm(dir, { recursive: true, force: true });
});

const post = async (body: unknown) => {
  const { POST } = await import('./route');
  return POST(
    new Request('http://localhost/api/connectors/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
};

const readConfig = async () =>
  JSON.parse(await readFile(configPath, 'utf-8')) as {
    mcpServers: Record<string, Record<string, unknown>>;
  };

describe('POST /api/connectors/provision — code execution', () => {
  it('does NOT write a caller-supplied command, even when the connector is real', async () => {
    const res = await post({
      connectorId: 'github',
      token: 'ghp_x',
      mcpEntry: { transport: 'stdio', command: 'sh', args: ['-c', 'touch /tmp/pwned'] },
    });
    expect(res.status).toBe(200);

    const config = await readConfig();
    const entry = config.mcpServers['aime-connector-github'];
    // the registry says github is http — no command may appear anywhere
    expect(JSON.stringify(config)).not.toContain('sh');
    expect(entry.command).toBeUndefined();
    expect(entry.transport).toBe('streamable-http');
    expect(entry.url).toBe('https://api.githubcopilot.com/mcp/');
  });

  it('refuses to write anything for an unknown connector', async () => {
    const res = await post({
      connectorId: '../../evil',
      token: 't',
      mcpEntry: { transport: 'stdio', command: 'sh', args: ['-c', 'x'] },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Unknown connector');
    // nothing created at all
    await expect(stat(configPath)).rejects.toThrow();
  });

  it('substitutes {appDir} server-side for stdio connectors', async () => {
    const res = await post({ connectorId: 'google-personal', token: 'ya29.x' });
    expect(res.status).toBe(200);
    const entry = (await readConfig()).mcpServers['aime-connector-google-personal'];
    expect(entry.command).toBe('node');
    expect(JSON.stringify(entry.args)).not.toContain('{appDir}');
    expect(entry.env).toEqual({ GOOGLE_ACCESS_TOKEN: 'ya29.x' });
  });
});

describe('POST /api/connectors/provision — secrets at rest', () => {
  it('creates the config owner-readable only (0600)', async () => {
    await post({ connectorId: 'github', token: 'ghp_secret' });
    const s = await stat(configPath);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('re-tightens a pre-existing world-readable config', async () => {
    // simulates a config written before 0600 was enforced
    await writeFile(configPath, JSON.stringify({ mcpServers: {} }), { mode: 0o644 });
    expect((await stat(configPath)).mode & 0o777).toBe(0o644);

    await post({ connectorId: 'github', token: 'ghp_secret' });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
  });

  it('does not leak internal error detail to the caller', async () => {
    // a body that isn't JSON at all
    const { POST } = await import('./route');
    const res = await POST(
      new Request('http://localhost/api/connectors/provision', { method: 'POST', body: 'not json' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid request body');
  });
});

describe('POST /api/connectors/provision — refresh metadata', () => {
  it('persists refresh metadata pinned to the registry token host', async () => {
    const res = await post({
      connectorId: 'google-personal',
      token: 'at',
      refreshToken: 'rt',
      expiresAt: 1234,
      oauthClientId: 'cid',
      oauthClientSecret: 'cs',
      oauthTokenEndpoint: 'https://oauth2.googleapis.com/token',
    });
    expect(res.status).toBe(200);
    const meta = (await readConfig()).mcpServers['aime-connector-google-personal']._meta as Record<
      string,
      unknown
    >;
    expect(meta).toMatchObject({
      connectorId: 'google-personal',
      managedBy: 'aime',
      refreshToken: 'rt',
      clientId: 'cid',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
    });
  });

  it('refuses an off-origin token endpoint and writes nothing', async () => {
    const res = await post({
      connectorId: 'google-personal',
      token: 'at',
      refreshToken: 'rt',
      oauthTokenEndpoint: 'https://evil.example/token',
    });
    expect(res.status).toBe(400);
    await expect(stat(configPath)).rejects.toThrow();
  });
});

/**
 * DISABLE vs DISCONNECT (the FIX-1 regression).
 *
 * Encrypted mode is the packaged app's mode and the only one where the
 * distinction has teeth, so these tests use a REAL master key and the REAL
 * cipher. The fallback-mode tests above deliberately stay keyless.
 */
describe('DELETE /api/connectors/provision — disable is reversible', () => {
  beforeEach(() => {
    process.env.AIME_CRED_KEY = randomBytes(32).toString('hex');
  });

  const del = async (query: string) => {
    const { DELETE } = await import('./route');
    return DELETE(
      new Request(`http://localhost/api/connectors/provision${query}`, { method: 'DELETE' }),
    );
  };

  const stored = async (serverKey: string) => {
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    return getMcpSecretStore().get(serverKey);
  };

  /** A live Google connection: access token, refresh token, expiry, BYO app. */
  const connect = () =>
    post({
      connectorId: 'google-personal',
      token: 'ya29.LIVE',
      refreshToken: 'RT-LIVE',
      expiresAt: 1_900_000_000_000,
      oauthClientId: 'cid',
      oauthClientSecret: 'cs',
      oauthTokenEndpoint: 'https://oauth2.googleapis.com/token',
    });

  const KEY = 'aime-connector-google-personal';

  it('REGRESSION: does not destroy the credentials a re-enable needs', async () => {
    // The Connectors toggle calls this DELETE to switch a connector OFF and calls
    // POST to switch it back on. FIX-1 made DELETE wipe the encrypted-store record
    // — refresh token and client secret included — so the toggle became a one-way
    // door: refreshTokenIfNeeded had nothing to renew with, health saw no expiry
    // and said "Connected", and every tool call 401ed.
    await connect();
    expect(await stored(KEY)).toMatchObject({ refreshToken: 'RT-LIVE' });

    const res = await del('?connectorId=google-personal');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ intent: 'disable' });

    expect(await stored(KEY)).toMatchObject({ refreshToken: 'RT-LIVE' });
  });

  it('unmounts it for the agent — a disabled connector is not in mcpServers', async () => {
    await connect();
    await del('?connectorId=google-personal');
    const config = await readConfig();
    expect(config.mcpServers[KEY]).toBeUndefined();
  });

  it('keeps the refresh metadata so re-enabling can still renew', async () => {
    await connect();
    await del('?connectorId=google-personal');

    // Toggle back on exactly as the UI does: the token it holds, no tokenMeta.
    await post({ connectorId: 'google-personal', token: 'ya29.LIVE' });

    const meta = (await readConfig()).mcpServers[KEY]._meta as Record<string, unknown>;
    expect(meta.expiresAt).toBe(1_900_000_000_000);
    expect(meta.clientId).toBe('cid');
    expect(meta.tokenEndpoint).toBe('https://oauth2.googleapis.com/token');
    expect(await stored(KEY)).toMatchObject({ refreshToken: 'RT-LIVE', clientSecret: 'cs' });
  });

  it('REGRESSION: re-enabling with the hydrate sentinel does not poison the token', async () => {
    // A connector reconciled from disk gets `setToken(id, 'provisioned')` in the
    // client store, because the real token never leaves the server. Toggling it
    // then POSTs the word "provisioned" as the credential.
    await connect();
    await del('?connectorId=google-personal');
    await post({ connectorId: 'google-personal', token: 'provisioned' });

    expect(await stored(KEY)).toMatchObject({ env: { GOOGLE_ACCESS_TOKEN: 'ya29.LIVE' } });
    expect(JSON.stringify(await readConfig())).not.toContain('provisioned');
  });

  it('a genuine reconnect still replaces the token', async () => {
    await connect();
    await post({ connectorId: 'google-personal', token: 'ya29.FRESH' });
    expect(await stored(KEY)).toMatchObject({ env: { GOOGLE_ACCESS_TOKEN: 'ya29.FRESH' } });
  });

  it('does not date a fresh credential with the previous one expiry', async () => {
    // The other half of merging metadata: inheriting expiresAt from the dead
    // connection would report a token the user just pasted as needing a reconnect.
    await post({
      connectorId: 'google-personal',
      token: 'ya29.OLD',
      expiresAt: 1_000, // long gone
      refreshToken: 'RT-OLD',
    });
    await post({ connectorId: 'google-personal', token: 'ya29.FRESH' });

    const meta = (await readConfig()).mcpServers[KEY]._meta as Record<string, unknown>;
    expect(meta.expiresAt).toBeUndefined();
  });

  it('REGRESSION: a re-provision does not drop the stored refresh token', async () => {
    // store.set replaces the whole record, so provisioning without a refresh token
    // (an api_key reconnect, a toggle) used to erase the one already there.
    await connect();
    await post({ connectorId: 'google-personal', token: 'ya29.FRESH' });
    expect(await stored(KEY)).toMatchObject({ refreshToken: 'RT-LIVE' });
  });

  it('a re-enabled connector is reported honestly, not as a healthy lie', async () => {
    // The symptom P3.4 exists to prevent, end to end across both modules with real
    // files: with the refresh token and expiry gone, health saw no expiresAt and
    // said "Connected.", the chat prompt listed it under "Already connected — use
    // their tools directly", and every tool call 401ed.
    await post({
      connectorId: 'google-personal',
      token: 'ya29.LIVE',
      refreshToken: 'RT-LIVE',
      expiresAt: Date.now() - 60_000, // already lapsed
      oauthClientId: 'cid',
      oauthClientSecret: 'cs',
      oauthTokenEndpoint: 'https://oauth2.googleapis.com/token',
    });
    await del('?connectorId=google-personal');
    await post({ connectorId: 'google-personal', token: 'ya29.LIVE' });

    const { readConnectionHealth } = await import('@/lib/connectors/health');
    const [report] = await readConnectionHealth();
    expect(report.id).toBe('google-personal');
    // It renews itself, so this is 'refreshable' — reachable only because BOTH the
    // stored refresh token and the recorded expiry survived the round trip.
    expect(report.health.status).toBe('refreshable');
    expect(report.health.detail).not.toBe('Connected.');
  });

  it('does not revoke anything upstream — the user only switched it off', async () => {
    await connect();
    await del('?connectorId=google-personal');
    expect(revoked).toEqual([]);
  });

  it('accepts an explicit intent=disable identically', async () => {
    await connect();
    const res = await del('?connectorId=google-personal&intent=disable');
    expect(res.status).toBe(200);
    expect(await stored(KEY)).toMatchObject({ refreshToken: 'RT-LIVE' });
  });
});

describe('DELETE /api/connectors/provision — disconnect is destructive, and explicit', () => {
  beforeEach(() => {
    process.env.AIME_CRED_KEY = randomBytes(32).toString('hex');
  });

  const del = async (query: string) => {
    const { DELETE } = await import('./route');
    return DELETE(
      new Request(`http://localhost/api/connectors/provision${query}`, { method: 'DELETE' }),
    );
  };
  const stored = async (serverKey: string) => {
    const { getMcpSecretStore } = await import('@/lib/mcp/secret-store');
    return getMcpSecretStore().get(serverKey);
  };
  const KEY = 'aime-connector-github';

  it('deletes the stored credentials', async () => {
    await post({ connectorId: 'github', token: 'ghp_LIVE' });
    expect(await stored(KEY)).toBeDefined();

    const res = await del('?connectorId=github&intent=disconnect');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ intent: 'disconnect' });
    expect(await stored(KEY)).toBeUndefined();
  });

  it('revokes the grant with the provider', async () => {
    await post({ connectorId: 'github', token: 'ghp_LIVE' });
    await del('?connectorId=github&intent=disconnect');
    expect(revoked).toEqual([{ connectorId: 'github', token: 'ghp_LIVE' }]);
  });

  it('also removes a previously disabled copy', async () => {
    await post({ connectorId: 'github', token: 'ghp_LIVE' });
    await del('?connectorId=github'); // disable → stashed
    await del('?connectorId=github&intent=disconnect');

    const config = JSON.parse(await readFile(configPath, 'utf-8')) as {
      mcpServers: Record<string, unknown>;
      disabledMcpServers?: Record<string, unknown>;
    };
    expect(config.mcpServers[KEY]).toBeUndefined();
    expect(config.disabledMcpServers?.[KEY]).toBeUndefined();
    expect(await stored(KEY)).toBeUndefined();
  });

  it('cannot be reached by a typo — an unknown intent destroys nothing', async () => {
    await post({ connectorId: 'github', token: 'ghp_LIVE' });
    const res = await del('?connectorId=github&intent=delete');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/disable|disconnect/);
    // still fully connected
    expect(await stored(KEY)).toBeDefined();
    expect((await readConfig()).mcpServers[KEY]).toBeDefined();
    expect(revoked).toEqual([]);
  });
});

describe('POST /api/connectors/provision — ambient-auth connectors carry no token', () => {
  it('never injects a caller-supplied value for an aws_iam connector', async () => {
    // The connect orchestrator reports a non-secret sentinel ('aws-iam') so the
    // client store's isAuthenticated() agrees with its own authenticated flag.
    // Injecting it would set AWS_PROFILE to a profile that does not exist and
    // break every AWS tool call.
    const res = await post({ connectorId: 'aws', token: 'aws-iam' });
    expect(res.status).toBe(200);
    const entry = (await readConfig()).mcpServers['aime-connector-aws'];
    expect(entry.env).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('aws-iam');
  });

  it('refuses a hostile AWS_PROFILE dressed up as a token', async () => {
    const res = await post({ connectorId: 'aws', token: '../../evil-profile' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await readConfig())).not.toContain('evil-profile');
  });
});

describe('DELETE /api/connectors/provision', () => {
  it('removes current and legacy key shapes', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: {
          'aime-connector-github': { transport: 'streamable-http' },
          'aime-mcp-github': { transport: 'streamable-http' },
          'nib-connector-github': { transport: 'streamable-http' },
          'nib-mcp-github': { transport: 'streamable-http' },
          'aime-connector-slack': { transport: 'streamable-http' },
        },
      }),
      { mode: 0o600 },
    );

    const { DELETE } = await import('./route');
    const res = await DELETE(
      new Request('http://localhost/api/connectors/provision?connectorId=github', {
        method: 'DELETE',
      }),
    );
    expect(res.status).toBe(200);
    expect(Object.keys((await readConfig()).mcpServers)).toEqual(['aime-connector-slack']);
  });

  it('rejects a missing connectorId', async () => {
    const { DELETE } = await import('./route');
    const res = await DELETE(
      new Request('http://localhost/api/connectors/provision', { method: 'DELETE' }),
    );
    expect(res.status).toBe(400);
  });
});
