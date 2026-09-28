import { describe, it, expect } from 'vitest';
import { classifyLoadError, isUserVisibleLoadFailure, ERR_ABORTED } from './load-error';

describe('isUserVisibleLoadFailure', () => {
  it('ignores ERR_ABORTED — ordinary redirects fire it', () => {
    expect(isUserVisibleLoadFailure({ errorCode: ERR_ABORTED, isMainFrame: true })).toBe(false);
  });
  it('ignores sub-frame failures', () => {
    expect(isUserVisibleLoadFailure({ errorCode: -105, isMainFrame: false })).toBe(false);
  });
  it('shows a main-frame failure', () => {
    expect(isUserVisibleLoadFailure({ errorCode: -105, isMainFrame: true })).toBe(true);
    // Older Electron omits isMainFrame on some events; treat as main.
    expect(isUserVisibleLoadFailure({ errorCode: -106 })).toBe(true);
  });
  it('ignores non-errors', () => {
    expect(isUserVisibleLoadFailure({ errorCode: 0 })).toBe(false);
    expect(isUserVisibleLoadFailure({})).toBe(false);
  });
});

describe('classifyLoadError', () => {
  it.each([
    [-105, 'dns'],
    [-137, 'dns'],
    [-106, 'offline'],
    [-21, 'offline'],
    [-202, 'tls'],
    [-201, 'tls'],
    [-107, 'tls'],
    [-102, 'refused'],
    [-118, 'timeout'],
    [-324, 'generic'],
  ] as const)('%i → %s', (code, kind) => {
    expect(classifyLoadError(code, 'ERR_X', 'https://x.test').kind).toBe(kind);
  });

  it('keeps the URL and Chromium’s own description for the overlay', () => {
    const f = classifyLoadError(-105, 'ERR_NAME_NOT_RESOLVED', 'https://nope.invalid/');
    expect(f).toMatchObject({ url: 'https://nope.invalid/', description: 'ERR_NAME_NOT_RESOLVED', code: -105 });
    expect(f.title).toBeTruthy();
    expect(f.hint).toBeTruthy();
  });
});
