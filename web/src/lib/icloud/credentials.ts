import 'server-only';
import { getCredentialStore } from '@/lib/models/credentials';
import type { ICloudCredentials } from './config';

/**
 * Where the iCloud credential lives.
 *
 * The same encrypted, keychain-backed store the model providers use, under a
 * fixed id — so there is no new secret-handling code to get wrong, and the
 * existing `POST /api/models/providers/credentials` endpoint is what writes it.
 * The app-specific password never travels through settings or localStorage.
 */
export const ICLOUD_PROVIDER_ID = 'icloud';

/**
 * @returns the stored credential, or `null` when iCloud is not connected.
 *
 * Never throws. An unreadable store (locked, missing key material) means "not
 * connected", not a failed turn — the tools report that plainly and the rest of
 * the turn continues, which is the same trade `withStoredCredential` makes for
 * search.
 */
export async function loadICloudCredentials(): Promise<ICloudCredentials | null> {
  try {
    const rec = await getCredentialStore().get(ICLOUD_PROVIDER_ID);
    const appleId = rec?.appleId?.trim();
    const appPassword = rec?.appPassword?.trim();
    if (!appleId || !appPassword) return null;
    return { appleId, appPassword };
  } catch {
    return null;
  }
}
