import { describe, it, expect } from 'vitest';
import { providerIdForPreset } from './step-providers';

/**
 * Regression: every "Save & verify" minted a fresh `crypto.randomUUID()`, so a
 * user who re-ran onboarding (or just pressed the button twice) got another
 * provider row AND another copy of their API key in `~/.aime/credentials.enc`
 * under an id nothing would ever look up. One store had ~12 such records.
 */
describe('providerIdForPreset', () => {
  const existing = [
    { id: 'uuid-openrouter', presetId: 'openrouter' },
    { id: 'uuid-local', presetId: 'local' },
  ];

  it('reuses the id already configured for this preset, so a re-run updates', () => {
    expect(providerIdForPreset('openrouter', existing)).toBe('uuid-openrouter');
    expect(providerIdForPreset('local', existing)).toBe('uuid-local');
  });

  it('mints a new id for a preset that is not configured yet', () => {
    const id = providerIdForPreset('openrouter', []);
    expect(id).not.toBe('uuid-openrouter');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is stable across repeated calls — the point of the fix', () => {
    const first = providerIdForPreset('groq', []);
    const after = [...existing, { id: first, presetId: 'groq' }];
    expect(providerIdForPreset('groq', after)).toBe(first);
    expect(providerIdForPreset('groq', after)).toBe(first);
  });
});
