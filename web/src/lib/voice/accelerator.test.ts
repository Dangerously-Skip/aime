// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  validateAccelerator,
  formatAcceleratorForDisplay,
  detectPlatform,
  DEFAULT_PUSH_TO_TALK,
} from './accelerator';

const ok = (raw: string) => {
  const v = validateAccelerator(raw);
  if (!v.ok) throw new Error(`expected ${raw} to pass: ${v.message}`);
  return v.accelerator;
};
const reason = (raw: unknown) => {
  const v = validateAccelerator(raw);
  return v.ok ? null : v.reason;
};

describe('validateAccelerator — accepted forms', () => {
  it('accepts the default', () => {
    expect(ok(DEFAULT_PUSH_TO_TALK)).toBe(DEFAULT_PUSH_TO_TALK);
  });

  it('accepts ordinary combinations', () => {
    expect(ok('CommandOrControl+Shift+V')).toBe('CommandOrControl+Shift+V');
    expect(ok('Ctrl+Alt+K')).toBe('Control+Alt+K');
    expect(ok('Cmd+F5')).toBe('Command+F5');
    expect(ok('Alt+Space')).toBe('Alt+Space');
  });

  it('normalises case and whitespace so the stored value is stable', () => {
    expect(ok('ctrl + shift + v')).toBe('Control+Shift+V');
    expect(ok('CTRL+SHIFT+V')).toBe('Control+Shift+V');
  });

  it('canonicalises modifier order', () => {
    // Shift+Ctrl+K and Ctrl+Shift+K must store identically.
    expect(ok('Shift+Ctrl+K')).toBe(ok('Ctrl+Shift+K'));
  });

  it('accepts F1 through F24 but not F25', () => {
    expect(ok('Ctrl+F1')).toBe('Control+F1');
    expect(ok('Ctrl+F24')).toBe('Control+F24');
    expect(reason('Ctrl+F25')).toBe('unknown-key');
  });

  it('accepts named keys', () => {
    for (const key of ['Space', 'Tab', 'Enter', 'Escape', 'Up', 'PageDown', 'Delete']) {
      expect(ok(`Ctrl+${key}`), key).toContain(key);
    }
  });
});

describe('validateAccelerator — the footgun it exists for', () => {
  it('refuses a bare key with no modifier', () => {
    // A global shortcut of plain V would swallow the letter v in every app.
    expect(reason('V')).toBe('no-modifier');
    expect(reason('Space')).toBe('no-modifier');
    expect(reason('F5')).toBe('no-modifier');
  });

  it('says why, in terms a user can act on', () => {
    const v = validateAccelerator('V');
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.message).toMatch(/captured in every app/);
  });
});

describe('validateAccelerator — rejected forms', () => {
  it('refuses modifiers with no key', () => {
    expect(reason('Ctrl')).toBe('no-key');
    expect(reason('Ctrl+Shift')).toBe('no-key');
  });

  it('refuses two non-modifier keys', () => {
    expect(reason('Ctrl+A+B')).toBe('duplicate');
  });

  it('refuses a repeated modifier', () => {
    expect(reason('Ctrl+Ctrl+A')).toBe('duplicate');
    expect(reason('Ctrl+Control+A')).toBe('duplicate');
  });

  it('refuses an unrecognised key name', () => {
    expect(reason('Ctrl+NotAKey')).toBe('unknown-key');
    expect(reason('Ctrl+F0')).toBe('unknown-key');
  });

  it('refuses empty and non-string input', () => {
    for (const v of ['', '   ', '+', '++', undefined, null, 42, {}]) {
      expect(reason(v), String(v)).toBe('empty');
    }
  });
});

describe('validateAccelerator — properties', () => {
  it('never throws, for any input', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constant(undefined), fc.constant(null), fc.integer()),
        (input) => {
          expect(() => validateAccelerator(input)).not.toThrow();
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('every accepted accelerator has at least one modifier and exactly one key', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const v = validateAccelerator(input);
        if (!v.ok) return;
        const parts = v.accelerator.split('+');
        expect(parts.length).toBeGreaterThanOrEqual(2);
        // the last part is the key; everything before it is a modifier
        const mods = parts.slice(0, -1);
        expect(new Set(mods).size).toBe(mods.length);
      }),
      { numRuns: 1000 },
    );
  });

  it('validation is idempotent — re-validating a canonical form returns it unchanged', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const first = validateAccelerator(input);
        if (!first.ok) return;
        const second = validateAccelerator(first.accelerator);
        expect(second.ok && second.accelerator).toBe(first.accelerator);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('formatAcceleratorForDisplay', () => {
  it('uses mac glyphs on darwin', () => {
    expect(formatAcceleratorForDisplay('CommandOrControl+Shift+Space', 'darwin')).toBe('⌘⇧Space');
    expect(formatAcceleratorForDisplay('Control+Alt+K', 'darwin')).toBe('⌃⌥K');
  });

  it('uses words elsewhere', () => {
    expect(formatAcceleratorForDisplay('CommandOrControl+Shift+Space', 'win32')).toBe('Ctrl+Shift+Space');
  });

  it('never shows the protocol name CommandOrControl to a user', () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      expect(formatAcceleratorForDisplay(DEFAULT_PUSH_TO_TALK, platform)).not.toContain(
        'CommandOrControl',
      );
    }
  });
});

/**
 * DEFECT 5 regression: the default platform argument was `process.platform`,
 * which does not exist in Next's client bundle — it substitutes
 * `process/browser.js`, an object with no `platform` key at all. So `platform`
 * was `undefined`, `isMac` was always false, and macOS Settings advertised
 * `Ctrl+Shift+Space` for a binding that is really ⌘⇧Space.
 *
 * NOT covered here: the webpack substitution itself. Note also that vitest runs
 * in node, where `process.platform` DOES exist — so a "no explicit argument on
 * darwin" assertion cannot fail on a darwin host under vitest even with the old
 * code. The test that pins the actual fix is "never reads the ambient
 * process.platform", which makes the bridge disagree with the host and checks
 * that the bridge wins. `e2e/push-to-talk.spec.ts` then confirms the label in a
 * real browser bundle.
 */
describe('detectPlatform — resolving the platform in the renderer', () => {
  function setBridge(getPlatform: (() => string) | undefined) {
    (window as unknown as { electronAPI?: { getPlatform?: () => string } }).electronAPI =
      getPlatform ? { getPlatform } : undefined;
  }
  function setNavigator(values: { platform?: string; userAgent?: string }) {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(navigator, key, { configurable: true, value });
    }
  }

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    setNavigator({ platform: '', userAgent: 'test-agent' });
  });

  it('prefers the Electron bridge, which reports the real process platform', () => {
    setBridge(() => 'darwin');
    expect(detectPlatform()).toBe('darwin');
  });

  it('formats mac glyphs with NO explicit argument on darwin', () => {
    // The whole defect in one assertion: the default has to work on its own,
    // because that is how every call site uses it.
    setBridge(() => 'darwin');
    expect(formatAcceleratorForDisplay(DEFAULT_PUSH_TO_TALK)).toBe('⌘⇧Space');
    expect(formatAcceleratorForDisplay('Control+Alt+K')).toBe('⌃⌥K');
  });

  it('falls back to the user agent in a plain browser', () => {
    setBridge(undefined);
    setNavigator({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)' });
    expect(detectPlatform()).toBe('darwin');
    expect(formatAcceleratorForDisplay(DEFAULT_PUSH_TO_TALK)).toBe('⌘⇧Space');

    setNavigator({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
    expect(detectPlatform()).toBe('win32');
    expect(formatAcceleratorForDisplay(DEFAULT_PUSH_TO_TALK)).toBe('Ctrl+Shift+Space');
  });

  it('never reads the ambient process.platform', () => {
    // Proof the source is the renderer: the bridge disagrees with the host and
    // the bridge wins — both for detection and for the label the user reads.
    const notTheHostPlatform = process.platform === 'darwin' ? 'win32' : 'darwin';
    setBridge(() => notTheHostPlatform);
    expect(detectPlatform()).toBe(notTheHostPlatform);
    expect(formatAcceleratorForDisplay(DEFAULT_PUSH_TO_TALK)).toBe(
      notTheHostPlatform === 'darwin' ? '⌘⇧Space' : 'Ctrl+Shift+Space',
    );
  });

  it('degrades to non-mac labels when the platform is unknowable', () => {
    setBridge(undefined);
    setNavigator({ platform: '', userAgent: '' });
    expect(detectPlatform()).toBe('');
    // Words, not glyphs — wrong-but-legible beats a ⌘ shown to a Windows user.
    expect(formatAcceleratorForDisplay(DEFAULT_PUSH_TO_TALK)).toBe('Ctrl+Shift+Space');
  });
});
