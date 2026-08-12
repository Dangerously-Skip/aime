import { describe, it, expect } from 'vitest';
import { isProviderCredentialId, DECK_STORAGE_CREDENTIAL_ID } from './credential-ids';

/**
 * The publish bucket's secret shares one encrypted file with model providers
 * and connector tokens. The Settings orphan sweep asks "is this a model
 * provider's record?" and offers a one-click delete for anything it decides is
 * junk — it once decided every connector's tokens were.
 *
 * The allowlist protects this by construction (a non-UUID id is never claimed),
 * which is exactly the kind of by-construction safety that stops being true
 * when someone widens the predicate. Asserted so that change fails here.
 */
describe('the deck-storage credential is not a provider record', () => {
  it('is never classified as an orphaned provider', () => {
    expect(isProviderCredentialId(DECK_STORAGE_CREDENTIAL_ID)).toBe(false);
  });

  it('is not UUID-shaped, which is what keeps it safe', () => {
    expect(DECK_STORAGE_CREDENTIAL_ID).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('still classifies a real provider record', () => {
    expect(isProviderCredentialId('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
  });
});
