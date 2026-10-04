import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { createPermissionGate, classifyPermission, describePermission, originOf } = require_('./permission-policy.js');

/**
 * `persist:browser` granted every permission to every site: a page the agent
 * opened got the camera, microphone and location without a prompt. These drive
 * the gate the sessions actually install — request (async, may prompt) and
 * check (sync, never prompts) — with a prompt that records what it was asked.
 */

const SITE = 'https://site.example/page?q=1';

function gate({ answer = true, isTrusted } = {}) {
  const prompt = vi.fn(async () => answer);
  return { prompt, gate: createPermissionGate({ prompt, isTrusted }) };
}

describe('deny by default', () => {
  it.each([
    'clipboard-read',
    'midi',
    'midiSysex',
    'pointerLock',
    'keyboardLock',
    'hid',
    'serial',
    'usb',
    'idle-detection',
    'display-capture',
    'window-management',
    'unknown',
    'storage-access',
  ])('denies %s without asking', async (permission) => {
    const { prompt, gate: g } = gate();
    await expect(g.request(permission, SITE)).resolves.toBe(false);
    expect(g.check(permission, SITE)).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('the safe list', () => {
  it.each(['clipboard-sanitized-write', 'fullscreen'])('grants %s without asking', async (permission) => {
    const { prompt, gate: g } = gate({ answer: false });
    await expect(g.request(permission, SITE)).resolves.toBe(true);
    expect(g.check(permission, SITE)).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('media, geolocation, notifications ask — naming the origin', () => {
  it.each(['media', 'geolocation', 'notifications', 'openExternal'])('%s prompts, and the answer decides', async (permission) => {
    const yes = gate({ answer: true });
    await expect(yes.gate.request(permission, SITE)).resolves.toBe(true);
    expect(yes.prompt).toHaveBeenCalledWith(expect.objectContaining({ origin: 'https://site.example', permission }));

    const no = gate({ answer: false });
    await expect(no.gate.request(permission, SITE)).resolves.toBe(false);
  });

  it('remembers the answer per origin for the session — one prompt, not one per request', async () => {
    const { prompt, gate: g } = gate({ answer: true });
    await g.request('media', SITE, { mediaTypes: ['audio'] });
    await g.request('media', 'https://site.example/other');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(g.check('media', 'https://site.example')).toBe(true);
  });

  it('remembers a denial too', async () => {
    const { prompt, gate: g } = gate({ answer: false });
    await g.request('geolocation', SITE);
    await expect(g.request('geolocation', SITE)).resolves.toBe(false);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('does not carry an answer to a different origin, or to a different permission', async () => {
    const { prompt, gate: g } = gate({ answer: true });
    await g.request('media', SITE);
    await g.request('media', 'https://other.example/');
    await g.request('geolocation', SITE);
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(g.check('media', 'https://evil.example')).toBe(false);
  });

  it('collapses concurrent requests into one prompt', async () => {
    let release;
    const prompt = vi.fn(() => new Promise((r) => { release = r; }));
    const g = createPermissionGate({ prompt });
    const all = Promise.all([g.request('media', SITE), g.request('media', SITE), g.request('media', SITE)]);
    await Promise.resolve();
    release(true);
    await expect(all).resolves.toEqual([true, true, true]);
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('the sync check never grants an askable permission the user has not answered', () => {
    const { prompt, gate: g } = gate({ answer: true });
    expect(g.check('media', SITE)).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('a prompt that fails is a denial', async () => {
    const g = createPermissionGate({ prompt: async () => { throw new Error('no window'); } });
    await expect(g.request('media', SITE)).resolves.toBe(false);
  });

  it.each(['data:text/html,x', 'about:blank', '', 'not a url'])('denies an opaque or unparseable origin (%s) without asking', async (url) => {
    const { prompt, gate: g } = gate({ answer: true });
    await expect(g.request('media', url)).resolves.toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('the app itself', () => {
  const isTrusted = (origin) => origin === 'http://localhost:19532';

  it('is granted without prompting (voice input needs the microphone)', async () => {
    const { prompt, gate: g } = gate({ answer: false, isTrusted });
    await expect(g.request('media', 'http://localhost:19532/chat')).resolves.toBe(true);
    expect(g.check('clipboard-read', 'http://localhost:19532')).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('a lookalike of the app is still a stranger', async () => {
    const { gate: g } = gate({ answer: false, isTrusted });
    await expect(g.request('media', 'http://localhost.evil.com:19532/')).resolves.toBe(false);
    expect(g.check('clipboard-read', 'http://localhost:19533')).toBe(false);
  });
});

describe('helpers', () => {
  it('classifyPermission is deny for anything not listed', () => {
    expect(classifyPermission('media', 'https://a.b')).toBe('ask');
    expect(classifyPermission('media', null)).toBe('deny');
    expect(classifyPermission('hid', 'https://a.b')).toBe('deny');
  });

  it('describes what is being asked for in words', () => {
    expect(describePermission('media', { mediaTypes: ['video', 'audio'] })).toBe('use your camera and microphone');
    expect(describePermission('media', { mediaTypes: ['audio'] })).toBe('use your microphone');
    expect(describePermission('geolocation')).toBe('know your location');
    expect(describePermission('openExternal', { externalURL: 'zoommtg://join?x' })).toContain('zoommtg');
  });

  it('originOf strips path and query', () => {
    expect(originOf('https://a.example:8443/x?y#z')).toBe('https://a.example:8443');
  });
});
