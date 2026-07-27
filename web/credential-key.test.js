import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { readOrCreateKey } = require_('./credential-key.js');

/**
 * The key that encrypts credentials.enc. A second, disagreeing derivation is the
 * failure this module exists to prevent: a fresh key beside old ciphertext makes
 * every stored BYOK key and connector token unreadable at once.
 *
 * safeStorage is stubbed because it is Electron-only, but the real fs is used —
 * file mode and on-disk bytes are the whole point.
 */
let dir;
const keyPath = () => join(dir, 'credential-master.key');

/** Mimics Electron: encryptString/decryptString round-trip through a wrapper. */
const keyring = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.concat([Buffer.from('WRAPPED:'), Buffer.from(s, 'utf-8')]),
  decryptString: (b) => {
    const s = b.toString('utf-8');
    if (!s.startsWith('WRAPPED:')) throw new Error('not wrapped');
    return s.slice('WRAPPED:'.length);
  },
});

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aime-key-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('readOrCreateKey', () => {
  it('mints a 32-byte hex key on first run and wraps it with the keyring', () => {
    const key = readOrCreateKey({ keyPath: keyPath(), safeStorage: keyring() });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(keyPath()).toString('utf-8')).toBe(`WRAPPED:${key}`);
  });

  it('returns the SAME key on every later call — the whole point of the module', () => {
    const first = readOrCreateKey({ keyPath: keyPath(), safeStorage: keyring() });
    const second = readOrCreateKey({ keyPath: keyPath(), safeStorage: keyring() });
    const third = readOrCreateKey({ keyPath: keyPath(), safeStorage: keyring() });
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('writes the key file 0600', () => {
    readOrCreateKey({ keyPath: keyPath(), safeStorage: keyring() });
    expect(statSync(keyPath()).mode & 0o777).toBe(0o600);
  });

  it('stores plaintext when no keyring is available, and warns', () => {
    const warnings = [];
    const key = readOrCreateKey({
      keyPath: keyPath(),
      safeStorage: keyring(false),
      warn: (m) => warnings.push(m),
    });
    expect(readFileSync(keyPath()).toString('utf-8')).toBe(key);
    expect(warnings.join(' ')).toMatch(/keyring unavailable/i);
  });

  it('reads back a plaintext key written during a keyring-less run', () => {
    // A laptop that booted once without a keyring must not orphan its own
    // credentials when the keyring returns.
    const key = readOrCreateKey({ keyPath: keyPath(), safeStorage: keyring(false) });
    const again = readOrCreateKey({ keyPath: keyPath(), safeStorage: keyring(false) });
    expect(again).toBe(key);
  });

  it('re-wraps a plaintext key once the keyring becomes available, keeping the value', () => {
    const key = readOrCreateKey({ keyPath: keyPath(), safeStorage: keyring(false) });
    const warnings = [];
    const after = readOrCreateKey({
      keyPath: keyPath(),
      safeStorage: keyring(true),
      warn: (m) => warnings.push(m),
    });
    expect(after).toBe(key); // same key — credentials stay readable
    expect(readFileSync(keyPath()).toString('utf-8')).toBe(`WRAPPED:${key}`);
    expect(warnings.join(' ')).toMatch(/re-wrapping/i);
  });

  it('throws rather than minting a new key when an existing file cannot be read', () => {
    // Silently minting here is the catastrophic case: a new key beside old
    // ciphertext makes every stored credential permanently unreadable.
    writeFileSync(keyPath(), Buffer.from('garbage-that-is-not-a-key'), { mode: 0o600 });
    expect(() =>
      readOrCreateKey({ keyPath: keyPath(), safeStorage: keyring(true) }),
    ).toThrow(/could not be decrypted/);
    // and it must not have overwritten the file
    expect(readFileSync(keyPath()).toString('utf-8')).toBe('garbage-that-is-not-a-key');
  });

  it('does not create a key file merely by being imported', () => {
    expect(existsSync(keyPath())).toBe(false);
  });
});
