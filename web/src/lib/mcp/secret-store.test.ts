import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * What happens when the ciphertext and the master key disagree (DR-14 follow-up).
 *
 * This is not hypothetical: `credentials.enc` lives in ~/.aime while
 * `credential-master.key` lives in Electron's userData, and main-web.js mints a
 * FRESH RANDOM KEY whenever the key file is missing — no check for pre-existing
 * ciphertext. An uninstall/reinstall, deleting Application Support to "reset", or
 * a productName change therefore puts a new key beside old ciphertext.
 *
 * The store then throws from every READ, and reads happen on the per-request chat
 * path, so the whole app stopped working. Real cipher, real files: a stubbed store
 * cannot reproduce a GCM authentication failure.
 */

let dir: string;

vi.mock('@/lib/app-paths', () => ({
  getDataDir: () => dir,
  getMcpConfigPath: () => join(dir, '.aime-mcp.json'),
}));

const keyA = randomBytes(32);
const keyB = randomBytes(32);
const encPath = () => join(dir, 'credentials.enc');

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aime-secret-store-'));
});

afterEach(async () => {
  delete process.env.AIME_CRED_KEY;
  vi.resetModules();
  await rm(dir, { recursive: true, force: true });
});

/** Write a real encrypted blob under `key`, exactly as a keyed run would. */
async function seedUnder(key: Buffer) {
  const { createCredentialStore } = await import('@/lib/models/credentials');
  const store = createCredentialStore(key, encPath());
  await store.set('anthropic', { apiKey: 'sk-byok' });
  await store.set('mcp:aime-connector-github', {
    secrets: JSON.stringify({ headers: { Authorization: 'gho-real-token' } }),
  });
}

describe('getMcpSecretStore — a store that cannot be decrypted', () => {
  beforeEach(async () => {
    await seedUnder(keyA);
    process.env.AIME_CRED_KEY = keyB.toString('hex'); // reinstall minted a new key
  });

  it('does not throw from a read — the chat path must survive', async () => {
    const { getMcpSecretStore } = await import('./secret-store');
    const store = getMcpSecretStore();
    await expect(store.get('aime-connector-github')).resolves.toBeUndefined();
  });

  it('reports the degraded mode instead of claiming healthy encryption', async () => {
    const { describeSecretStorage } = await import('./secret-store');
    const { mode, detail } = describeSecretStorage();
    expect(mode).toBe('unreadable');
    expect(mode).not.toBe('encrypted');
    // Must tell the user what happened and what to do about it.
    expect(detail).toMatch(/reconnect/i);
    expect(detail).toContain('credentials.enc');
  });

  it('is not mistaken for the no-key fallback', async () => {
    const { getMcpSecretStore } = await import('./secret-store');
    expect(getMcpSecretStore().mode).not.toBe('plaintext-fallback');
  });

  it('leaves the unreadable file byte-for-byte untouched', async () => {
    const before = await readFile(encPath());
    const { getMcpSecretStore } = await import('./secret-store');
    const store = getMcpSecretStore();

    await store.get('aime-connector-github');
    // A write attempt must refuse rather than overwrite credentials it cannot read.
    await store.set('aime-connector-github', { refreshToken: 'x' }).catch(() => {});
    await store.delete('aime-connector-github').catch(() => {});

    expect(await readFile(encPath())).toEqual(before);
    expect(fs.readdirSync(dir)).toEqual(['credentials.enc']);
  });

  it('refuses writes loudly rather than pretending to store them', async () => {
    const { getMcpSecretStore } = await import('./secret-store');
    const store = getMcpSecretStore();
    // Silently accepting a write is how the caller ends up stripping a secret
    // out of the config and putting it nowhere.
    await expect(store.set('aime-connector-github', { refreshToken: 'x' })).rejects.toThrow();
  });

  it('recovers on its own once the matching key is back', async () => {
    process.env.AIME_CRED_KEY = keyA.toString('hex');
    const { getMcpSecretStore, describeSecretStorage } = await import('./secret-store');
    expect(describeSecretStorage().mode).toBe('encrypted');
    expect(await getMcpSecretStore().get('aime-connector-github')).toEqual({
      headers: { Authorization: 'gho-real-token' },
    });
  });
});

describe('getMcpSecretStore — the healthy and keyless modes still behave', () => {
  it('reports encryption with a matching key', async () => {
    await seedUnder(keyA);
    process.env.AIME_CRED_KEY = keyA.toString('hex');
    const { describeSecretStorage } = await import('./secret-store');
    expect(describeSecretStorage().mode).toBe('encrypted');
  });

  it('reports encryption when nothing has been stored yet', async () => {
    process.env.AIME_CRED_KEY = keyA.toString('hex');
    const { describeSecretStorage } = await import('./secret-store');
    expect(describeSecretStorage().mode).toBe('encrypted');
  });

  it('falls back honestly with no master key', async () => {
    const { describeSecretStorage } = await import('./secret-store');
    const { mode, detail } = describeSecretStorage();
    expect(mode).toBe('plaintext-fallback');
    expect(detail).toMatch(/0600/);
  });

  it('round-trips secrets through the real cipher when keyed', async () => {
    process.env.AIME_CRED_KEY = keyA.toString('hex');
    const { getMcpSecretStore } = await import('./secret-store');
    const store = getMcpSecretStore();
    await store.set('aime-mcp-atlassian', { refreshToken: 'rt', env: { A: 'b' } });
    expect(await store.get('aime-mcp-atlassian')).toEqual({ refreshToken: 'rt', env: { A: 'b' } });
    // and it is genuinely encrypted on disk
    expect((await readFile(encPath())).toString('binary')).not.toContain('rt');
    await store.delete('aime-mcp-atlassian');
    expect(await store.get('aime-mcp-atlassian')).toBeUndefined();
  });
});
