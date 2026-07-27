import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateAccelerator,
  formatAcceleratorForDisplay,
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
