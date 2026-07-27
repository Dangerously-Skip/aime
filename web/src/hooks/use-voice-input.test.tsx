// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor, renderHook } from '@testing-library/react';
import { usePushToTalk } from './use-push-to-talk';
import { useVoiceInput } from './use-voice-input';
import { VoiceButton } from '@/components/shared/voice-button';
import { DEFAULT_PUSH_TO_TALK } from '@/lib/voice/accelerator';
import { VoiceScope } from '@/lib/voice/voice-scope';
import { resetVoiceSession } from '@/lib/voice/voice-session';
import { installFakeMediaStack, type FakeMediaStack } from '@/lib/voice/__fixtures__/fake-media';
import {
  createFakeMain,
  installFakeElectron,
  uninstallFakeElectron,
  type FakeMain,
} from '@/lib/voice/__fixtures__/fake-main';

/**
 * DEFECT 2 regression: the hotkey and the mic button were two recording sessions.
 *
 * `usePushToTalk` created its own `useVoiceInput`, separate from the one inside
 * `VoiceButton`. Each owned a private `mediaRecorderRef` and `isListening`, and
 * `startListening`'s only guard was its own ref — so clicking the mic and then
 * pressing the hotkey opened TWO microphone streams, ran TWO MediaRecorders,
 * transcribed twice, and appended the text twice. The hotkey could only stop its
 * own recorder while the button went on rendering "Voice input".
 *
 * These tests count microphone streams and recorders rather than reading
 * `isListening`, because `isListening` was exactly the thing that lied.
 *
 * Real: the hooks, the component, the session state machine, the decode call and
 * the transcript routing. Faked: `getUserMedia`, `MediaRecorder`, `AudioContext`
 * and the Whisper model — see __fixtures__/fake-media.
 */

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(async () => async (_input: Float32Array) => ({ text: ' dictated words ' })),
}));
vi.mock('@/lib/telemetry/events', () => ({ sendFeatureAdoptionEvent: vi.fn() }));

let main: FakeMain;
let media: FakeMediaStack;
let transcripts: string[];

/**
 * Production shape in miniature: the hotkey owner mounted above (app shell) and
 * a composer's mic button below (surface).
 */
function Composer({ hotkeyEnabled = true }: { hotkeyEnabled?: boolean }) {
  usePushToTalk({ enabled: hotkeyEnabled, accelerator: DEFAULT_PUSH_TO_TALK });
  return <VoiceButton onTranscript={(text) => transcripts.push(text)} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetVoiceSession();
  media = installFakeMediaStack();
  main = createFakeMain();
  transcripts = [];
  installFakeElectron(main);
});

afterEach(() => {
  cleanup();
  resetVoiceSession();
  vi.unstubAllGlobals();
  uninstallFakeElectron();
});

async function mountComposer() {
  render(<Composer />);
  await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));
}

describe('one recording session per app', () => {
  it('mic first, then the hotkey: one stream, one recorder, one transcript', async () => {
    await mountComposer();

    await act(async () => {
      fireEvent.click(screen.getByTitle('Voice input'));
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(await screen.findByTitle('Stop recording')).toBeTruthy();

    // The hotkey must stop what the button started, not open a second mic.
    await act(async () => {
      main.pressHotkey();
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(media.recorders()).toHaveLength(1);
    expect(media.liveRecorders()).toHaveLength(0);

    await waitFor(() => expect(transcripts).toEqual(['dictated words']));
    expect(media.decodes()).toBe(1);
    expect(media.tracks.every((t) => t.stopped)).toBe(true);
  });

  it('hotkey first, then the button: the button reflects the hotkey', async () => {
    await mountComposer();

    await act(async () => {
      main.pressHotkey();
    });
    // The shipped button had no idea the hotkey had started anything, so the
    // only way to stop was pressing the hotkey again.
    expect(await screen.findByTitle('Stop recording')).toBeTruthy();
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTitle('Stop recording'));
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(media.liveRecorders()).toHaveLength(0);

    await waitFor(() => expect(transcripts).toEqual(['dictated words']));
  });

  it('two mic buttons in one app still record once and transcribe once', async () => {
    // Every surface stays mounted, so several composers exist at the same time.
    render(<Composer />);
    render(<Composer hotkeyEnabled={false} />);
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    await act(async () => {
      fireEvent.click(screen.getAllByTitle('Voice input')[0]);
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);

    // Both buttons show the same session, because there is only one.
    await waitFor(() => expect(screen.getAllByTitle('Stop recording')).toHaveLength(2));

    await act(async () => {
      fireEvent.click(screen.getAllByTitle('Stop recording')[1]);
    });
    await waitFor(() => expect(transcripts).toEqual(['dictated words']));
  });

  it('a second start while one is in flight is refused, not queued', async () => {
    // Two synchronous callers in the same tick (button + hotkey) both used to
    // clear an async guard and open two streams.
    await mountComposer();

    await act(async () => {
      fireEvent.click(screen.getByTitle('Voice input'));
      main.pressHotkey();
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('two useVoiceInput consumers report the same state', async () => {
    const a = renderHook(() => useVoiceInput({ onTranscript: () => {} }));
    const b = renderHook(() => useVoiceInput({ onTranscript: () => {} }));
    await waitFor(() => expect(a.result.current.isSupported).toBe(true));

    await act(async () => {
      a.result.current.startListening();
    });
    expect(a.result.current.isListening).toBe(true);
    expect(b.result.current.isListening).toBe(true);

    // …and either one can stop what the other started.
    await act(async () => {
      b.result.current.stopListening();
    });
    expect(a.result.current.isListening).toBe(false);
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

/**
 * Where a hotkey transcript lands, now that no surface decides for itself.
 *
 * This is the production arrangement: one owner above the surfaces, every
 * surface mounted at once, and the router naming the one on screen.
 */
describe('routing the transcript to the surface on screen', () => {
  let chat: string[];
  let cowork: string[];

  function ShellWithSurfaces({ active }: { active: string }) {
    usePushToTalk({ enabled: true, accelerator: DEFAULT_PUSH_TO_TALK });
    return (
      <>
        {[
          { id: 'chat', sink: chat },
          { id: 'cowork', sink: cowork },
        ].map(({ id, sink }) => (
          <VoiceScope key={id} id={id} active={active === id}>
            <div style={{ display: active === id ? 'block' : 'none' }}>
              <VoiceButton onTranscript={(text) => sink.push(text)} />
            </div>
          </VoiceScope>
        ))}
      </>
    );
  }

  beforeEach(() => {
    chat = [];
    cowork = [];
  });

  async function dictateViaHotkey() {
    await act(async () => {
      main.pressHotkey();
    });
    await act(async () => {
      main.pressHotkey();
    });
  }

  it('lands in the active surface, not the one that mounted first', async () => {
    const { rerender } = render(<ShellWithSurfaces active="cowork" />);
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    await dictateViaHotkey();
    await waitFor(() => expect(cowork).toEqual(['dictated words']));
    expect(chat).toEqual([]);

    // Switching surfaces moves the destination, with no per-surface bookkeeping.
    rerender(<ShellWithSurfaces active="chat" />);
    await dictateViaHotkey();
    await waitFor(() => expect(chat).toEqual(['dictated words']));
    expect(cowork).toHaveLength(1);
  });

  it('one press still means one recording with every surface mounted', async () => {
    render(<ShellWithSurfaces active="chat" />);
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    await dictateViaHotkey();
    await waitFor(() => expect(chat).toHaveLength(1));
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(media.recorders()).toHaveLength(1);
    expect(media.decodes()).toBe(1);
  });

  it('drops the take when the surface on screen has no composer', async () => {
    // The assistant surface and the projects view have nowhere to put text.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<ShellWithSurfaces active="assistant" />);
    await waitFor(() => expect(main.held).toBe(DEFAULT_PUSH_TO_TALK));

    await dictateViaHotkey();
    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('discarded')));
    expect(chat).toEqual([]);
    expect(cowork).toEqual([]);
    warn.mockRestore();
  });
});
