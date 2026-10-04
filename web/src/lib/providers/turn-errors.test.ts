import { describe, it, expect } from 'vitest';
import {
  classifyThrownTurnError,
  cleanSdkErrorText,
  codeForRetry,
  codeForSdkError,
  sdkErrorKindOf,
} from './turn-errors';

describe('cleanSdkErrorText', () => {
  it('drops the CLI login advice and the SDK throw prefix', () => {
    expect(cleanSdkErrorText('Not logged in · Please run /login')).toBe('Not logged in');
    expect(
      cleanSdkErrorText('Claude Code returned an error result: Invalid API key · Please run /login'),
    ).toBe('Invalid API key');
  });

  // The exact text the 0.3 CLI produced for a 401 in the provider smoke.
  it('drops the CLI’s "Fix external API key" advice', () => {
    expect(cleanSdkErrorText('Invalid API key · Fix external API key')).toBe('Invalid API key');
  });

  it('leaves other text alone', () => {
    expect(cleanSdkErrorText('Overloaded')).toBe('Overloaded');
  });
});

describe('sdkErrorKindOf', () => {
  it('prefers the typed field', () => {
    expect(sdkErrorKindOf({ error: 'billing_error' }, 'anything')).toBe('billing_error');
  });

  it('recognises an untyped synthetic login message', () => {
    expect(sdkErrorKindOf({ message: { model: '<synthetic>' } }, 'Not logged in · Please run /login')).toBe('unknown');
  });

  it('never flags a real model reply', () => {
    expect(sdkErrorKindOf({ message: { model: 'claude-sonnet-5' } }, 'Please run /login')).toBeNull();
    expect(sdkErrorKindOf({ message: { model: '<synthetic>' } }, 'No response requested.')).toBeNull();
  });
});

describe('codes', () => {
  it('maps typed SDK kinds, falling back to the text', () => {
    expect(codeForSdkError('authentication_failed', '')).toBe('auth');
    expect(codeForSdkError('invalid_request', 'prompt is too long')).toBe('context_length');
    expect(codeForSdkError('unknown', 'Invalid API key · Please run /login')).toBe('auth');
  });

  it('maps retries by kind, then status; no status is a connection failure', () => {
    expect(codeForRetry('rate_limit', 429)).toBe('rate_limit');
    expect(codeForRetry('unknown', 529)).toBe('overloaded');
    expect(codeForRetry('unknown', 500)).toBe('overloaded');
    expect(codeForRetry('unknown', null)).toBe('network');
  });
});

describe('classifyThrownTurnError', () => {
  it('reads an HTTP status off the error', () => {
    expect(classifyThrownTurnError(Object.assign(new Error('boom'), { status: 429 }))).toEqual({
      code: 'rate_limit',
      message: 'boom',
    });
  });

  it('trusts a code the provider already decided', () => {
    const err = Object.assign(new Error('weird'), { turnErrorCode: 'overloaded' });
    expect(classifyThrownTurnError(err).code).toBe('overloaded');
  });

  it('reads a Node network code', () => {
    const err = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' });
    expect(classifyThrownTurnError(err).code).toBe('network');
  });

  it('strips the SDK prefix and login advice from the message', () => {
    const { code, message } = classifyThrownTurnError(
      new Error('Claude Code returned an error result: Not logged in · Please run /login'),
    );
    expect(code).toBe('auth');
    expect(message).toBe('Not logged in');
  });

  it('falls back to unknown', () => {
    expect(classifyThrownTurnError('something odd')).toEqual({ code: 'unknown', message: 'something odd' });
  });
});
