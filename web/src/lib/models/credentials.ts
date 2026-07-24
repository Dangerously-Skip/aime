/**
 * Keychain-backed credential store (P1.2 / DR-12).
 *
 * BYOK provider secrets are stored as a single AES-256-GCM encrypted blob on
 * disk. The 32-byte key is NOT stored here — it comes from the Electron main
 * process, which holds it in the OS keychain (`safeStorage`) and injects it as
 * `AIME_CRED_KEY` when it spawns the Next server. Secrets therefore never
 * reach the renderer and are never written in plaintext.
 *
 * The crypto is pure Node; the key is injected, so the store is fully testable
 * without Electron.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDataDir } from '@/lib/app-paths';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Per-provider secret + non-secret-but-sensitive fields. */
export type CredentialRecord = Record<string, string>;
type Store = Record<string, CredentialRecord>;

export interface CredentialStore {
  /** All fields configured for a provider, or undefined if none. */
  get(providerId: string): Promise<CredentialRecord | undefined>;
  /** A single field, e.g. the API key. */
  getField(providerId: string, field: string): Promise<string | undefined>;
  /** Merge `values` into the provider's record. */
  set(providerId: string, values: CredentialRecord): Promise<void>;
  /** Remove a provider's record entirely. */
  delete(providerId: string): Promise<void>;
  /** Provider ids that have stored credentials. */
  list(): Promise<string[]>;
}

/** Raised when the store can't be used (missing/invalid key). */
export class CredentialStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreUnavailable';
  }
}

function encrypt(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function decrypt(key: Buffer, blob: Buffer): string {
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * File-backed credential store. `key` must be exactly 32 bytes. Reads are
 * lazy; the whole store is re-encrypted on each mutation (so even the set of
 * configured providers is hidden at rest).
 */
export function createCredentialStore(key: Buffer, filePath: string): CredentialStore {
  if (key.length !== 32) {
    throw new CredentialStoreUnavailable(`AES key must be 32 bytes, got ${key.length}`);
  }

  async function read(): Promise<Store> {
    let blob: Buffer;
    try {
      blob = await fs.readFile(filePath);
    } catch {
      return {}; // missing file → empty store
    }
    if (blob.length < IV_BYTES + TAG_BYTES) return {};
    // A bad key or tampered file throws from GCM — surface it, don't silently reset.
    return JSON.parse(decrypt(key, blob)) as Store;
  }

  async function write(store: Store): Promise<void> {
    await fs.writeFile(filePath, encrypt(key, JSON.stringify(store)), { mode: 0o600 });
  }

  return {
    async get(providerId) {
      return (await read())[providerId];
    },
    async getField(providerId, field) {
      return (await read())[providerId]?.[field];
    },
    async set(providerId, values) {
      const store = await read();
      store[providerId] = { ...store[providerId], ...values };
      await write(store);
    },
    async delete(providerId) {
      const store = await read();
      if (providerId in store) {
        delete store[providerId];
        await write(store);
      }
    },
    async list() {
      return Object.keys(await read());
    },
  };
}

/**
 * The process-wide store, keyed from `AIME_CRED_KEY` (hex, injected by the
 * Electron main process). Throws `CredentialStoreUnavailable` when the key is
 * absent — e.g. running `next dev` outside Electron.
 */
export function getCredentialStore(): CredentialStore {
  const hexKey = process.env.AIME_CRED_KEY;
  if (!hexKey) {
    throw new CredentialStoreUnavailable(
      'AIME_CRED_KEY is not set — credential storage requires the Electron main process',
    );
  }
  const key = Buffer.from(hexKey, 'hex');
  return createCredentialStore(key, path.join(getDataDir(), 'credentials.enc'));
}
