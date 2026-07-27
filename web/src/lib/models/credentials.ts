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
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import { readFileSync, statSync } from 'fs';
import * as path from 'path';
import { getDataDir } from '@/lib/app-paths';

const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Owner-only file; owner-only directory. Both are load-bearing, not cosmetic. */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

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

/**
 * Raised when the blob exists but this key cannot decrypt it — a wrong key or a
 * tampered/corrupt file. Distinct from `CredentialStoreUnavailable` so callers
 * can tell "no store configured" from "there IS a store and we can't read it",
 * which are opposite situations: the first may be written to, the second must not.
 */
export class CredentialStoreUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreUnreadable';
  }
}

/**
 * Serialises read-modify-write, keyed by the credential FILE rather than by store
 * instance: `getCredentialStore()` builds a fresh store on every call (several
 * times per chat request), so an instance-scoped lock would have serialised
 * nothing at all.
 *
 * What this covers: every mutation issued from THIS Node process — overlapping
 * chat/cowork streams, a cron run landing mid-message, a Settings key save racing
 * a connector refresh. Those are the races that actually happen, because one
 * server process owns all of them.
 *
 * What it does NOT cover: two SEPARATE processes on the same file — the packaged
 * app and a `npm run electron:dev` server both pointing at ~/.aime, or two app
 * copies running at once. Nothing here gives them mutual exclusion; that would
 * need an OS-level lock (an O_EXCL lockfile with stale detection, or flock). What
 * they do get is the atomic rename below: the loser's whole record set replaces
 * the winner's (last writer wins) instead of either file being left truncated.
 */
const fileLocks = new Map<string, Promise<unknown>>();

function withFileLock<T>(filePath: string, op: () => Promise<T>): Promise<T> {
  const lockKey = path.resolve(filePath);
  const previous = fileLocks.get(lockKey) ?? Promise.resolve();
  // `then(op, op)` — a failed predecessor must not wedge the queue forever.
  const run = previous.then(op, op);
  const settled = run.then(
    () => {},
    () => {},
  );
  fileLocks.set(lockKey, settled);
  void settled.then(() => {
    // Drop the entry once the queue drains, so the map cannot grow unbounded.
    if (fileLocks.get(lockKey) === settled) fileLocks.delete(lockKey);
  });
  return run;
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

/** Decode a blob, or throw `CredentialStoreUnreadable`. Shared by the async and sync paths. */
function decodeStore(key: Buffer, blob: Buffer): Store {
  if (blob.length < IV_BYTES + TAG_BYTES) return {}; // truncated/empty → nothing stored yet
  try {
    // A bad key or tampered file throws from GCM — surface it, don't silently reset.
    return JSON.parse(decrypt(key, blob)) as Store;
  } catch (err) {
    throw new CredentialStoreUnreadable(
      `credentials.enc cannot be decrypted with this master key: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * File-backed credential store. `key` must be exactly 32 bytes. Reads are
 * lazy; the whole store is re-encrypted on each mutation (so even the set of
 * configured providers is hidden at rest).
 *
 * Mutations are serialised per file and land via a temp file + rename, because
 * this single blob holds every BYOK provider key AND every connector's secrets
 * and is mutated on the per-request chat path.
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
    return decodeStore(key, blob);
  }

  /**
   * Atomic replace: write the full blob to a sibling temp file, fsync it, then
   * rename over the target. A plain `writeFile` opens with O_TRUNC, so a kill (or
   * a concurrent reader) in the window between truncate and write sees a
   * zero-length or half-written file — every stored credential gone. rename() is
   * atomic on POSIX and replaces the target on Windows, so a reader observes
   * either the whole old file or the whole new one.
   *
   * Not fsynced: the containing directory. A power loss immediately after the
   * rename can therefore still lose the *newest* write on some filesystems; what
   * is guaranteed is that the file is never a partial blob.
   */
  async function write(store: Store): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
    const payload = encrypt(key, JSON.stringify(store));
    const tmp = path.join(
      dir,
      `.${path.basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`,
    );
    try {
      const handle = await fs.open(tmp, 'wx', FILE_MODE);
      try {
        await handle.writeFile(payload);
        await handle.sync(); // the rename is only useful if the bytes are on disk
      } finally {
        await handle.close();
      }
      // `open` masks its mode with the umask; the secret file must be 0600 flat.
      await fs.chmod(tmp, FILE_MODE);
      await fs.rename(tmp, filePath);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  return {
    async get(providerId) {
      return (await read())[providerId];
    },
    async getField(providerId, field) {
      return (await read())[providerId]?.[field];
    },
    async set(providerId, values) {
      // Locked: read → mutate → write is not atomic on its own, and two
      // concurrent setters would each write a snapshot missing the other's record.
      return withFileLock(filePath, async () => {
        const store = await read();
        store[providerId] = { ...store[providerId], ...values };
        await write(store);
      });
    },
    async delete(providerId) {
      return withFileLock(filePath, async () => {
        const store = await read();
        if (providerId in store) {
          delete store[providerId];
          await write(store);
        }
      });
    },
    async list() {
      return Object.keys(await read());
    },
  };
}

/** Result of a readability probe. */
export type CredentialStoreStatus = 'ok' | 'empty' | 'unavailable' | 'unreadable';

export interface CredentialStoreProbe {
  status: CredentialStoreStatus;
  /** The blob's path, when there is one. */
  path?: string;
  /** Why, for 'unreadable' / 'unavailable'. */
  detail?: string;
}

/** Memo of the last probe per file, invalidated by the file's identity changing. */
const probeCache = new Map<
  string,
  { keyId: string; ino: number; mtimeMs: number; size: number; probe: CredentialStoreProbe }
>();

/** Identifies a key without keeping it around. */
function keyFingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Can this key actually read this blob? Synchronous ON PURPOSE.
 *
 * Callers decide whether it is safe to WRITE based on the answer (see
 * `getMcpSecretStore`), and that decision has to be made before any secret is
 * lifted out of a config file — an optimistic "probably encrypted" that turns out
 * wrong destroys credentials. An async probe would leave the decision racing the
 * work it is meant to gate.
 *
 * Memoised on the file's identity (inode + mtime + size) plus a fingerprint of the
 * key, so the common case costs one `stat` rather than a decrypt. Every write
 * lands on a new inode (temp + rename), so the memo self-invalidates.
 */
export function probeCredentialFile(key: Buffer, filePath: string): CredentialStoreProbe {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(filePath);
  } catch {
    return { status: 'empty', path: filePath }; // nothing stored yet
  }

  const cacheKey = path.resolve(filePath);
  const keyId = keyFingerprint(key);
  const cached = probeCache.get(cacheKey);
  if (
    cached &&
    cached.keyId === keyId &&
    cached.ino === stat.ino &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size
  ) {
    return cached.probe;
  }

  let probe: CredentialStoreProbe;
  try {
    const store = decodeStore(key, readFileSync(filePath));
    probe = {
      status: Object.keys(store).length === 0 ? 'empty' : 'ok',
      path: filePath,
    };
  } catch (err) {
    probe = {
      status: 'unreadable',
      path: filePath,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  probeCache.set(cacheKey, {
    keyId,
    ino: stat.ino,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    probe,
  });
  return probe;
}

/** Where the process-wide blob lives. */
export function getCredentialFilePath(): string {
  return path.join(getDataDir(), 'credentials.enc');
}

/** The key Electron injected, or a `CredentialStoreUnavailable` describing why not. */
function requireMasterKey(): Buffer {
  const hexKey = process.env.AIME_CRED_KEY;
  if (!hexKey) {
    throw new CredentialStoreUnavailable(
      'AIME_CRED_KEY is not set — credential storage requires the Electron main process',
    );
  }
  return Buffer.from(hexKey, 'hex');
}

/**
 * The process-wide store, keyed from `AIME_CRED_KEY` (hex, injected by the
 * Electron main process). Throws `CredentialStoreUnavailable` when the key is
 * absent — e.g. running `next dev` outside Electron.
 */
export function getCredentialStore(): CredentialStore {
  return createCredentialStore(requireMasterKey(), getCredentialFilePath());
}

/**
 * Probe the process-wide store. 'unavailable' when there is no key at all,
 * 'unreadable' when there is a blob the key cannot decrypt — which happens for
 * real, because the ciphertext lives in ~/.aime while the master key lives in
 * Electron's userData, and main-web.js mints a fresh random key whenever the key
 * file is missing (reinstall, deleted Application Support, renamed product).
 */
export function probeCredentialStore(): CredentialStoreProbe {
  let key: Buffer;
  try {
    key = requireMasterKey();
  } catch (err) {
    return { status: 'unavailable', detail: err instanceof Error ? err.message : String(err) };
  }
  if (key.length !== 32) {
    return {
      status: 'unavailable',
      detail: `AES key must be 32 bytes, got ${key.length}`,
    };
  }
  return probeCredentialFile(key, getCredentialFilePath());
}

/**
 * The Anthropic key available to SERVER-SIDE unattended work (schedulers,
 * verify passes). Env wins; otherwise the key the Settings UI mirrored into
 * the credential store under providerId 'anthropic'. Returns undefined when
 * neither exists — callers let the provider fail with its normal error.
 */
export async function getServerAnthropicKey(): Promise<string | undefined> {
  if (process.env.ANTHROPIC_API_KEY) return undefined; // provider reads env itself
  try {
    return await getCredentialStore().getField('anthropic', 'apiKey');
  } catch {
    return undefined;
  }
}
