import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const {
  isAppUrl,
  isExternalUrl,
  classifyNavigation,
  windowOpenAction,
  isTrustedSenderUrl,
} = require_('./nav-policy.js');

/**
 * The main window carries the preload bridge (file read/write, PTY, the API
 * token). A link in a model reply navigated it to an external site, which then
 * had all of that. These hold the origin check to the letter — string-prefix
 * lookalikes especially, because `http://localhost:19532.evil.com` starts with
 * the app's origin and is not it.
 */

const PORT = 19532;
const APP = `http://localhost:${PORT}`;

describe('isAppUrl', () => {
  it.each([
    `${APP}/`,
    `${APP}/?t=abc`,
    `${APP}/chat/123#x`,
    `http://127.0.0.1:${PORT}/`,
    `http://LOCALHOST:${PORT}/`,
  ])('accepts the app: %s', (url) => {
    expect(isAppUrl(url, PORT)).toBe(true);
  });

  it.each([
    [`http://localhost:${PORT}.evil.com/`, 'lookalike host with the port as a label'],
    ['http://localhost.evil.com/', 'lookalike host'],
    [`http://localhost.evil.com:${PORT}/`, 'lookalike host on the app port'],
    [`http://127.0.0.1.evil.com:${PORT}/`, 'lookalike IP-shaped host on the app port'],
    [`http://evil.com/${APP}`, 'app origin in the path'],
    [`http://evil.com/?u=${APP}`, 'app origin in the query'],
    [`http://localhost:${PORT + 1}/`, 'another port on loopback'],
    ['http://localhost/', 'no port'],
    [`https://localhost:${PORT}/`, 'https is not how the app is served'],
    [`http://user@localhost:${PORT}/`, 'userinfo'],
    [`http://evil.com@localhost:${PORT}/`, 'userinfo spelling a host'],
    [`http://0.0.0.0:${PORT}/`, 'all-interfaces address'],
    [`http://[::1]:${PORT}/`, 'IPv6 loopback — not what the app loads'],
    [`ws://localhost:${PORT}/`, 'websocket scheme'],
    [`file:///etc/passwd`, 'file'],
    ['javascript:alert(1)', 'javascript'],
    ['', 'empty'],
    ['not a url', 'garbage'],
  ])('rejects %s (%s)', (url) => {
    expect(isAppUrl(url, PORT)).toBe(false);
  });

  it('rejects everything before the port is known', () => {
    expect(isAppUrl(`${APP}/`, null)).toBe(false);
    expect(isAppUrl(`${APP}/`, undefined)).toBe(false);
  });

  it('never accepts a url whose host is not loopback (property)', () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const host = new URL(url).hostname;
        if (host === 'localhost' || host === '127.0.0.1') return;
        expect(isAppUrl(url, PORT)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });
});

describe('classifyNavigation (main window top frame)', () => {
  it('lets the app navigate within itself', () => {
    expect(classifyNavigation(`${APP}/settings`, PORT)).toBe('allow');
    expect(classifyNavigation(`http://127.0.0.1:${PORT}/`, PORT)).toBe('allow');
  });

  it('sends http(s) and mailto to the OS instead of loading them', () => {
    expect(classifyNavigation('https://example.com/', PORT)).toBe('external');
    expect(classifyNavigation('http://example.com/', PORT)).toBe('external');
    expect(classifyNavigation(`http://localhost:${PORT}.evil.com/`, PORT)).not.toBe('allow');
    expect(classifyNavigation('mailto:someone@example.com', PORT)).toBe('external');
  });

  it.each([
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    'file:///Users/me/.ssh/id_rsa',
    'data:text/html,<script>alert(1)</script>',
    'blob:http://localhost:19532/abc',
    'about:blank',
    'vscode://file/etc/passwd',
    'zoommtg://join',
    'chrome://settings',
    '',
  ])('blocks %s', (url) => {
    expect(classifyNavigation(url, PORT)).toBe('block');
  });
});

describe('windowOpenAction', () => {
  it('never lets a window open inside the app — child windows inherit the preload', () => {
    fc.assert(
      fc.property(fc.oneof(fc.webUrl(), fc.string()), (url) => {
        expect(['external', 'deny']).toContain(windowOpenAction(url));
      }),
    );
  });

  it('opens external links in the OS browser', () => {
    expect(windowOpenAction('https://github.com/x')).toBe('external');
  });

  it.each(['about:blank', 'file:///tmp/x.html', 'javascript:1', 'data:text/html,x', 'blob:http://localhost:1/x'])(
    'denies %s (these used to open an Electron window WITH the preload)',
    (url) => {
      expect(windowOpenAction(url)).toBe('deny');
    },
  );
});

describe('isExternalUrl', () => {
  it('is exactly http, https and mailto', () => {
    expect(isExternalUrl('https://x.y')).toBe(true);
    expect(isExternalUrl('mailto:a@b.c')).toBe(true);
    expect(isExternalUrl('ftp://x.y')).toBe(false);
    expect(isExternalUrl('tel:123')).toBe(false);
  });
});

describe('isTrustedSenderUrl (IPC)', () => {
  it('trusts only a frame on the app origin', () => {
    expect(isTrustedSenderUrl(`${APP}/`, PORT)).toBe(true);
    expect(isTrustedSenderUrl('https://evil.example/', PORT)).toBe(false);
    expect(isTrustedSenderUrl('file:///Applications/AIME.app/setup-window.html', PORT)).toBe(false);
    expect(isTrustedSenderUrl(undefined, PORT)).toBe(false);
    expect(isTrustedSenderUrl(null, PORT)).toBe(false);
  });
});
