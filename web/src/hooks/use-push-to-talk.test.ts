// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { usePushToTalk } from './use-push-to-talk';

/**
 * Covers the half of push-to-talk that vitest can reach: the toggle state
 * machine and the lifecycle contract with Electron main.
 *
 * NOT covered here, and stated plainly rather than implied: the actual
 * `globalShortcut.register` call in main-web.js. Registering a system-wide
 * shortcut needs a real Electron main process, so that line is verified by
 * running the app, not by this suite. What IS pinned is everything the renderer
 * promises main — including that disabling genuinely releases the combination,
 * which is the failure a user would notice (a hotkey stolen from every other app).
 */

const startListening = vi.fn();
const stopListening = vi.fn();
let voiceState = { isListening: false, isTranscribing: false, isSupported: true };

vi.mock('./use-voice-input', () => ({
  useVoiceInput: () => ({ ...voiceState, startListening, stopListening }),
}));

let fireToggle: (() => void) | null = null;
const unsubscribe = vi.fn();
const setPushToTalkEnabled = vi.fn().mockResolvedValue('CommandOrControl+Shift+Space');
const onVoiceToggle = vi.fn((cb: () => void) => {
  fireToggle = cb;
  return unsubscribe;
});

const onTranscript = vi.fn();

function installElectron(partial = false) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = partial
    ? { onVoiceToggle }
    : { onVoiceToggle, setPushToTalkEnabled };
}

beforeEach(() => {
  vi.clearAllMocks();
  voiceState = { isListening: false, isTranscribing: false, isSupported: true };
  fireToggle = null;
  installElectron();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const render = (enabled = true) => renderHook(() => usePushToTalk({ onTranscript, enabled }));

describe('usePushToTalk — holding and releasing the shortcut', () => {
  it('asks main to hold the shortcut when enabled', async () => {
    render(true);
    await waitFor(() => expect(setPushToTalkEnabled).toHaveBeenCalledWith(true));
    expect(onVoiceToggle).toHaveBeenCalled();
  });

  it('does not register anything when disabled', async () => {
    render(false);
    await waitFor(() => expect(setPushToTalkEnabled).toHaveBeenCalledWith(false));
    // A hotkey must never be claimed behind the user's back.
    expect(onVoiceToggle).not.toHaveBeenCalled();
  });

  it('releases the shortcut on unmount, not merely stops listening for it', async () => {
    // Otherwise the combination stays stolen from every other application.
    const { unmount } = render(true);
    await waitFor(() => expect(onVoiceToggle).toHaveBeenCalled());
    setPushToTalkEnabled.mockClear();

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
    expect(setPushToTalkEnabled).toHaveBeenCalledWith(false);
  });

  it('releases when the setting is turned off', async () => {
    const { rerender } = renderHook(
      ({ enabled }) => usePushToTalk({ onTranscript, enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(onVoiceToggle).toHaveBeenCalled());
    setPushToTalkEnabled.mockClear();

    rerender({ enabled: false });
    await waitFor(() => expect(setPushToTalkEnabled).toHaveBeenCalledWith(false));
  });

  it('reports unavailable outside Electron', () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    const { result } = render(true);
    expect(result.current.isAvailable).toBe(false);
  });

  it('reports unavailable when the bridge is only partly present', async () => {
    // An older preload without setPushToTalkEnabled must not half-work.
    installElectron(true);
    const { result } = render(true);
    await waitFor(() => expect(result.current.isAvailable).toBe(false));
    expect(onVoiceToggle).not.toHaveBeenCalled();
  });

  it('reports unavailable when the browser cannot record', async () => {
    voiceState = { ...voiceState, isSupported: false };
    const { result } = render(true);
    await waitFor(() => expect(result.current.isAvailable).toBe(false));
  });
});

describe('usePushToTalk — the toggle', () => {
  it('starts recording on the first press', async () => {
    render(true);
    await waitFor(() => expect(fireToggle).not.toBeNull());

    act(() => fireToggle!());
    expect(startListening).toHaveBeenCalledTimes(1);
    expect(stopListening).not.toHaveBeenCalled();
  });

  it('stops recording on the second press', async () => {
    voiceState = { ...voiceState, isListening: true };
    render(true);
    await waitFor(() => expect(fireToggle).not.toBeNull());

    act(() => fireToggle!());
    expect(stopListening).toHaveBeenCalledTimes(1);
    expect(startListening).not.toHaveBeenCalled();
  });

  it('ignores a press while the previous take is still transcribing', async () => {
    // Starting a new recording would discard a transcript the user is waiting on.
    voiceState = { ...voiceState, isTranscribing: true };
    render(true);
    await waitFor(() => expect(fireToggle).not.toBeNull());

    act(() => fireToggle!());
    expect(startListening).not.toHaveBeenCalled();
    expect(stopListening).not.toHaveBeenCalled();
  });

  it('does nothing when recording is unsupported', async () => {
    voiceState = { ...voiceState, isSupported: false };
    const { result } = render(true);
    act(() => result.current.toggle());
    expect(startListening).not.toHaveBeenCalled();
  });

  it('exposes the same path for a manual toggle', async () => {
    const { result } = render(true);
    act(() => result.current.toggle());
    expect(startListening).toHaveBeenCalledTimes(1);
  });

  it('surfaces listening and transcribing state for the UI', () => {
    voiceState = { isListening: true, isTranscribing: false, isSupported: true };
    const { result } = render(true);
    expect(result.current.isListening).toBe(true);
    expect(result.current.isTranscribing).toBe(false);
  });

  it('does not resubscribe when recording state changes', async () => {
    // Resubscribing on every state change would drop presses in the gap.
    const { rerender } = renderHook(
      ({ enabled }) => usePushToTalk({ onTranscript, enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(onVoiceToggle).toHaveBeenCalledTimes(1));

    voiceState = { ...voiceState, isListening: true };
    rerender({ enabled: true });
    voiceState = { ...voiceState, isListening: false };
    rerender({ enabled: true });

    expect(onVoiceToggle).toHaveBeenCalledTimes(1);
  });
});

describe('usePushToTalk — the duplication and stuck-mic bugs (regression)', () => {
  /**
   * Two defects a single-instance test could not see:
   *
   *  1. All five surfaces mount at once, and chat and cowork each enabled this
   *     hook — so one hotkey press started TWO MediaRecorders, transcribed twice
   *     against the shared Whisper pipeline, and appended to both composers. Either
   *     instance's cleanup also released the OS shortcut for the other.
   *  2. Disabling mid-dictation never stopped capture: `enabled` flips, so the
   *     effect cleans up but the hook is not unmounted, meaning use-voice-input's
   *     own teardown never runs either. The mic stayed on and the hotkey that would
   *     have stopped it had just been released.
   */
  it('stops capture when it is disabled mid-recording', async () => {
    voiceState = { ...voiceState, isListening: true };
    const { rerender } = renderHook(
      ({ enabled }) => usePushToTalk({ onTranscript, enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(onVoiceToggle).toHaveBeenCalled());

    rerender({ enabled: false });
    await waitFor(() => expect(stopListening).toHaveBeenCalled());
  });

  it('does not stop capture when it was not recording', async () => {
    const { rerender } = renderHook(
      ({ enabled }) => usePushToTalk({ onTranscript, enabled }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(onVoiceToggle).toHaveBeenCalled());

    rerender({ enabled: false });
    await waitFor(() => expect(setPushToTalkEnabled).toHaveBeenCalledWith(false));
    expect(stopListening).not.toHaveBeenCalled();
  });

  it('stops capture on unmount too', async () => {
    voiceState = { ...voiceState, isListening: true };
    const { unmount } = render(true);
    await waitFor(() => expect(onVoiceToggle).toHaveBeenCalled());

    unmount();
    expect(stopListening).toHaveBeenCalled();
  });

  it('only the enabled instance claims the shortcut, so two mounts record once', async () => {
    // Mirrors production: both surfaces mount, only the active one is enabled.
    renderHook(() => usePushToTalk({ onTranscript, enabled: true }));   // active
    renderHook(() => usePushToTalk({ onTranscript, enabled: false }));  // background

    await waitFor(() => expect(onVoiceToggle).toHaveBeenCalledTimes(1));

    act(() => fireToggle!());
    // One press, one recorder — not two.
    expect(startListening).toHaveBeenCalledTimes(1);
  });
});
