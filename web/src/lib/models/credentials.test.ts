import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import {
  createCredentialStore,
  probeCredentialFile,
  CredentialStoreUnavailable,
  CredentialStoreUnreadable,
} from './credentials';

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

  it('creates a missing data directory owner-only (0700)', async () => {
    const nested = path.join(dir, 'nested', 'credentials.enc');
    await createCredentialStore(key, nested).set('x', { apiKey: 'y' });
    expect(fs.statSync(path.dirname(nested)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(nested).mode & 0o777).toBe(0o600);
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
    await expect(wrong.get('openai')).rejects.toThrow(CredentialStoreUnreadable);
    // and the ciphertext is still there for the right key to recover
    expect(await createCredentialStore(key, file).getField('openai', 'apiKey')).toBe('sk-x');
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

/**
 * The blob is ONE file shared by the BYOK provider keys and every connector's
 * secrets, and `loadProvisionedMcpServers()` now mutates it on every chat
 * request. Read-modify-write with no lock therefore loses records: two
 * overlapping requests (chat + cowork, or a cron run during a message) each read
 * the same snapshot and the second write wins outright.
 *
 * Real fs, real AES-256-GCM, and — deliberately — a FRESH STORE INSTANCE per
 * write, because that is the production shape: `getCredentialStore()` builds a
 * new store on every call, so a lock scoped to one instance would serialise
 * nothing.
 */
describe('regression: concurrent writes must not clobber each other', () => {
  it('keeps both records when two different keys are written at once', async () => {
    await createCredentialStore(key, file).set('anthropic', { apiKey: 'sk-user-just-typed' });

    await Promise.all([
      createCredentialStore(key, file).set('mcp:aime-connector-github', {
        secrets: JSON.stringify({ refreshToken: 'gh-refresh' }),
      }),
      createCredentialStore(key, file).set('mcp:aime-connector-slack', {
        secrets: JSON.stringify({ refreshToken: 'sl-refresh' }),
      }),
    ]);

    const after = createCredentialStore(key, file);
    expect((await after.list()).sort()).toEqual([
      'anthropic',
      'mcp:aime-connector-github',
      'mcp:aime-connector-slack',
    ]);
    // and the refresh token — the thing a lost record actually costs the user
    expect(await after.getField('mcp:aime-connector-github', 'secrets')).toContain('gh-refresh');
  });

  it('survives a burst of concurrent writers', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `mcp:aime-connector-${i}`);
    await Promise.all(ids.map((id) => createCredentialStore(key, file).set(id, { secrets: id })));
    expect((await createCredentialStore(key, file).list()).sort()).toEqual([...ids].sort());
  });

  it('does not lose an API key saved in Settings while a chat request writes a connector', async () => {
    // The Settings save and the chat request touch the same blob. Losing the
    // race here means the key the user just typed silently disappears.
    await Promise.all([
      createCredentialStore(key, file).set('anthropic', { apiKey: 'sk-just-saved' }),
      createCredentialStore(key, file).set('mcp:aime-connector-google', { secrets: 'tok' }),
    ]);

    const after = createCredentialStore(key, file);
    expect(await after.getField('anthropic', 'apiKey')).toBe('sk-just-saved');
    expect(await after.getField('mcp:aime-connector-google', 'secrets')).toBe('tok');
  });

  it('serialises a delete racing a set', async () => {
    const seed = createCredentialStore(key, file);
    await seed.set('anthropic', { apiKey: 'sk-old' });
    await seed.set('mcp:aime-connector-github', { secrets: 'gh' });

    await Promise.all([
      createCredentialStore(key, file).delete('mcp:aime-connector-github'),
      createCredentialStore(key, file).set('anthropic', { apiKey: 'sk-new' }),
    ]);

    // Either order produces the same state — unless one write was built on a
    // stale snapshot, which resurrects the deleted record or drops the update.
    const after = createCredentialStore(key, file);
    expect(await after.list()).toEqual(['anthropic']);
    expect(await after.getField('anthropic', 'apiKey')).toBe('sk-new');
  });
});

/**
 * The probe is what lets a caller decide "is it safe to write?" before doing any
 * work, so it has to be right about a key/ciphertext mismatch — the situation a
 * reinstall produces, since the key and the blob live in different directories.
 */
describe('probeCredentialFile', () => {
  it('reports a missing file as empty rather than broken', () => {
    expect(probeCredentialFile(key, file).status).toBe('empty');
  });

  it('reports a readable blob as ok', async () => {
    await createCredentialStore(key, file).set('openai', { apiKey: 'sk-x' });
    expect(probeCredentialFile(key, file).status).toBe('ok');
  });

  it('reports a blob written under a different key as unreadable, with a reason', async () => {
    await createCredentialStore(key, file).set('openai', { apiKey: 'sk-x' });
    const probe = probeCredentialFile(randomBytes(32), file);
    expect(probe.status).toBe('unreadable');
    expect(probe.detail).toBeTruthy();
    expect(probe.path).toBe(file);
  });

  it('notices when the file changes under it (memo must not go stale)', async () => {
    const other = randomBytes(32);
    await createCredentialStore(key, file).set('openai', { apiKey: 'sk-x' });
    expect(probeCredentialFile(other, file).status).toBe('unreadable');

    // Rewritten with the other key — the same probe must now say ok.
    fs.rmSync(file);
    await createCredentialStore(other, file).set('openai', { apiKey: 'sk-y' });
    expect(probeCredentialFile(other, file).status).toBe('ok');
    expect(probeCredentialFile(key, file).status).toBe('unreadable');
  });
});

/**
 * Atomicity. A plain whole-file `writeFile` opens with O_TRUNC, so the existing
 * credentials are destroyed before the replacement is written: a kill (or a
 * concurrent reader) in that window sees a truncated file and every stored
 * secret is gone. temp-file + rename makes the swap atomic — a reader sees
 * either the whole old file or the whole new one.
 *
 * These assert the observable consequences rather than spying on `fs`, since
 * mocking the very boundary under test would prove nothing.
 */
describe('regression: the write must be atomic', () => {
  it('replaces the file by rename instead of truncating it in place', async () => {
    const store = createCredentialStore(key, file);
    await store.set('a', { apiKey: '1' });
    const first = fs.statSync(file);
    await store.set('b', { apiKey: '2' });
    const second = fs.statSync(file);

    // A new inode is the fingerprint of rename-over-target. Writing in place
    // keeps the inode and passes through a zero-length state.
    if (process.platform !== 'win32') {
      expect(second.ino).not.toBe(first.ino);
    }
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('leaves no temp file behind on success', async () => {
    await createCredentialStore(key, file).set('a', { apiKey: '1' });
    await createCredentialStore(key, file).set('b', { apiKey: '2' });
    expect(fs.readdirSync(dir)).toEqual(['credentials.enc']);
  });

  it('never lets a concurrent reader observe a partial store', async () => {
    // Large enough that the write is not instantaneous, so a reader polling
    // through it lands inside the window if one exists.
    const big = (n: number) => String(n).repeat(2 * 1024 * 1024);
    const writer = createCredentialStore(key, file);
    await writer.set('seed', { apiKey: big(0) });

    const reader = createCredentialStore(key, file);
    let writing = true;
    const writes = (async () => {
      for (let i = 1; i <= 6; i++) await writer.set('seed', { apiKey: big(i) });
    })().finally(() => {
      writing = false;
    });

    const failures: string[] = [];
    let reads = 0;
    while (writing) {
      try {
        const record = await reader.get('seed');
        if (!record?.apiKey) failures.push('read a truncated/empty store');
        reads++;
      } catch (err) {
        failures.push(`read threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await writes;

    expect(reads).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('reads fine with a leftover temp file from an interrupted write', async () => {
    const store = createCredentialStore(key, file);
    await store.set('a', { apiKey: 'survivor' });
    // What a kill mid-write leaves behind: a half-written sibling. The real file
    // must be untouched by it.
    fs.writeFileSync(path.join(dir, '.credentials.enc.deadbeef.tmp'), 'partial garbage');

    expect(await store.getField('a', 'apiKey')).toBe('survivor');
    await store.set('b', { apiKey: '2' });
    expect(await createCredentialStore(key, file).getField('a', 'apiKey')).toBe('survivor');
  });
});
