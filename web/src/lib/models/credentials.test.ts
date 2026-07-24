import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { createCredentialStore, CredentialStoreUnavailable } from './credentials';

let dir: string;
let file: string;
const key = randomBytes(32);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aime-creds-test-'));
  file = path.join(dir, 'credentials.enc');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('createCredentialStore', () => {
  it('rejects a key that is not 32 bytes', () => {
    expect(() => createCredentialStore(randomBytes(16), file)).toThrow(CredentialStoreUnavailable);
  });

  it('round-trips values through encryption', async () => {
    const store = createCredentialStore(key, file);
    await store.set('openai', { apiKey: 'sk-secret' });

    expect(await store.getField('openai', 'apiKey')).toBe('sk-secret');
    expect(await store.get('openai')).toEqual({ apiKey: 'sk-secret' });
  });

  it('persists across store instances (same key + file)', async () => {
    await createCredentialStore(key, file).set('groq', { apiKey: 'gsk-x' });
    const reopened = createCredentialStore(key, file);
    expect(await reopened.getField('groq', 'apiKey')).toBe('gsk-x');
  });

  it('merges fields on set', async () => {
    const store = createCredentialStore(key, file);
    await store.set('azure-openai', { apiKey: 'k' });
    await store.set('azure-openai', { azureResource: 'my-res' });
    expect(await store.get('azure-openai')).toEqual({ apiKey: 'k', azureResource: 'my-res' });
  });

  it('deletes a provider record and lists remaining', async () => {
    const store = createCredentialStore(key, file);
    await store.set('a', { apiKey: '1' });
    await store.set('b', { apiKey: '2' });
    await store.delete('a');
    expect(await store.list()).toEqual(['b']);
    expect(await store.get('a')).toBeUndefined();
  });

  it('writes the file with 0600 permissions', async () => {
    await createCredentialStore(key, file).set('x', { apiKey: 'y' });
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('does not store secrets in plaintext', async () => {
    await createCredentialStore(key, file).set('openai', { apiKey: 'sk-plaintext-canary' });
    const bytes = fs.readFileSync(file);
    expect(bytes.toString('utf8')).not.toContain('sk-plaintext-canary');
    expect(bytes.toString('utf8')).not.toContain('openai');
  });

  it('returns an empty store when the file is missing', async () => {
    const store = createCredentialStore(key, file);
    expect(await store.list()).toEqual([]);
    expect(await store.get('anything')).toBeUndefined();
  });

  it('fails closed on a wrong key (does not silently reset)', async () => {
    await createCredentialStore(key, file).set('openai', { apiKey: 'sk-x' });
    const wrong = createCredentialStore(randomBytes(32), file);
    await expect(wrong.get('openai')).rejects.toThrow();
  });

  it('fails closed on a tampered file (GCM auth)', async () => {
    const store = createCredentialStore(key, file);
    await store.set('openai', { apiKey: 'sk-x' });
    const blob = fs.readFileSync(file);
    blob[blob.length - 1] ^= 0xff; // flip a ciphertext byte
    fs.writeFileSync(file, blob);
    await expect(store.get('openai')).rejects.toThrow();
  });
});
