import { vi } from 'vitest';
import { DEFAULT_PUSH_TO_TALK } from '../accelerator';

/**
 * A stand-in for main-web.js's `voice:set-push-to-talk` handler.
 *
 * It exists because a bare `vi.fn()` is how the flagship push-to-talk defect
 * shipped. The renderer's promise to main is not "call this function" — it is
 * "leave exactly one accelerator registered with the OS, owned by whoever asked
 * for it". Only a fake that models that single slot can be asserted against, so
 * this one does:
 *
 *  - ONE accelerator may be held at a time, with an owner id;
 *  - a release from a non-owner is refused;
 *  - `pressHotkey()` delivers nothing unless something is actually registered,
 *    because the OS does not deliver events for shortcuts nobody holds.
 *
 * Kept in sync with main-web.js by hand. What it cannot model is
 * `globalShortcut.register` itself, which needs a real Electron main process.
 */
export function createFakeMain({ takenByOtherApps = [] as string[] } = {}) {
  const taken = new Set(takenByOtherApps);
  let held: string | null = null;
  let heldBy: string | null = null;
  const listeners = new Set<() => void>();

  const setPushToTalkEnabled = vi.fn(
    async (enabled: boolean, accelerator?: string, ownerId?: string) => {
      const wanted = accelerator && accelerator.length > 0 ? accelerator : DEFAULT_PUSH_TO_TALK;
      const owner = ownerId ?? null;

      if (!enabled) {
        if (held && heldBy && owner && heldBy !== owner) {
          return { ok: false, accelerator: held, reason: 'not-owner' as const };
        }
        held = null;
        heldBy = null;
        return { ok: true, accelerator: null };
      }
      if (held === wanted && heldBy === owner) return { ok: true, accelerator: held };
      if (held && heldBy && owner && heldBy !== owner) {
        return {
          ok: false,
          accelerator: null,
          reason: 'owned-elsewhere' as const,
          message: 'Another window already holds a push-to-talk shortcut.',
        };
      }
      held = null;
      heldBy = null;
      if (taken.has(wanted)) {
        // globalShortcut.register returned false.
        return {
          ok: false,
          accelerator: null,
          reason: 'taken' as const,
          message: `${wanted} is already in use by another application.`,
        };
      }
      held = wanted;
      heldBy = owner;
      return { ok: true, accelerator: held };
    },
  );

  const onVoiceToggle = vi.fn((cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  });

  return {
    setPushToTalkEnabled,
    onVoiceToggle,
    get held() {
      return held;
    },
    get heldBy() {
      return heldBy;
    },
    /** Returns false when the OS would not have delivered anything. */
    pressHotkey(): boolean {
      if (!held) return false;
      for (const listener of [...listeners]) listener();
      return true;
    },
  };
}

export type FakeMain = ReturnType<typeof createFakeMain>;

/** Put the fake bridge on `window` the way the preload does. */
export function installFakeElectron(api: Partial<FakeMain> | undefined): void {
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
}

export function uninstallFakeElectron(): void {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
}
