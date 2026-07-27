// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTurnWiring } from './use-turn-wiring';
import { useChatStore, type Message } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';
import { useRunStore } from '@/stores/run-store';
import { notifyStreamAborted } from '@/lib/stream-registry';

/**
 * The wiring four surfaces used to hand-roll.
 *
 * This exists because the wiring was COPIED: Chat persisted a connect card's
 * answer onto the message, Cowork did not, and the difference was invisible until
 * a user answered a card in Cowork, switched conversation and came back to find
 * live Connect / Not now buttons on a request already dealt with — clicking one
 * re-ran the entire OAuth flow to report to a rendezvous with no waiter. Standing a
 * 2000-line surface up in jsdom to prove one `useCallback` is the alternative, and
 * it would prove the mount rather than the wiring. So the wiring moved here and is
 * exercised against BOTH real stores.
 *
 * Real chat store, real cowork store, real run store, real abort bus. Only the
 * run-log POST is stubbed.
 */

const STORES = [
  { name: 'chat', store: useChatStore },
  { name: 'cowork', store: useCoworkStore },
] as const;

const CHAT = 'conv-1';

function seedCard(store: (typeof STORES)[number]['store']) {
  store.getState().addMessage(CHAT, {
    id: 'tu-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    connectorRequest: { connectorId: 'atlassian', toolUseId: 'tu-1' },
  } as Message);
}

const message = (store: (typeof STORES)[number]['store']) =>
  store.getState().messages[CHAT]?.find((m) => m.id === 'tu-1');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  useRunStore.setState({ runs: [], goals: [] });
  useChatStore.setState({ messages: {} });
  useCoworkStore.setState({ messages: {} });
});

describe.each(STORES)('useTurnWiring — $name surface', ({ name, store }) => {
  const setup = (chatId = CHAT) =>
    renderHook(() =>
      useTurnWiring({
        surfaceId: name,
        chatId,
        ownsChat: (id) => id === CHAT,
        updateMessage: store.getState().updateMessage,
      }),
    );

  it('persists a settled connect card on the message, so it survives a conversation switch', () => {
    seedCard(store);
    const { result } = setup();

    act(() => result.current.onConnectorSettled('tu-1'));

    expect(message(store)?.connectorRequestSettled).toBe(true);
  });

  it('persists an answered question on the message', () => {
    seedCard(store);
    const { result } = setup();

    act(() => result.current.onQuestionAnswered('tu-1'));

    expect(message(store)?.questionAnswered).toBe(true);
  });

  it('records the Run against this surface', () => {
    const { result } = setup();
    act(() => {
      result.current.runRecorder.begin({ trigger: 'chat', model: 'sonnet' });
    });
    expect(useRunStore.getState().runs[0]).toMatchObject({ surfaceId: name, status: 'running' });
  });

  it('closes a Run the stream callbacks will never reach', () => {
    // A Stop, a conversation switch or an inactivity timeout aborts the fetch, so
    // neither onDone nor onError runs and the Run would stay 'running' for ever.
    const { result } = setup();
    let id = '';
    act(() => {
      id = result.current.runRecorder.begin({ trigger: 'chat' });
    });

    act(() => notifyStreamAborted({ chatId: CHAT, reason: 'user' }));
    expect(useRunStore.getState().getRun(id)?.status).toBe('cancelled');
  });

  it('leaves another surface’s Run alone', () => {
    // Aborts are broadcast to every listener.
    const { result } = setup();
    let id = '';
    act(() => {
      id = result.current.runRecorder.begin({ trigger: 'chat' });
    });

    act(() => notifyStreamAborted({ chatId: 'someone-else', reason: 'user' }));
    expect(useRunStore.getState().getRun(id)?.status).toBe('running');
  });

  it('drops a card answer that arrives with no active conversation', () => {
    seedCard(store);
    const { result } = setup('');

    act(() => result.current.onConnectorSettled('tu-1'));

    expect(message(store)?.connectorRequestSettled).toBeUndefined();
  });
});

describe('useTurnWiring — a surface with no cards', () => {
  it('answers are inert rather than throwing, so the project page can share this', () => {
    // project-detail streams chat turns but renders no question or connect card,
    // so it passes no store writer at all.
    const { result } = renderHook(() =>
      useTurnWiring({ surfaceId: 'chat', chatId: CHAT, ownsChat: () => true }),
    );

    expect(() => {
      act(() => result.current.onConnectorSettled('tu-1'));
      act(() => result.current.onQuestionAnswered('tu-1'));
    }).not.toThrow();
    expect(useChatStore.getState().messages[CHAT]).toBeUndefined();
  });
});
