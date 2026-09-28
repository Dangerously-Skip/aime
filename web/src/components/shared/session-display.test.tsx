// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AssistantMessage } from './assistant-message';
import { useChatStore } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';
import { DEFAULT_SESSION_CONTROLS } from '@/lib/slash-commands';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const toolCalls = [
  { id: 't1', name: 'Read', input: { file_path: '/w/notes.md' }, status: 'complete' as const, startTime: 0, endTime: 1 },
];

describe('/reasoning and /verbose do something', () => {
  it('/reasoning off hides the thinking block', () => {
    const { rerender } = render(<AssistantMessage content="answer" thinking="step by step" />);
    expect(screen.getByText(/Thought \(/)).toBeTruthy();
    rerender(<AssistantMessage content="answer" thinking="step by step" showThinking={false} />);
    expect(screen.queryByText(/Thought \(/)).toBeNull();
  });

  it('/verbose on opens the tool-call details, including on replies already shown', () => {
    const { container, rerender } = render(<AssistantMessage content="done" toolCalls={toolCalls} />);
    const trigger = () => container.querySelector('[data-slot="collapsible-trigger"]:not([aria-label])') as HTMLElement;
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    rerender(<AssistantMessage content="done" toolCalls={toolCalls} expandToolCalls />);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('verbose is off by default, so nothing changes for anyone who never typed it', () => {
    expect(DEFAULT_SESSION_CONTROLS.verboseMode).toBe(false);
    expect(DEFAULT_SESSION_CONTROLS.reasoningVisible).toBe(true);
  });
});

describe('persisted session controls from before /verbose meant anything', () => {
  it.each([
    ['aime:chat', useChatStore],
    ['aime:cowork', useCoworkStore],
  ] as const)('%s: the old default verboseMode:true is reset on upgrade', async (key, store) => {
    const data = new Map<string, string>([
      [key, JSON.stringify({
        state: { messages: {}, sessionControls: { c: { ...DEFAULT_SESSION_CONTROLS, verboseMode: true, thinkLevel: 'high' } } },
        version: 0,
      })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
      removeItem: (k: string) => data.delete(k),
      key: () => null,
      length: 0,
      clear: () => data.clear(),
    });
    await store.persist.rehydrate();
    const ctrl = store.getState().sessionControls.c;
    expect(ctrl.verboseMode).toBe(false);
    // Everything else the user set survives.
    expect(ctrl.thinkLevel).toBe('high');
  });
});
