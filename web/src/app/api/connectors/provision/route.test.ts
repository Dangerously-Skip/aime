import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

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
}));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-provision-'));
  configPath = join(dir, '.mcp.json');
});

afterEach(async () => {
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
