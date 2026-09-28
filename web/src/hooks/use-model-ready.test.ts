import { describe, it, expect } from 'vitest';
import { hasUsableModel } from './use-model-ready';
import { isSessionCommand } from '@/lib/slash-commands';

const access = (over: Partial<{ known: boolean; hasAnthropicKey: boolean; hasBedrock: boolean }> = {}) => ({
  known: true, hasAnthropicKey: false, hasBedrock: false, ...over,
});

describe('hasUsableModel', () => {
  it('an Anthropic key or Bedrock can serve the built-in route', () => {
    expect(hasUsableModel(null, access({ hasAnthropicKey: true }))).toBe(true);
    expect(hasUsableModel(null, access({ hasBedrock: true }))).toBe(true);
  });

  it('without one, only a route onto a user provider can answer', () => {
    expect(hasUsableModel(null, access())).toBe(false);
    // A pinned built-in with no key is not usable either.
    expect(hasUsableModel({ model: 'sonnet' }, access())).toBe(false);
    expect(
      hasUsableModel({ model: 'm', providerConfig: { providerId: 'openrouter' } as never }, access()),
    ).toBe(true);
  });

  it('does not block while the server has not answered', () => {
    expect(hasUsableModel(null, access({ known: false }))).toBe(true);
  });
});

describe('isSessionCommand', () => {
  it('recognises the client-side commands only', () => {
    expect(isSessionCommand('/think high')).toBe(true);
    expect(isSessionCommand('/help')).toBe(true);
    expect(isSessionCommand('/deploy now')).toBe(false);
    expect(isSessionCommand('hello')).toBe(false);
  });
});
