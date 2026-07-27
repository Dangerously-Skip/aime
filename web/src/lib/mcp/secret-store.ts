/**
 * Where connector secrets actually live (DR-14).
 *
 * Wraps the P1.2 keychain-backed AES-256-GCM store so the MCP paths do not each
 * have to know about key availability. The one decision encoded here is what
 * happens when there is no master key — running `next dev` outside Electron, or
 * self-hosting the web app.
 *
 * The answer is: fall back to today's behaviour (secrets inline in the 0600
 * config) and make the downgrade VISIBLE. Refusing to store credentials would
 * make connectors untestable in development; silently pretending to encrypt
 * would be worse than either. `main-web.js` already sets this precedent for the
 * headless-Linux keyring case, where it falls back and logs — consistency beats
 * inventing a second policy.
 */
import {
  getCredentialStore,
  CredentialStoreUnavailable,
  type CredentialStore,
} from '../models/credentials';
import { secretKeyForServer, type EntrySecrets } from './secrets';

export type SecretStorageMode = 'encrypted' | 'plaintext-fallback';

export interface McpSecretStore {
  mode: SecretStorageMode;
  /** Why encryption is unavailable, when mode is the fallback. */
  reason?: string;
  get(serverKey: string): Promise<EntrySecrets | undefined>;
  set(serverKey: string, secrets: EntrySecrets): Promise<void>;
  delete(serverKey: string): Promise<void>;
}

/**
 * The credential store persists flat string maps, so the structured secrets are
 * JSON-encoded into a single field. Encoding rather than flattening keeps env and
 * header names — which can be arbitrary — from colliding with the scalar fields.
 */
const BLOB_FIELD = 'secrets';

function encode(secrets: EntrySecrets): string {
  return JSON.stringify(secrets);
}

function decode(raw: string | undefined): EntrySecrets | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as EntrySecrets;
  } catch {
    return undefined;
  }
}

function encryptedStore(store: CredentialStore): McpSecretStore {
  return {
    mode: 'encrypted',
    async get(serverKey) {
      return decode(await store.getField(secretKeyForServer(serverKey), BLOB_FIELD));
    },
    async set(serverKey, secrets) {
      await store.set(secretKeyForServer(serverKey), { [BLOB_FIELD]: encode(secrets) });
    },
    async delete(serverKey) {
      await store.delete(secretKeyForServer(serverKey));
    },
  };
}

/**
 * A store that holds nothing. Callers check `mode` and keep secrets inline in the
 * config instead — the get/set here are deliberately inert rather than throwing,
 * so a missing key degrades behaviour rather than breaking requests.
 */
function fallbackStore(reason: string): McpSecretStore {
  return {
    mode: 'plaintext-fallback',
    reason,
    async get() {
      return undefined;
    },
    async set() {
      /* nothing stored — the caller writes inline */
    },
    async delete() {
      /* nothing to remove */
    },
  };
}

/**
 * Resolve the store for this process. Cheap and synchronous-ish; the underlying
 * store reads lazily, so this can be called per request.
 */
export function getMcpSecretStore(): McpSecretStore {
  try {
    return encryptedStore(getCredentialStore());
  } catch (err) {
    const reason =
      err instanceof CredentialStoreUnavailable
        ? 'No credential master key — connector secrets stay in the 0600 config file. This is expected outside the packaged app.'
        : `Credential store unavailable: ${err instanceof Error ? err.message : String(err)}`;
    return fallbackStore(reason);
  }
}

/** For /api/doctor and Settings, so the downgrade is never silent. */
export function describeSecretStorage(): { mode: SecretStorageMode; detail: string } {
  const store = getMcpSecretStore();
  return {
    mode: store.mode,
    detail:
      store.mode === 'encrypted'
        ? 'Connector tokens are encrypted at rest (AES-256-GCM, key in the OS keychain).'
        : (store.reason ?? 'Connector tokens are stored unencrypted in a 0600 file.'),
  };
}
