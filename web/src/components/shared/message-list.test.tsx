// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCallback } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MessageList } from './message-list';
import { useChatStore } from '@/stores/chat-store';
import { useConnectorStore } from '@/stores/connector-store';
import { openStorageGate } from '@/lib/gated-storage';

/**
 * The regression (DEFECT 2): `connectorRequestSettled` had a type, a prop and a
 * reader — and no writer anywhere in the tree. The card's answered state lived in
 * local `useState`, while the message itself is persisted under `aime:chat`. So
 * answering a Connect card and then switching conversation (or restarting)
 * brought back live "Connect" / "Not now" buttons for a request that had already
 * been dealt with. Clicking Connect re-ran the entire OAuth flow and POSTed a
 * `toolUseId` with no waiter left; the 404 was swallowed.
 *
 * The gap that let it ship was testing store state instead of rendered output, so
 * these assert what is on screen after the list is remounted from the store.
 *
 * This is the surfaces' wiring in miniature — the same three lines chat-surface
 * and cowork-surface use for `questionAnswered`, over the real chat store.
 */

const startOAuthFlow = vi.fn();
const runMcpOAuthFlow = vi.fn();
vi.mock('@/lib/connectors/oauth', () => ({ startOAuthFlow: (...a: unknown[]) => startOAuthFlow(...a) }));
vi.mock('@/lib/mcp/oauth-flow', () => ({ runMcpOAuthFlow: (...a: unknown[]) => runMcpOAuthFlow(...a) }));
vi.mock('@/lib/connectors/provisioner', () => ({ provisionConnector: vi.fn() }));

const fetchMock = vi.fn();
const reports = () =>
  fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/chat/connector-result'));

const CHAT = 'chat-1';

/** What every surface does: render the store's messages, write back the answer. */
function Surface() {
  const messages = useChatStore((s) => s.messages[CHAT] ?? []);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const onConnectorSettled = useCallback(
    (toolUseId: string) => updateMessage(CHAT, toolUseId, { connectorRequestSettled: true }),
    [updateMessage],
  );
  return <MessageList messages={messages} onConnectorSettled={onConnectorSettled} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  // FIRST: the gate below stays open for the rest of the file, and every persisted
  // store writes through it — including on the setState calls further down.
  //
  // jsdom here has no Storage implementation, and persistence is gated until
  // StoreHydration opens it; the rehydrate test needs real writes to land
  // somewhere they can be read back. Everything above the storage itself (the
  // gate, the persist middleware, partialize, serialization) is the real thing.
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return stored.size;
    },
    clear: () => stored.clear(),
    key: (i: number) => [...stored.keys()][i] ?? null,
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
  } satisfies Storage);
  openStorageGate();
  fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  runMcpOAuthFlow.mockResolvedValue({ accessToken: 'at', expiresIn: 3600 });
  // jsdom implements neither of these; MessageList auto-scrolls with both.
  Element.prototype.scrollIntoView = () => {};
  // ResizeObserver is not implemented in jsdom; MessageList observes its content.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useConnectorStore.setState({ connectorStates: {}, tokens: {} } as never);
  useChatStore.setState({ messages: {}, currentChatId: CHAT });
  useChatStore.getState().addMessage(CHAT, {
    id: 'tu-1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    connectorRequest: { connectorId: 'atlassian', reason: 'to read the ticket', toolUseId: 'tu-1' },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settled = () =>
  useChatStore.getState().messages[CHAT]?.find((m) => m.id === 'tu-1')?.connectorRequestSettled;

describe('MessageList — an answered connect request stays answered', () => {
  it('offers the buttons the first time', () => {
    render(<Surface />);
    expect(screen.getByText('Connect Atlassian?')).toBeTruthy();
    expect(screen.getByText('Connect')).toBeTruthy();
    expect(screen.getByText('Not now')).toBeTruthy();
  });

  it('records the answer on the message when the user connects', async () => {
    render(<Surface />);
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(settled()).toBe(true));
  });

  it('records the answer on the message when the user declines', async () => {
    render(<Surface />);
    fireEvent.click(screen.getByText('Not now'));
    await waitFor(() => expect(settled()).toBe(true));
  });

  it('renders no live buttons after a remount, so the flow cannot be re-run', async () => {
    const first = render(<Surface />);
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(settled()).toBe(true));

    // Switching conversation, or restarting: the component tree is gone and the
    // messages come back from the store.
    first.unmount();
    render(<Surface />);

    expect(screen.getByText('Connect Atlassian?')).toBeTruthy();
    expect(screen.queryByText('Connect')).toBeNull();
    expect(screen.queryByText('Not now')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('re-reports nothing on remount — the paused turn is long gone', async () => {
    const first = render(<Surface />);
    fireEvent.click(screen.getByText('Not now'));
    await waitFor(() => expect(reports()).toHaveLength(1));

    first.unmount();
    render(<Surface />);
    await Promise.resolve();
    expect(reports()).toHaveLength(1);
    expect(runMcpOAuthFlow).not.toHaveBeenCalled();
  });

  it('survives a real rehydrate of the persisted store', async () => {
    const first = render(<Surface />);
    fireEvent.click(screen.getByText('Connect'));
    await waitFor(() => expect(settled()).toBe(true));
    first.unmount();

    // A restart: keep the bytes that were persisted, drop everything in memory,
    // read it back. (Clearing state writes through to storage too, hence the
    // snapshot.) `messages` is in the persisted partition, so the flag rides along.
    const persisted = localStorage.getItem('aime:chat');
    expect(persisted).toContain('connectorRequestSettled');
    useChatStore.setState({ messages: {} });
    localStorage.setItem('aime:chat', persisted!);
    await useChatStore.persist.rehydrate();
    expect(settled()).toBe(true);

    render(<Surface />);
    expect(screen.getByText('Connect Atlassian?')).toBeTruthy();
    expect(screen.queryByText('Connect')).toBeNull();
    expect(screen.queryByText('Not now')).toBeNull();
  });
});
