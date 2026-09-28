import { describe, it, expect } from 'vitest';
import { resolveExtractionModel } from './extraction-model';
import { toApiModelId } from '../models/api-model-id';

describe('resolveExtractionModel', () => {
  it('uses the built-in cheap tier, spelled as an API id', () => {
    // Not the turn's model: an Opus turn must not pay for a second Opus call.
    expect(resolveExtractionModel({ onUserProvider: false, turnModel: 'opus' })).toBe('claude-haiku-4-5');
  });

  it('never returns a bare SDK alias, which the Messages API rejects', () => {
    const model = resolveExtractionModel({ onUserProvider: false, turnModel: 'sonnet' });
    expect(['opus', 'sonnet', 'haiku', 'fable']).not.toContain(model);
  });

  it('uses the turn’s model on a user-added provider', () => {
    expect(
      resolveExtractionModel({ onUserProvider: true, turnModel: 'deepseek/deepseek-v4-pro' }),
    ).toBe('deepseek/deepseek-v4-pro');
  });

  it('resolves nothing — so extraction skips — when a user provider sent no model', () => {
    expect(resolveExtractionModel({ onUserProvider: true, turnModel: null })).toBeNull();
  });
});

describe('toApiModelId', () => {
  it('translates aliases and passes concrete ids through', () => {
    expect(toApiModelId('haiku')).toBe('claude-haiku-4-5');
    expect(toApiModelId('claude-opus-5')).toBe('claude-opus-5');
    expect(toApiModelId('anthropic/claude-sonnet-4.6')).toBe('anthropic/claude-sonnet-4.6');
  });
});
