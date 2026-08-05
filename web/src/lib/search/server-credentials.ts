import 'server-only';
import { getCredentialStore } from '@/lib/models/credentials';
import type { SearchRoute } from './resolve';

/**
 * Fill in a search route's API key from a credential the user already gave.
 *
 * The reported problem, in the user's words: "still required me to re-input my
 * api key in onboarding, didn't require it in settings for search". Both are
 * true and they compound — a search provider demanding a second copy of a key
 * the app is already holding reads as broken, most people will not bother, and
 * search stays unconfigured. An agent with no search is the one that guesses
 * URLs, so this is upstream of the headline bug rather than a nicety.
 *
 * OpenRouter is the case that matters: it is a model provider AND a search
 * provider (its web plugin retrieves during inference), so anyone using it for
 * inference has already supplied exactly the credential search needs.
 *
 * ## Why the key is borrowed rather than copied
 *
 * The obvious shortcut — copy the key into settings when the user picks the
 * provider — would put a plaintext secret in localStorage, which is the thing
 * the server-side credential store exists to prevent (the settings store
 * deliberately holds only a `hasCredentials` hint). So the route carries a
 * PROVIDER ID, not a secret, and the lookup happens here at the point of use.
 *
 * An explicit key typed into Settings still wins: someone may want search billed
 * to a different account than inference, and silently overriding that choice
 * would be its own small betrayal.
 */

/**
 * Return the route with `apiKey` populated, or unchanged.
 *
 * Never throws. A search route that cannot be completed degrades to "no search",
 * which the prompt layer already reports honestly — taking down the whole turn
 * over a missing optional capability would be a worse trade.
 */
export async function withStoredCredential(route: SearchRoute): Promise<SearchRoute> {
  if (route.apiKey || !route.credentialProviderId) return route;
  try {
    const key = await getCredentialStore().getField(route.credentialProviderId, 'apiKey');
    return key ? { ...route, apiKey: key } : route;
  } catch {
    // An unreadable store is a real condition (locked, missing key material)
    // and it means "no search", not "crash the request".
    return route;
  }
}
