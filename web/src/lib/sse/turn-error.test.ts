import { describe, it, expect } from 'vitest';
import { classifyTurnError, describeTurnError, mapSdkErrorKind, isTurnErrorCode, TURN_ERROR_CODES } from './turn-error';

describe('classifyTurnError', () => {
  it('recognises the SDK "not logged in" text as an auth failure', () => {
    expect(classifyTurnError('Claude Code returned an error result: Not logged in · Please run /login')).toBe('auth');
  });
  it.each([
    [401, 'auth'], [403, 'auth'], [429, 'rate_limit'], [529, 'overloaded'], [503, 'overloaded'], [402, 'billing'],
  ] as const)('maps HTTP %i to %s', (status, code) => {
    expect(classifyTurnError('whatever', status)).toBe(code);
  });
  it('recognises context-length and network failures', () => {
    expect(classifyTurnError('prompt is too long: 250000 tokens > 200000 maximum')).toBe('context_length');
    expect(classifyTurnError('fetch failed: ECONNREFUSED 127.0.0.1')).toBe('network');
  });
  it('falls back to unknown', () => {
    expect(classifyTurnError('the flux capacitor broke')).toBe('unknown');
  });
});

describe('mapSdkErrorKind', () => {
  it('maps the typed SDK kinds', () => {
    expect(mapSdkErrorKind('authentication_failed')).toBe('auth');
    expect(mapSdkErrorKind('billing_error')).toBe('billing');
    expect(mapSdkErrorKind('rate_limit')).toBe('rate_limit');
    expect(mapSdkErrorKind('server_error')).toBe('overloaded');
    expect(mapSdkErrorKind(undefined)).toBeNull();
  });

  // Added by Agent SDK 0.3.
  it.each([
    ['oauth_org_not_allowed', 'auth'],
    ['cloud_credential_error', 'auth'],
    ['account_on_hold', 'billing'],
    ['overloaded', 'overloaded'],
  ] as const)('maps %s to %s', (kind, code) => {
    expect(mapSdkErrorKind(kind)).toBe(code);
  });

  it('leaves the kinds with no honest code to the text classifier', () => {
    for (const kind of ['model_not_found', 'verification_required', 'invalid_request', 'unknown']) {
      expect(mapSdkErrorKind(kind)).toBeNull();
    }
  });

  it('does not match inherited object keys or unknown kinds', () => {
    expect(mapSdkErrorKind('toString')).toBeNull();
    expect(mapSdkErrorKind('some_future_kind')).toBeNull();
  });
});

describe('describeTurnError', () => {
  it('never tells the user to run /login, and links auth failures to API Access', () => {
    const d = describeTurnError('auth', 'Not logged in · Please run /login');
    expect(`${d.title} ${d.detail}`).not.toMatch(/\/login/);
    expect(d.action?.settingsSection).toBe('connectors');
  });
  it('describes every code', () => {
    for (const c of TURN_ERROR_CODES) {
      expect(isTurnErrorCode(c)).toBe(true);
      expect(describeTurnError(c).title.length).toBeGreaterThan(0);
    }
    expect(isTurnErrorCode('nope')).toBe(false);
  });
});
