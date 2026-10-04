/**
 * The browser's side of the credential store: `/api/models/providers/credentials`.
 *
 * Client-safe (no `fs`), so any Settings or onboarding component can import it.
 * There were four copies of these fetches — onboarding, the provider manager,
 * the API-key card and the sharing section — and they disagreed about failure:
 * two surfaced the server's error, one swallowed it (`.catch(() => {})`), and the
 * key card never looked at the response at all. The 503 the route returns when
 * the server has no master key (always, under a plain `next dev`) therefore
 * read as "saved" in one place and as nothing whatsoever in another.
 *
 * Every helper here THROWS on failure, with a message fit to show a person.
 */

/** Where a search provider's own API key lives in the credential store. */
export const SEARCH_CREDENTIAL_ID = 'search';

const ENDPOINT = '/api/models/providers/credentials';

/**
 * Shown when the server answers 503. Deliberately says what to DO: the usual
 * cause inside the desktop app is a keyring hiccup at launch, fixed by a
 * restart; outside it, `next dev` has no keyring at all.
 */
export const CREDENTIAL_STORE_UNAVAILABLE_HINT =
  'Keys cannot be saved right now: the app could not get its encryption key from your OS ' +
  'keychain. Restart the app and try again. (A plain `next dev` server has no keychain, so ' +
  'this is expected there.)';

/** Raised for a 503 from the credential route — "no master key", not "bad input". */
export class CredentialStoreUnavailableError extends Error {
  constructor(message = CREDENTIAL_STORE_UNAVAILABLE_HINT) {
    super(message);
    this.name = 'CredentialStoreUnavailableError';
  }
}

async function failure(res: Response, fallback: string): Promise<Error> {
  if (res.status === 503) return new CredentialStoreUnavailableError();
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return new Error(typeof body.error === 'string' && body.error ? body.error : `${fallback} (${res.status})`);
}

/** Store (merge) fields for a credential id. Never returns the values. */
export async function saveCredentials(
  providerId: string,
  values: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, values }),
  });
  if (!res.ok) throw await failure(res, 'Could not store the key');
}

/** Remove a credential id's whole record. */
export async function deleteCredentials(
  providerId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(ENDPOINT, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId }),
  });
  if (!res.ok) throw await failure(res, 'Could not remove the key');
}

/** Ids that have a stored record. Ids only — never values. */
export async function listCredentialIds(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const res = await fetchImpl(ENDPOINT);
  if (!res.ok) throw await failure(res, 'Could not read stored keys');
  const data = (await res.json().catch(() => ({}))) as { providerIds?: unknown };
  return Array.isArray(data.providerIds) ? data.providerIds.filter((x): x is string => typeof x === 'string') : [];
}
