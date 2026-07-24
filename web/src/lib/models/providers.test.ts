import { describe, it, expect } from 'vitest';
import {
  PROVIDER_PRESETS,
  getPreset,
  presetsForCapability,
  needsApiKey,
} from './providers';

describe('provider catalog integrity', () => {
  it('includes the providers we ship', () => {
    const ids = PROVIDER_PRESETS.map((p) => p.id);
    for (const id of ['anthropic', 'openai', 'google', 'groq', 'openrouter', 'bedrock', 'azure-openai', 'fal']) {
      expect(ids, `missing preset: ${id}`).toContain(id);
    }
  });

  it('every preset has required metadata and unique id', () => {
    const seen = new Set<string>();
    for (const p of PROVIDER_PRESETS) {
      expect(p.id, 'id').toBeTruthy();
      expect(p.label, `${p.id} label`).toBeTruthy();
      expect(p.capabilities.length, `${p.id} capabilities`).toBeGreaterThan(0);
      expect(seen.has(p.id), `duplicate id: ${p.id}`).toBe(false);
      seen.add(p.id);
    }
  });

  it('maps each provider to the right transport', () => {
    const byId = Object.fromEntries(PROVIDER_PRESETS.map((p) => [p.id, p]));
    expect(byId.anthropic.transport).toBe('anthropic-native');
    expect(byId.openrouter.transport).toBe('anthropic-native');
    expect(byId.bedrock.transport).toBe('anthropic-native');
    expect(byId.openai.transport).toBe('openai-compat');
    expect(byId.groq.transport).toBe('openai-compat');
    expect(byId.google.transport).toBe('openai-compat');
    expect(byId['azure-openai'].transport).toBe('openai-compat');
    expect(byId.fal.transport).toBe('native-fal');
  });

  it('only fal is capability-only (agentMode none)', () => {
    for (const p of PROVIDER_PRESETS) {
      if (p.transport === 'native-fal') {
        expect(p.agentMode).toBe('none');
      } else {
        expect(p.agentMode).not.toBe('none');
      }
    }
  });

  it('scannable presets declare a path (except fal-static)', () => {
    for (const p of PROVIDER_PRESETS) {
      if (p.scan && p.scan.shape !== 'fal-static') {
        expect(p.scan.path, `${p.id} scan path`).toBeTruthy();
      }
    }
  });

  it('anthropic scans via x-api-key; openai-shape via bearer', () => {
    expect(getPreset('anthropic')!.scan!.auth).toBe('x-api-key');
    expect(getPreset('openrouter')!.scan!.auth).toBe('bearer');
    expect(getPreset('openai')!.scan!.auth).toBe('bearer');
  });

  it('bedrock/vertex/azure have no scan (manual entry)', () => {
    expect(getPreset('bedrock')!.scan).toBeUndefined();
    expect(getPreset('vertex')!.scan).toBeUndefined();
    expect(getPreset('azure-openai')!.scan).toBeUndefined();
  });
});

describe('helpers', () => {
  it('getPreset finds by id', () => {
    expect(getPreset('openrouter')?.label).toBe('OpenRouter');
    expect(getPreset('nope')).toBeUndefined();
  });

  it('presetsForCapability filters', () => {
    const imageProviders = presetsForCapability('image').map((p) => p.id);
    expect(imageProviders).toContain('fal');
    expect(imageProviders).toContain('openai');
    expect(imageProviders).not.toContain('groq'); // chat/code only
  });

  it('needsApiKey reflects the credential fields', () => {
    expect(needsApiKey(getPreset('anthropic')!)).toBe(true);
    expect(needsApiKey(getPreset('local')!)).toBe(false); // baseUrl only
    expect(needsApiKey(getPreset('bedrock')!)).toBe(false); // AWS creds, not apiKey
  });
});
