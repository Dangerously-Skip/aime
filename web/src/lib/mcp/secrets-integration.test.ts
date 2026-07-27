import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * DR-14 end to end, against the REAL AES-256-GCM store rather than a stub.
 *
 * The claim is "no connector secret is readable on disk". Only a real encrypt →
 * write → read → decrypt cycle can establish that; a mocked store would prove
 * the code calls something. So this test supplies a real master key, drives the
 * real loader, and greps the actual bytes of both files.
 */

let dir: string;
let configPath: string;

vi.mock('@/lib/app-paths', () => ({
  getMcpConfigPath: () => configPath,
  getDataDir: () => dir,
}));

const fetchMock = vi.fn();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-dr14-'));
  configPath = join(dir, '.aime-mcp.json');
  // A real 32-byte key, exactly as Electron main would inject it.
  process.env.AIME_CRED_KEY = randomBytes(32).toString('hex');
  fetchMock.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ access_token: 'ROTATED', refresh_token: 'NEWREFRESH', expires_in: 3600 }), {
      status: 200,
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  delete process.env.AIME_CRED_KEY;
  vi.unstubAllGlobals();
  vi.resetModules();
  await rm(dir, { recursive: true, force: true });
});

const write = (servers: Record<string, unknown>) =>
  writeFile(configPath, JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 });

const onDisk = async () => readFile(configPath, 'utf-8');
const encBytes = async () => {
  try {
    return (await readFile(join(dir, 'credentials.enc'))).toString('binary');
  } catch {
    return '';
  }
};

const SECRETS = {
  access: 'ya29.SUPER-SECRET-ACCESS',
  refresh: '1//SUPER-SECRET-REFRESH',
  client: 'GOCSPX-SUPER-SECRET-CLIENT',
};

const legacyEntry = () => ({
  'aime-connector-google-personal': {
    transport: 'stdio',
    command: 'node',
    args: ['/opt/x.mjs'],
    env: { GOOGLE_ACCESS_TOKEN: SECRETS.access },
    _meta: {
      connectorId: 'google-personal',
      clientId: 'public-id',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      expiresAt: Date.now() + 3_600_000,
      refreshToken: SECRETS.refresh,
      clientSecret: SECRETS.client,
    },
  },
});

describe('DR-14 — migration of an existing plaintext config', () => {
  it('removes every secret from the file on first load', async () => {
    await write(legacyEntry());
    // sanity: they really are in there to begin with
    for (const s of Object.values(SECRETS)) expect(await onDisk()).toContain(s);

    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();

    const after = await onDisk();
    for (const s of Object.values(SECRETS)) {
      expect(after, `still on disk: ${s}`).not.toContain(s);
    }
    // structure survives, so the file still documents the connector
    expect(after).toContain('GOOGLE_ACCESS_TOKEN');
    expect(after).toContain('${AIME_SECRET}');
    expect(after).toContain('oauth2.googleapis.com');
  });

  it('still hands the SDK a working entry with the real token', async () => {
    await write(legacyEntry());

    const { loadProvisionedMcpServers } = await import('./provisioned');
    const servers = (await loadProvisionedMcpServers()) as Record<string, Record<string, unknown>>;

    expect(servers['aime-connector-google-personal'].env).toEqual({
      GOOGLE_ACCESS_TOKEN: SECRETS.access,
    });
  });

  it('encrypts the secrets rather than moving them to another readable file', async () => {
    await write(legacyEntry());
    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();

    const blob = await encBytes();
    expect(blob.length).toBeGreaterThan(0);
    for (const s of Object.values(SECRETS)) {
      expect(blob, `plaintext in credentials.enc: ${s}`).not.toContain(s);
    }
  });

  it('is idempotent — a second load does not lose the credentials', async () => {
    await write(legacyEntry());
    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();
    const servers = (await loadProvisionedMcpServers()) as Record<string, Record<string, unknown>>;

    expect(servers['aime-connector-google-personal'].env).toEqual({
      GOOGLE_ACCESS_TOKEN: SECRETS.access,
    });
  });

  it('survives a config that was already migrated', async () => {
    await write(legacyEntry());
    const { loadProvisionedMcpServers } = await import('./provisioned');
    await loadProvisionedMcpServers();
    const afterFirst = await onDisk();
    await loadProvisionedMcpServers();
    expect(await onDisk()).toBe(afterFirst);
  });
});

describe('DR-14 — refresh does not reintroduce plaintext', () => {
  it('writes the rotated token to the store, not to the config', async () => {
    // Expired, so refresh fires on load.
    const entry = legacyEntry();
    (entry['aime-connector-google-personal']._meta as Record<string, unknown>).expiresAt = 1;
    await write(entry);

    const { loadProvisionedMcpServers } = await import('./provisioned');
    const servers = (await loadProvisionedMcpServers()) as Record<string, Record<string, unknown>>;

    expect(fetchMock).toHaveBeenCalled();
    const after = await onDisk();
    // the freshly issued credentials must not land in the file either
    expect(after).not.toContain('ROTATED');
    expect(after).not.toContain('NEWREFRESH');
    // and the SDK gets the rotated token
    expect(servers['aime-connector-google-personal'].env).toEqual({
      GOOGLE_ACCESS_TOKEN: 'ROTATED',
    });
  });
});

describe('DR-14 — no master key is an honest fallback', () => {
  it('leaves secrets in the 0600 file rather than destroying them', async () => {
    delete process.env.AIME_CRED_KEY;
    await write(legacyEntry());

    const { loadProvisionedMcpServers } = await import('./provisioned');
    const servers = (await loadProvisionedMcpServers()) as Record<string, Record<string, unknown>>;

    // Lifting secrets out with nowhere to put them would lose the connection.
    expect(await onDisk()).toContain(SECRETS.access);
    expect(servers['aime-connector-google-personal'].env).toEqual({
      GOOGLE_ACCESS_TOKEN: SECRETS.access,
    });
  });

  it('reports the downgrade instead of implying encryption', async () => {
    delete process.env.AIME_CRED_KEY;
    const { describeSecretStorage } = await import('./secret-store');
    const { mode, detail } = describeSecretStorage();
    expect(mode).toBe('plaintext-fallback');
    expect(detail).toMatch(/0600 config file/);
  });

  it('reports encryption when a key is present', async () => {
    const { describeSecretStorage } = await import('./secret-store');
    expect(describeSecretStorage().mode).toBe('encrypted');
  });
});
