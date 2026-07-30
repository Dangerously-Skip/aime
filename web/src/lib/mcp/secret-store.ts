import 'server-only';
// ^ Reaches Node APIs (fs/os/crypto) and must never enter a client bundle.
// Without this the only thing catching a client import is `next build`, the
// slowest gate — and it caught one exactly once, after typecheck and the whole
// unit suite went green. This fails at the IMPORT SITE instead, naming the file
// that did it. If you hit it: the pure part of what you need probably belongs in
// a sibling module (see lib/models/credential-ids.ts for the pattern).

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
  probeCredentialStore,
  CredentialStoreUnavailable,
  CredentialStoreUnreadable,
  type CredentialStore,
} from '../models/credentials';
import { APP_NAME } from '@/config/branding';
import { secretKeyForServer, type EntrySecrets } from './secrets';

/**
 * - `encrypted`        — the happy path: AES-256-GCM, key from the OS keychain.
 * - `plaintext-fallback` — no master key at all; secrets stay inline in the 0600 config.
 * - `unreadable`       — there IS a blob and this key cannot decrypt it. Distinct
 *   from the fallback because the two need opposite handling: the fallback may be
 *   written to, an unreadable store must never be written over or cleared.
 */
export type SecretStorageMode = 'encrypted' | 'plaintext-fallback' | 'unreadable';

export interface McpSecretStore {
  mode: SecretStorageMode;
  /** Why encryption is unavailable, when mode is not `encrypted`. */
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

let warnedUnreadable = false;

function encryptedStore(store: CredentialStore): McpSecretStore {
  return {
    mode: 'encrypted',
    async get(serverKey) {
      try {
        return decode(await store.getField(secretKeyForServer(serverKey), BLOB_FIELD));
      } catch (err) {
        // The mode was decided by a probe, so getting here means the blob changed
        // under us (another process rewrote it with a different key). Reads happen
        // on the per-request chat path, so degrade instead of failing the request.
        if (err instanceof CredentialStoreUnreadable) {
          if (!warnedUnreadable) {
            warnedUnreadable = true;
            console.error(`[MCP] Connector secret store became unreadable: ${err.message}`);
          }
          return undefined;
        }
        throw err;
      }
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
 * A store whose blob exists but cannot be decrypted.
 *
 * Reads return nothing so the app keeps working (connectors then look
 * unconfigured and are offered for reconnect), but writes REFUSE: silently
 * accepting one is how a caller ends up stripping a secret out of the config and
 * putting it nowhere. Nothing here ever touches the file, so the credentials
 * remain recoverable if the right key turns up again.
 */
function unreadableStore(reason: string): McpSecretStore {
  const refuse = async (): Promise<never> => {
    throw new CredentialStoreUnreadable(
      `Refusing to write connector secrets: ${reason}`,
    );
  };
  return {
    mode: 'unreadable',
    reason,
    async get() {
      return undefined; // secrets unavailable — callers degrade, they do not throw
    },
    set: refuse,
    delete: refuse,
  };
}

/**
 * Resolve the store for this process. Cheap; the underlying store reads lazily,
 * so this can be called per request.
 *
 * The probe is the point. The old version wrapped only the CONSTRUCTOR, so a
 * read-time GCM failure escaped from inside every chat request ("Unsupported
 * state or unable to authenticate data") while `describeSecretStorage()` still
 * reported mode 'encrypted'. Callers also decide whether to WRITE based on `mode`
 * — migration lifts secrets out of the config on the strength of it — so the
 * answer has to be known before any of that work starts, hence a synchronous
 * probe rather than an optimistic guess.
 */
export function getMcpSecretStore(): McpSecretStore {
  let store: CredentialStore;
  try {
    store = getCredentialStore();
  } catch (err) {
    const reason =
      err instanceof CredentialStoreUnavailable
        ? 'No credential master key — connector secrets stay in the 0600 config file. This is expected outside the packaged app.'
        : `Credential store unavailable: ${err instanceof Error ? err.message : String(err)}`;
    return fallbackStore(reason);
  }

  const probe = probeCredentialStore();
  if (probe.status === 'unreadable') {
    return unreadableStore(
      `${probe.path ?? 'credentials.enc'} cannot be decrypted with the current master key ` +
        `(${probe.detail ?? 'decryption failed'}). The encrypted tokens and the key are stored ` +
        `separately, so reinstalling, deleting the app's application-support folder, or renaming ` +
        `the app leaves a new key beside old ciphertext. Reconnect the affected connectors to ` +
        `store fresh tokens; ${APP_NAME} leaves the existing file untouched, so move ` +
        `credentials.enc aside yourself if you want a clean slate.`,
    );
  }
  return encryptedStore(store);
}

/** For /api/doctor and Settings, so a downgrade is never silent. */
export function describeSecretStorage(): { mode: SecretStorageMode; detail: string } {
  const store = getMcpSecretStore();
  if (store.mode === 'encrypted') {
    return {
      mode: 'encrypted',
      detail: 'Connector tokens are encrypted at rest (AES-256-GCM, key in the OS keychain).',
    };
  }
  return {
    mode: store.mode,
    detail:
      store.reason ??
      (store.mode === 'unreadable'
        ? 'Connector tokens are encrypted but cannot be decrypted with the current master key — reconnect the affected connectors.'
        : 'Connector tokens are stored unencrypted in a 0600 file.'),
  };
}
