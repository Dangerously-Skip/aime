/**
 * Moving secrets out of the persisted settings payload (settings v14).
 *
 * Settings persist to localStorage in plaintext, and three secrets lived there:
 *
 *   searchApiKey   — a search provider's key. Moves to the encrypted credential
 *                    store under `search`, which `withStoredCredential` already
 *                    reads server-side through `searchCredentialProviderId`.
 *   githubToken /  — written by nothing and read by nothing for a long time.
 *   githubUser       Dropped.
 *
 * (`anthropicApiKey` is NOT moved here — every surface still sends it with each
 * request, so removing it from the renderer needs a server-side fallback in
 * each route first. See the note on `SECRET_SETTINGS_KEYS` in settings-store.)
 *
 * ## Why two steps, and why the middle one is on disk
 *
 * `migrate` is synchronous and the credential store is behind an HTTP call, so
 * the move cannot happen inside it. And it cannot simply be deleted from state
 * and posted later: the first write after hydration rewrites the whole payload
 * WITHOUT the key, so a POST that fails (the route answers 503 under a plain
 * `next dev`, or when the keyring hiccups at launch) would destroy the only
 * copy. So migrate parks the value under its own key, and the post-hydration
 * step deletes it only once the server has confirmed the write. Until then it
 * is exactly as exposed as it was before, and it is retried every launch.
 */
import { LEGACY_STORAGE_PREFIX, storageKey } from '@/config/branding';
import { saveCredentials, SEARCH_CREDENTIAL_ID } from '@/lib/models/credentials-client';

/** Parked secrets awaiting a confirmed write to the credential store. */
export const SECRETS_TO_MOVE_KEY = storageKey('secrets-to-move');

/** Fields that must never be written to the settings payload again. */
export const DROPPED_SECRET_FIELDS = ['searchApiKey', 'githubToken', 'githubUser'] as const;

interface ParkedSecrets {
  search?: string;
}

function readParked(): ParkedSecrets {
  try {
    const raw = localStorage.getItem(SECRETS_TO_MOVE_KEY);
    return raw ? (JSON.parse(raw) as ParkedSecrets) : {};
  } catch {
    return {};
  }
}

function writeParked(p: ParkedSecrets): void {
  if (Object.keys(p).length === 0) localStorage.removeItem(SECRETS_TO_MOVE_KEY);
  else localStorage.setItem(SECRETS_TO_MOVE_KEY, JSON.stringify(p));
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * The migrate half: lift the secrets out of a persisted settings object
 * (mutating it) and park the one that moves. Safe to call on any version.
 */
export function stashSecretsForKeychain(state: Record<string, unknown>): void {
  const search = nonEmpty(state.searchApiKey);
  if (search) {
    writeParked({ ...readParked(), search });
    // Point search at where the key is going. Only when nothing else is chosen:
    // a user borrowing their OpenRouter key keeps borrowing it.
    if (!nonEmpty(state.searchCredentialProviderId)) {
      state.searchCredentialProviderId = SEARCH_CREDENTIAL_ID;
    }
  }
  for (const f of DROPPED_SECRET_FIELDS) delete state[f];
  // Removing them from the in-memory object is not enough: the migrated state
  // is only written back on the next change (and not at all while the storage
  // gate is shut), so the raw payload would keep them until then.
  scrubPayload(storageKey('settings'));
  // Pre-rename installs persisted under `nibcowork:settings`. gated-storage
  // reads it as a fallback and never deletes it.
  scrubPayload(`${LEGACY_STORAGE_PREFIX}:settings`);
}

/**
 * Delete the secret fields from a raw persisted payload, parking the search key
 * first so the scrub can never be the thing that loses it.
 */
function scrubPayload(key: string): void {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
    const s = parsed.state;
    if (!s || !DROPPED_SECRET_FIELDS.some((f) => f in s)) return;
    const search = nonEmpty(s.searchApiKey);
    if (search && !readParked().search) writeParked({ ...readParked(), search });
    for (const f of DROPPED_SECRET_FIELDS) delete s[f];
    localStorage.setItem(key, JSON.stringify(parsed));
  } catch {
    // An unparseable payload is not ours to repair.
  }
}

export type MoveResult =
  | { status: 'nothing' }
  | { status: 'moved'; ids: string[] }
  | { status: 'failed'; error: string };

/**
 * The post-hydration half: write parked secrets to the credential store and
 * forget them only once that succeeded. Idempotent; a failure leaves them
 * parked for the next launch.
 */
export async function moveSecretsToKeychain(fetchImpl: typeof fetch = fetch): Promise<MoveResult> {
  const parked = readParked();
  if (!parked.search) return { status: 'nothing' };
  try {
    await saveCredentials(SEARCH_CREDENTIAL_ID, { apiKey: parked.search }, fetchImpl);
    const rest = { ...readParked() };
    delete rest.search;
    writeParked(rest);
    return { status: 'moved', ids: [SEARCH_CREDENTIAL_ID] };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[settings] search key not moved to the credential store yet:', error);
    return { status: 'failed', error };
  }
}
