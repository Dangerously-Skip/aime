import { useSettingsStore } from '@/stores/settings-store';
import { useProviderStore } from '@/stores/provider-store';

/**
 * The search configuration a surface sends with each turn.
 *
 * Exists because the two halves live in different stores and the server has
 * neither: the user's choice is in settings, and whether there is a model
 * credential worth borrowing is in the provider store. Sending them separately
 * from every call site is how one of them ends up forgotten — which is exactly
 * what happened, and why `searchSettings` was plumbed through the route and the
 * provider while no client ever populated it. The whole subsystem was inert.
 *
 * Carries IDs and the user's explicit choice; never a secret. The API key for a
 * borrowed credential is resolved server-side by `withStoredCredential`.
 */
export interface SearchSettingsPayload {
  searchProvider: string | null;
  searchApiKey: string | null;
  searchInstanceUrl: string | null;
  searchCredentialProviderId: string | null;
  /**
   * A configured OpenRouter provider, if any — the input to the default-on
   * behaviour in `resolveSearchRoute`. Sent rather than derived on the server
   * because the provider list is client state.
   */
  openrouterProviderId: string | null;
  /**
   * The user's image model, or null if they have not chosen one.
   *
   * Rides this payload because it is the settings channel a turn already has,
   * and because image generation runs on the same OpenRouter credential the
   * field above identifies. Null is passed through rather than defaulted here —
   * the server decides the fallback, so there is one place that does.
   */
  imageModel: string | null;
}

export function useSearchSettings(): SearchSettingsPayload {
  const searchProvider = useSettingsStore((s) => s.searchProvider);
  const searchApiKey = useSettingsStore((s) => s.searchApiKey);
  const searchInstanceUrl = useSettingsStore((s) => s.searchInstanceUrl);
  const searchCredentialProviderId = useSettingsStore((s) => s.searchCredentialProviderId);

  const imageModel = useSettingsStore((s) => s.imageModel);

  const openrouterProviderId = useProviderStore(
    (s) =>
      s.providers.find((p) => p.enabled && p.presetId === 'openrouter' && p.hasCredentials)?.id ??
      null,
  );

  return {
    searchProvider,
    searchApiKey,
    searchInstanceUrl,
    searchCredentialProviderId,
    openrouterProviderId,
    imageModel,
  };
}
