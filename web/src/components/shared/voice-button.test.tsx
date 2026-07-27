// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { VoiceButton } from './voice-button';
import {
  resetVoiceSession,
  startRecording,
  stopRecording,
  getVoiceSnapshot,
} from '@/lib/voice/voice-session';
import { installFakeMediaStack, type FakeMediaStack } from '@/lib/voice/__fixtures__/fake-media';

/**
 * The mic button as a window onto the shared session.
 *
 * The state it renders is not its own: a recording started anywhere — the global
 * hotkey, another composer — has to show up here, because the shipped version
 * owned a private recorder and cheerfully displayed "Voice input" while the mic
 * was live and unstoppable from this button.
 */

const transcribe = vi.fn(async (_input: Float32Array) => ({ text: ' spoken text ' }));
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(async () => (input: Float32Array) => transcribe(input)),
}));
vi.mock('@/lib/telemetry/events', () => ({ sendFeatureAdoptionEvent: vi.fn() }));

let media: FakeMediaStack;
let transcripts: string[];

beforeEach(() => {
  vi.clearAllMocks();
  transcribe.mockResolvedValue({ text: ' spoken text ' });
  resetVoiceSession();
  media = installFakeMediaStack();
  transcripts = [];
});

afterEach(() => {
  cleanup();
  resetVoiceSession();
  vi.unstubAllGlobals();
});

function mount() {
  render(<VoiceButton onTranscript={(text) => transcripts.push(text)} />);
}

describe('VoiceButton', () => {
  it('starts and stops a recording', async () => {
    mount();
    await act(async () => {
      fireEvent.click(screen.getByTitle('Voice input'));
    });
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTitle('Stop recording'));
    });
    await waitFor(() => expect(transcripts).toEqual(['spoken text']));
  });

  it('shows a recording it did not start', async () => {
    mount();
    await act(async () => {
      await startRecording();
    });
    expect(await screen.findByTitle('Stop recording')).toBeTruthy();

    // …and can stop it.
    await act(async () => {
      fireEvent.click(screen.getByTitle('Stop recording'));
    });
    expect(media.liveRecorders()).toHaveLength(0);
  });

  it('shows a spinner and refuses input while transcribing', async () => {
    // Hold Whisper open so the state is observable rather than a single frame.
    let finish: ((value: { text: string }) => void) | undefined;
    transcribe.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    mount();
    await act(async () => {
      await startRecording();
    });
    await act(async () => {
      stopRecording();
    });

    const spinner = await screen.findByTitle('Transcribing...');
    // Clicking again here would discard the transcript being waited on.
    expect(spinner.hasAttribute('disabled')).toBe(true);

    await act(async () => {
      finish?.({ text: ' spoken text ' });
    });
    await waitFor(() => expect(getVoiceSnapshot().status).toBe('idle'));
    expect(transcripts).toEqual(['spoken text']);
  });

  it('renders nothing when the renderer cannot record', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    resetVoiceSession();
    const { container } = render(<VoiceButton onTranscript={() => {}} />);
    // Offering a mic that cannot work is worse than offering none.
    expect(container.querySelector('button')).toBeNull();
  });
});
