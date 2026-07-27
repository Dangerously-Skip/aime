// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { usePushToTalk } from './use-push-to-talk';
import { DEFAULT_PUSH_TO_TALK } from '@/lib/voice/accelerator';
import { getVoiceSnapshot, resetVoiceSession, registerTranscriptSink } from '@/lib/voice/voice-session';
import { installFakeMediaStack, type FakeMediaStack } from '@/lib/voice/__fixtures__/fake-media';
import {
  createFakeMain,
  installFakeElectron,
  uninstallFakeElectron,
  type FakeMain,
} from '@/lib/voice/__fixtures__/fake-main';

/**
 * Push-to-talk: the renderer half of the contract with Electron main.
 *
 * Everything the renderer promises main is pinned here, and pinned by OUTCOME —
 * is an accelerator actually registered, would the OS deliver a press — because
 * `createFakeMain` models main's single accelerator slot and its owner.
 *
 * That modelling is the whole reason this file was rewritten. The previous
 * version stubbed `setPushToTalkEnabled` with a bare `vi.fn()`, which holds no
 * registration state, and fired the toggle callback directly instead of asking
 * whether the OS would ever deliver it. Two shipped defects were invisible to it
 * and it passed anyway.
 *
 * WHAT STILL CANNOT BE COVERED HERE, stated plainly rather than implied:
 *
 *  - `globalShortcut.register` / `unregister` themselves. Claiming a system-wide
 *    key needs a real Electron main process. `createFakeMain` is kept in step
 *    with main-web.js by hand, so a change there needs a change here.
 *  - Whether macOS actually withholds keyup for a global shortcut — the reason
 *    this is a toggle rather than hold-to-talk. That is an OS behaviour.
 *  - Whether the OS delivers the press while AIME is unfocused, which is the
 *    entire point of the feature. jsdom has no concept of focus.
 *  - Real Whisper output. The model is faked; what is real is that exactly one
 *    recording happens, is decoded once, and is delivered to exactly one sink.
 *
 * The settings UI, the platform-specific key labels, and persistence across a
 * reload are covered in a real browser by `e2e/push-to-talk.spec.ts`.
 */

const transcribe = vi.fn(async (_input: Float32Array) => ({ text: ' dictated words ' }));
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(async () => (input: Float32Array) => transcribe(input)),
}));
vi.mock('@/lib/telemetry/events', () => ({ sendFeatureAdoptionEvent: vi.fn() }));

let main: FakeMain;
let media: FakeMediaStack;
let transcripts: string[];

beforeEach(() => {
  vi.clearAllMocks();
  transcribe.mockResolvedValue({ text: ' dictated words ' });
  resetVoiceSession();
  media = installFakeMediaStack();
  main = createFakeMain();
  transcripts = [];
  registerTranscriptSink(null, (text) => transcripts.push(text));
  installFakeElectron(main);
});

afterEach(() => {
  cleanup();
  resetVoiceSession();
  vi.unstubAllGlobals();
  uninstallFakeElectron();
});

const mount = (enabled = true, accelerator = DEFAULT_PUSH_TO_TALK) =>
  renderHook(() => usePushToTalk({ enabled, accelerator }));

describe('usePushToTalk — holding and releasing the shortcut', () => {
  it('registers the shortcut with the OS when enabled', async () => {
    mount(true);
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));
    expect(main.pressHotkey()).toBe(true);
  });

  it('claims nothing at all when disabled — not even a release', async () => {
    mount(false);
    await Promise.resolve();
    // A hotkey must never be claimed behind the user's back, AND a disabled
    // instance must not talk to main: see the mount-order regression below.
    expect(main.setPushToTalkEnabled).not.toHaveBeenCalled();
    expect(main.onVoiceToggle).not.toHaveBeenCalled();
    expect(main.held).toBeNull();
  });

  it('gives the combination back on unmount', async () => {
    const { unmount } = mount(true);
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    unmount();
    await waitFor(() => expect(main.held).toBeNull());
    // Otherwise the combination stays stolen from every other application.
    expect(main.pressHotkey()).toBe(false);
  });

  it('gives it back when the setting is turned off', async () => {
    const { rerender } = renderHook(
      ({ enabled }) => usePushToTalk({ enabled, accelerator: DEFAULT_PUSH_TO_TALK }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    rerender({ enabled: false });
    await waitFor(() => expect(main.held).toBeNull());
  });

  it('reports unavailable outside Electron', () => {
    installFakeElectron(undefined);
    const { result } = mount(true);
    expect(result.current.isAvailable).toBe(false);
  });

  it('reports unavailable when the bridge is only partly present', async () => {
    // An older preload without setPushToTalkEnabled must not half-work.
    installFakeElectron({ onVoiceToggle: main.onVoiceToggle });
    const { result } = mount(true);
    await waitFor(() => expect(result.current.hotkey.state).toBe('unavailable'));
    expect(result.current.isAvailable).toBe(false);
    expect(main.onVoiceToggle).not.toHaveBeenCalled();
  });
});

describe('usePushToTalk — DEFECT 1 regression: a disabled instance releasing the enabled one', () => {
  /**
   * surface-router mounts all five surfaces at once (its own comment says so),
   * chat first, and React runs mount effects in tree order. The shipped hook
   * called `setPushToTalkEnabled(enabled)` BEFORE its `if (!enabled) return`
   * guard, and main released whatever was held with no idea who was asking — so
   * whichever surface mounted second unregistered the first one's shortcut.
   *
   * The fix is structural (one owner, mounted above the surfaces), but these
   * assertions are on the OUTCOME — is a shortcut actually registered, and would
   * the OS deliver a press — so they hold regardless of how ownership is arranged.
   */
  it('an instance mounted enabled keeps the shortcut when a disabled one mounts after it', async () => {
    renderHook(() => usePushToTalk({ enabled: true, accelerator: DEFAULT_PUSH_TO_TALK }));
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    renderHook(() => usePushToTalk({ enabled: false, accelerator: DEFAULT_PUSH_TO_TALK }));
    await Promise.resolve();

    expect(main.held).toBe(DEFAULT_PUSH_TO_TALK);
    // And the press still arrives: the shipped bug left the enabled instance
    // holding a live listener for an event that could never be delivered.
    expect(main.pressHotkey()).toBe(true);
    await waitFor(() => expect(media.getUserMedia).toHaveBeenCalledTimes(1));
  });

  it('and in the other mount order too', async () => {
    // This is the order that accidentally worked, so it must not be the only one tested.
    renderHook(() => usePushToTalk({ enabled: false, accelerator: DEFAULT_PUSH_TO_TALK }));
    renderHook(() => usePushToTalk({ enabled: true, accelerator: DEFAULT_PUSH_TO_TALK }));

    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));
    expect(main.pressHotkey()).toBe(true);
  });

  it('refuses a second enabled owner rather than letting it steal or release the first', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHook(() => usePushToTalk({ enabled: true, accelerator: DEFAULT_PUSH_TO_TALK }));
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));
    const firstOwner = main.heldBy;

    const second = renderHook(() => usePushToTalk({ enabled: true, accelerator: DEFAULT_PUSH_TO_TALK }));
    await Promise.resolve();

    expect(main.held).toBe(DEFAULT_PUSH_TO_TALK);
    expect(main.heldBy).toBe(firstOwner);
    expect(warn).toHaveBeenCalled();

    // …and when the interloper goes away it must not take the shortcut with it.
    second.unmount();
    await Promise.resolve();
    expect(main.held).toBe(DEFAULT_PUSH_TO_TALK);
    warn.mockRestore();
  });

  it('main ignores a release from a non-owner (defence in depth)', async () => {
    // Belt to the renderer's braces: even if some future caller sends a stray
    // `false`, main is the one holding the OS registration and can refuse.
    mount(true);
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    await main.setPushToTalkEnabled(false, DEFAULT_PUSH_TO_TALK, 'some-other-component');
    expect(main.held).toBe(DEFAULT_PUSH_TO_TALK);
  });
});

describe('usePushToTalk — DEFECT 4 regression: the accelerator reaching the OS', () => {
  it('passes the configured accelerator across the IPC boundary', async () => {
    mount(true, 'Control+Alt+K');
    await waitFor(() =>
      expect(main.setPushToTalkEnabled).toHaveBeenCalledWith(true, 'Control+Alt+K', expect.any(String)),
    );
    // The shipped call passed one argument, so main always fell back to its
    // hardcoded default and a user-configured hotkey did nothing.
    expect(main.held).toBe('Control+Alt+K');
  });

  it('re-registers when the accelerator changes', async () => {
    const { rerender } = renderHook(
      ({ accelerator }) => usePushToTalk({ enabled: true, accelerator }),
      { initialProps: { accelerator: DEFAULT_PUSH_TO_TALK } },
    );
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    rerender({ accelerator: 'Control+Alt+J' });
    await waitFor(() => expect(main.held).toBe('Control+Alt+J'));
  });

  it('surfaces a combination another app already owns', async () => {
    // The exact distinction accelerator.ts's docblock says the caller needs —
    // and which the shipped hook threw away by `void`-ing main's return value.
    main = createFakeMain({ takenByOtherApps: ['Control+Alt+K'] });
    installFakeElectron(main);

    const { result } = mount(true, 'Control+Alt+K');
    await waitFor(() => expect(result.current.hotkey.state).toBe('failed'));
    expect(result.current.hotkey).toMatchObject({ reason: 'taken', accelerator: 'Control+Alt+K' });
    expect(result.current.hotkey.state === 'failed' && result.current.hotkey.message).toMatch(
      /already in use/i,
    );
    // The user-visible failure mode being avoided: a switch that reads ON while
    // no hotkey works. The status is shared state, so Settings sees it too.
    expect(getVoiceSnapshot().hotkey.state).toBe('failed');
  });

  it('reports success so a working hotkey can be shown as working', async () => {
    const { result } = mount(true, 'Control+Alt+K');
    await waitFor(() => expect(result.current.hotkey).toEqual({ state: 'held', accelerator: 'Control+Alt+K' }));
  });

  it('survives a rejected IPC call without claiming success', async () => {
    const boom = createFakeMain();
    boom.setPushToTalkEnabled.mockRejectedValue(new Error('bridge gone'));
    installFakeElectron(boom);

    const { result } = mount(true);
    await waitFor(() => expect(result.current.hotkey.state).toBe('failed'));
  });
});

describe('usePushToTalk — the toggle', () => {
  it('a press starts exactly one recording, a second press stops it', async () => {
    mount(true);
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    await act(async () => {
      main.pressHotkey();
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(media.liveRecorders()).toHaveLength(1);

    await act(async () => {
      main.pressHotkey();
    });
    expect(media.liveRecorders()).toHaveLength(0);
    await waitFor(() => expect(transcripts).toEqual(['dictated words']));
  });

  it('ignores a press while the previous take is still transcribing', async () => {
    // Starting a new recording would discard a transcript the user is waiting on.
    let releaseTranscription: (() => void) | undefined;
    transcribe.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseTranscription = () => resolve({ text: 'slow take' });
      }),
    );

    mount(true);
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    await act(async () => {
      main.pressHotkey();
    });
    await act(async () => {
      main.pressHotkey();
    });
    await waitFor(() => expect(getVoiceSnapshot().status).toBe('transcribing'));

    await act(async () => {
      main.pressHotkey();
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseTranscription?.();
    });
  });

  it('exposes the same path for a manual toggle', async () => {
    const { result } = mount(true);
    await act(async () => {
      result.current.toggle();
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('stops capture when the setting is turned off mid-dictation', async () => {
    // Otherwise the mic stays on with the hotkey that would stop it already gone.
    const { rerender } = renderHook(
      ({ enabled }) => usePushToTalk({ enabled, accelerator: DEFAULT_PUSH_TO_TALK }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));
    await act(async () => {
      main.pressHotkey();
    });
    expect(media.liveRecorders()).toHaveLength(1);

    await act(async () => {
      rerender({ enabled: false });
    });
    expect(media.liveRecorders()).toHaveLength(0);
    expect(media.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('does not resubscribe when recording state changes', async () => {
    // Resubscribing on every state change would drop presses in the gap.
    const { rerender } = renderHook(
      ({ enabled }) => usePushToTalk({ enabled, accelerator: DEFAULT_PUSH_TO_TALK }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(main.onVoiceToggle).toHaveBeenCalledTimes(1));

    await act(async () => {
      main.pressHotkey();
    });
    rerender({ enabled: true });

    expect(main.onVoiceToggle).toHaveBeenCalledTimes(1);
  });
});
