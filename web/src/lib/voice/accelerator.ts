/**
 * Validating a global hotkey before Electron sees it (P4.1).
 *
 * `globalShortcut.register` throws on a malformed accelerator, and a
 * user-configurable hotkey means malformed input is a matter of when, not if. It
 * also silently fails when another application already owns the combination, so
 * the caller needs to distinguish "you typed nonsense" from "something else has
 * this one".
 *
 * The rule worth enforcing beyond syntax: at least one modifier is REQUIRED. A
 * global shortcut of plain `V` would swallow the letter v in every application on
 * the machine — the kind of setting that makes a user think their keyboard broke.
 *
 * Pure: no Electron import, so it is testable outside the desktop app.
 */

/** Electron's modifier vocabulary, lower-cased for matching. */
const MODIFIERS = new Map<string, string>([
  ['command', 'Command'],
  ['cmd', 'Command'],
  ['control', 'Control'],
  ['ctrl', 'Control'],
  ['commandorcontrol', 'CommandOrControl'],
  ['cmdorctrl', 'CommandOrControl'],
  ['alt', 'Alt'],
  ['option', 'Option'],
  ['altgr', 'AltGr'],
  ['shift', 'Shift'],
  ['super', 'Super'],
  ['meta', 'Meta'],
]);

/** Named keys Electron accepts, beyond single characters and F-keys. */
const NAMED_KEYS = new Map<string, string>(
  [
    'Plus', 'Space', 'Tab', 'Capslock', 'Numlock', 'Scrolllock', 'Backspace', 'Delete',
    'Insert', 'Return', 'Enter', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp',
    'PageDown', 'Escape', 'Esc', 'VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack',
    'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause', 'PrintScreen',
  ].map((k) => [k.toLowerCase(), k]),
);

export type AcceleratorRejection = 'empty' | 'no-modifier' | 'unknown-key' | 'no-key' | 'duplicate';

export type AcceleratorVerdict =
  | { ok: true; accelerator: string }
  | { ok: false; reason: AcceleratorRejection; message: string };

/** Sensible default: unlikely to collide, and reachable one-handed. */
export const DEFAULT_PUSH_TO_TALK = 'CommandOrControl+Shift+Space';

function normalizeKey(token: string): string | null {
  const lower = token.toLowerCase();
  const named = NAMED_KEYS.get(lower);
  if (named) return named;
  // Single character: letters and digits are upper-cased, punctuation kept as-is.
  if (token.length === 1) return /[a-z]/i.test(token) ? token.toUpperCase() : token;
  // F1–F24
  const fkey = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower);
  if (fkey) return `F${fkey[1]}`;
  return null;
}

/**
 * Validate and normalise. Returns the canonical form Electron expects, so the
 * stored setting is stable regardless of how the user typed it.
 */
export function validateAccelerator(raw: unknown): AcceleratorVerdict {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'empty', message: 'Choose a key combination.' };
  }

  const tokens = raw
    .split('+')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  if (tokens.length === 0) {
    return { ok: false, reason: 'empty', message: 'Choose a key combination.' };
  }

  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const token of tokens) {
    const modifier = MODIFIERS.get(token.toLowerCase());
    if (modifier) {
      if (modifiers.includes(modifier)) {
        return { ok: false, reason: 'duplicate', message: `${modifier} is listed twice.` };
      }
      modifiers.push(modifier);
      continue;
    }
    const key = normalizeKey(token);
    if (!key) {
      return { ok: false, reason: 'unknown-key', message: `"${token}" is not a key Electron recognises.` };
    }
    keys.push(key);
  }

  if (keys.length === 0) {
    return { ok: false, reason: 'no-key', message: 'Add a key, not just modifiers.' };
  }
  if (keys.length > 1) {
    return {
      ok: false,
      reason: 'duplicate',
      message: `Only one non-modifier key is allowed (got ${keys.join(', ')}).`,
    };
  }
  if (modifiers.length === 0) {
    // The footgun this function exists for.
    return {
      ok: false,
      reason: 'no-modifier',
      message: 'Add a modifier such as Ctrl or Cmd — a bare key would be captured in every app.',
    };
  }

  // Canonical modifier order, so Shift+Ctrl+K and Ctrl+Shift+K store identically.
  const order = ['CommandOrControl', 'Command', 'Control', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta'];
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  return { ok: true, accelerator: [...modifiers, keys[0]].join('+') };
}

/**
 * The platform, resolved from the renderer.
 *
 * NOT `process.platform`. This module runs in the browser bundle, where Next
 * substitutes `process/browser.js` — an object with `env`, `nextTick` and a few
 * others, and no `platform` key at all. So `process.platform` was `undefined`
 * there, `isMac` was always false, and macOS Settings advertised
 * `Ctrl+Shift+Space` for a binding that is really ⌘⇧Space. Worse, the same
 * expression IS `'darwin'` during Next's server render of a client component, so
 * the two renders could disagree and produce a hydration mismatch.
 *
 * Returns Electron's vocabulary (`darwin` / `win32` / `linux`), or `''` when
 * there is nothing to read — during SSR, or in an exotic runtime. Callers that
 * are server-rendered should still pass the platform explicitly and resolve it
 * after mount, so the first client render matches the server's.
 */
export function detectPlatform(): string {
  if (typeof window === 'undefined') return '';

  // The preload bridge reports main's real process.platform.
  const fromBridge = (window as unknown as { electronAPI?: { getPlatform?: () => string } })
    .electronAPI?.getPlatform?.();
  if (typeof fromBridge === 'string' && fromBridge !== '') return fromBridge;

  if (typeof navigator === 'undefined') return '';
  const hint =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    navigator.userAgent ||
    '';
  // `darwin` covers jsdom and Electron builds that leak the OS name into the UA.
  if (/mac|darwin|iphone|ipad|ipod/i.test(hint)) return 'darwin';
  if (/win/i.test(hint)) return 'win32';
  if (/linux|x11|android|cros/i.test(hint)) return 'linux';
  return '';
}

/**
 * For display: `CommandOrControl` is protocol, not something to show a user.
 *
 * The platform defaults to an explicit function call rather than an ambient
 * global, so what it resolves to no longer depends on which bundle this file
 * ended up in.
 */
export function formatAcceleratorForDisplay(
  accelerator: string,
  platform: string = detectPlatform(),
): string {
  const isMac = platform === 'darwin';
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl';
      if (part === 'Command' || part === 'Meta' || part === 'Super') return isMac ? '⌘' : 'Win';
      if (part === 'Control') return isMac ? '⌃' : 'Ctrl';
      if (part === 'Alt' || part === 'Option') return isMac ? '⌥' : 'Alt';
      if (part === 'Shift') return isMac ? '⇧' : 'Shift';
      return part;
    })
    .join(isMac ? '' : '+');
}
