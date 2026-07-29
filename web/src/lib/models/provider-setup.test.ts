import { describe, it, expect, vi } from 'vitest';
import {
  planProviderSetup,
  executeProviderSetup,
  providerIdForPreset,
  collectFieldValues,
  missingRequiredFields,
  type ProviderSetupPlan,
} from './provider-setup';
import { getPreset } from './providers';

/**
 * The single implementation of "configure a provider", shared by Settings and
 * onboarding.
 *
 * There were two, and only one of them was ever taught about Bedrock, Vertex and
 * Azure — the same one-surface-wired shape that shipped cowork without a
 * `widget_create` handler. These tests are on the shared module rather than on
 * either screen, so both inherit them.
 */

const none: Array<{ id: string; presetId: string }> = [];
const plan = (r: ReturnType<typeof planProviderSetup>) => {
  if (!r.ok) throw new Error(`expected a plan, got: ${r.error}`);
  return r.plan;
};

describe('providerIdForPreset', () => {
  it('reuses the id already configured for this preset, so a re-run updates', () => {
    const existing = [{ id: 'uuid-or', presetId: 'openrouter' }];
    expect(providerIdForPreset('openrouter', existing)).toBe('uuid-or');
  });

  it('mints a uuid for a preset that is not configured yet', () => {
    expect(providerIdForPreset('openrouter', none)).toMatch(/^[0-9a-f-]{36}$/);
  });

  /**
   * `anthropic` is a fixed, reserved credential id everywhere else — the
   * settings mirror writes it and the orphan sweep protects it. Minting a uuid
   * as well stored the same key twice under two ids.
   */
  it('uses the preset id itself for the anthropic singleton', () => {
    expect(providerIdForPreset('anthropic', none)).toBe('anthropic');
    expect(providerIdForPreset('anthropic', [{ id: 'x', presetId: 'anthropic' }])).toBe('anthropic');
  });
});

describe('collectFieldValues', () => {
  it('keeps only what the preset declares, trimmed', () => {
    const bedrock = getPreset('bedrock')!;
    expect(collectFieldValues(bedrock, { awsRegion: '  us-east-1 ', apiKey: 'sk-leaked' }))
      .toEqual({ awsRegion: 'us-east-1' });
  });

  it('drops blanks entirely', () => {
    expect(collectFieldValues(getPreset('bedrock')!, { awsRegion: '   ' })).toEqual({});
  });
});

describe('missingRequiredFields', () => {
  it('requires the key for a key-based provider', () => {
    expect(missingRequiredFields(getPreset('openrouter')!, {})).toEqual(['apiKey']);
  });

  it.each(['bedrock', 'vertex'])('requires nothing for %s, which can use ambient creds', (id) => {
    expect(missingRequiredFields(getPreset(id)!, {})).toEqual([]);
  });

  /** A field with a working default is not missing. */
  it('does not demand a base URL the preset already defaults', () => {
    expect(missingRequiredFields(getPreset('local')!, {})).toEqual([]);
  });

  it('demands a base URL where there is no default to fall back on', () => {
    expect(missingRequiredFields(getPreset('custom')!, { apiKey: 'k' })).toEqual(['baseUrl']);
  });

  it('lets Azure default its API version but not its resource or deployment', () => {
    expect(missingRequiredFields(getPreset('azure-openai')!, {}))
      .toEqual(['apiKey', 'azureResource', 'azureDeployment']);
  });
});

describe('planProviderSetup', () => {
  it('refuses an unknown preset instead of half-configuring one', () => {
    const r = planProviderSetup({ presetId: 'nope', fields: {}, existingProviders: none });
    expect(r.ok).toBe(false);
  });

  it('reports every missing field at once, by label', () => {
    const r = planProviderSetup({ presetId: 'azure-openai', fields: {}, existingProviders: none });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('API key');
      expect(r.error).toContain('Resource name');
      expect(r.error).toContain('Deployment name');
    }
  });

  it('falls back to the preset label and default base URL', () => {
    const p = plan(planProviderSetup({ presetId: 'openrouter', fields: { apiKey: 'sk-or' }, existingProviders: none }));
    expect(p.label).toBe('OpenRouter');
    expect(p.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(p.canScan).toBe(true);
  });

  it('derives the Azure endpoint from resource + deployment rather than a typed URL', () => {
    const p = plan(planProviderSetup({
      presetId: 'azure-openai',
      fields: { apiKey: 'k', azureResource: 'my-res', azureDeployment: 'gpt-4o', azureApiVersion: '2025-01-01' },
      existingProviders: none,
    }));
    expect(p.baseUrl).toBe(
      'https://my-res.openai.azure.com/openai/deployments/gpt-4o?api-version=2025-01-01',
    );
  });

  it('marks a preset that cannot enumerate models', () => {
    expect(plan(planProviderSetup({ presetId: 'bedrock', fields: {}, existingProviders: none })).canScan)
      .toBe(false);
  });

  it('flags only anthropic for the settings mirror', () => {
    expect(plan(planProviderSetup({ presetId: 'anthropic', fields: { apiKey: 'sk-ant' }, existingProviders: none })).mirrorToSettings)
      .toBe(true);
    expect(plan(planProviderSetup({ presetId: 'openrouter', fields: { apiKey: 'sk-or' }, existingProviders: none })).mirrorToSettings)
      .toBe(false);
  });
});

describe('executeProviderSetup', () => {
  const deps = () => ({ scan: vi.fn().mockResolvedValue([{ id: 'm', label: 'M' }]), saveCredentials: vi.fn().mockResolvedValue(undefined) });

  const base: ProviderSetupPlan = {
    id: 'p1',
    presetId: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    values: { apiKey: 'sk-or' },
    mirrorToSettings: false,
    canScan: true,
  };

  it('scans, then stores', async () => {
    const d = deps();
    const models = await executeProviderSetup(base, d);
    expect(models).toEqual([{ id: 'm', label: 'M' }]);
    expect(d.scan).toHaveBeenCalledWith('openrouter', {
      apiKey: 'sk-or',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
    expect(d.saveCredentials).toHaveBeenCalledWith('p1', { apiKey: 'sk-or' });
  });

  /** A typo must not leave a provider row and a dead key behind. */
  it('stores NOTHING when the scan fails', async () => {
    const d = deps();
    d.scan.mockRejectedValue(new Error('bad key'));
    await expect(executeProviderSetup(base, d)).rejects.toThrow('bad key');
    expect(d.saveCredentials).not.toHaveBeenCalled();
  });

  it('skips the scan for a preset that cannot enumerate', async () => {
    const d = deps();
    const models = await executeProviderSetup({ ...base, presetId: 'bedrock', canScan: false, values: { awsRegion: 'us-east-1' } }, d);
    expect(models).toEqual([]);
    expect(d.scan).not.toHaveBeenCalled();
    expect(d.saveCredentials).toHaveBeenCalledWith('p1', { awsRegion: 'us-east-1' });
  });

  /**
   * baseUrl lives on the provider config, which is where execConfigFor reads it.
   * Storing it again would give a keyless local provider a credential record it
   * does not need, and put the same value in two places.
   */
  it('never writes a credential record for a base URL alone', async () => {
    const d = deps();
    await executeProviderSetup(
      { ...base, presetId: 'local', values: { baseUrl: 'http://localhost:11434/v1' } },
      d,
    );
    expect(d.saveCredentials).not.toHaveBeenCalled();
  });

  it('writes the anthropic key once, not twice', async () => {
    const d = deps();
    await executeProviderSetup(
      { ...base, id: 'anthropic', presetId: 'anthropic', values: { apiKey: 'sk-ant' }, mirrorToSettings: true },
      d,
    );
    expect(d.saveCredentials).toHaveBeenCalledTimes(1);
    expect(d.saveCredentials).toHaveBeenCalledWith('anthropic', { apiKey: 'sk-ant' });
  });

  it('mirrors to the fixed anthropic id when the provider id differs', async () => {
    const d = deps();
    await executeProviderSetup({ ...base, id: 'uuid-1', mirrorToSettings: true }, d);
    expect(d.saveCredentials).toHaveBeenCalledWith('uuid-1', { apiKey: 'sk-or' });
    expect(d.saveCredentials).toHaveBeenCalledWith('anthropic', { apiKey: 'sk-or' });
  });
});
