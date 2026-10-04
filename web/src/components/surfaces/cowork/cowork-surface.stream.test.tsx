// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { CoworkSurface } from './cowork-surface';
import { useCoworkStore } from '@/stores/cowork-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useRunStore } from '@/stores/run-store';
import { useComposerDrafts } from '@/components/shared/composer/draft-store';
import { resetServerCredentials } from '@/hooks/use-builtin-access';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * The real Cowork surface, driven through its composer, against the real stores
 * and the real SSE hook. Only `fetch` is faked, and only the chat endpoint does
 * anything interesting: its body is written by the test so a conversation
 * switch can happen between two events of one turn.
 */

const CHAT = 'cw-a';
const OTHER = 'cw-b';

function controllableFetch() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
  const enc = new TextEncoder();
  return {
    fetch: () => Promise.resolve(new Response(body, { status: 200 })),
    push: (event: Record<string, unknown>) =>
      ctrl.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`)),
    end: () => ctrl.close(),
  };
}

async function flush() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
}

const fetchMock = vi.fn();
let stream: ReturnType<typeof controllableFetch>;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Element.prototype.scrollIntoView = () => {};
  // base-ui ScrollArea reads it on a timer; jsdom has no Web Animations.
  (Element.prototype as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [];
  stream = controllableFetch();
  resetServerCredentials();
  fetchMock.mockClear();
  fetchMock.mockImplementation((url: string) =>
    String(url).includes('/api/chat/')
      ? stream.fetch()
      : String(url).includes('/api/models')
        ? Promise.resolve(new Response(JSON.stringify({ anthropic: true, bedrock: false })))
      // Everything else the surface asks for on mount (scratch dir, goal
      // status, model access) gets an empty answer.
      : Promise.resolve(new Response('{}', { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);

  useRunStore.setState({ runs: [], goals: [] });
  useComposerDrafts.setState({ drafts: {}, lastSent: {} });
  useCoworkStore.setState({ messages: {}, currentChatId: CHAT, isStreaming: false, streamingChats: {} });
  useConversationStore.setState({ conversations: [], activeId: null });
  for (const id of [CHAT, OTHER]) {
    useConversationStore.getState().addConversation({
      id, title: id, surface: 'cowork', lastMessage: '', createdAt: Date.now(), updatedAt: Date.now(),
    });
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function send(text: string) {
  const box = screen.getByPlaceholderText(/What would you like to work on\?|Describe your task/);
  fireEvent.change(box, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: false });
    await flush();
  });
}

const conv = (id: string) => useConversationStore.getState().conversations.find((c) => c.id === id);

describe('CoworkSurface — goal mode', () => {
  it('Enter does what the button does: with goal mode on it starts a goal, not a chat turn', async () => {
    render(<CoworkSurface />);
    fireEvent.click(screen.getByTitle('Work towards a goal across many sessions'));
    const box = screen.getByPlaceholderText('What would you like to work on?');
    fireEvent.change(box, { target: { value: 'ship the release' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
      await flush();
    });

    // No folder is picked, so the goal path refuses — and says why. Before,
    // Enter ignored the toggle and sent the objective as a chat message.
    expect(screen.getByText(/Pick a folder first/)).toBeTruthy();
    expect(useCoworkStore.getState().messages[CHAT] ?? []).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/chat/'))).toBe(false);
    // The objective is kept for when the folder is chosen.
    expect((box as HTMLTextAreaElement).value).toBe('ship the release');
  });
});

describe('CoworkSurface — a turn reports to the conversation it was started in', () => {
  it('records usage against the original chat after a mid-stream switch', async () => {
    render(<CoworkSurface />);
    await send('tidy the folder');
    await act(async () => { stream.push({ type: 'text', content: 'Working' }); await flush(); });

    await act(async () => { useCoworkStore.getState().setCurrentChat(OTHER); });
    await act(async () => {
      stream.push({
        type: 'done',
        usage: { inputTokens: 10, outputTokens: 20, cost: 0.5, model: 'm', durationMs: 1000, toolCallCount: 0 },
      });
      stream.end();
      await flush();
    });

    expect(conv(CHAT)?.tokenUsage?.cost).toBe(0.5);
    expect(conv(OTHER)?.tokenUsage).toBeUndefined();
  });

  it('text after a mid-stream switch lands in the original chat', async () => {
    useCoworkStore.getState().addMessage(OTHER, {
      id: 'o1', role: 'assistant', content: 'unrelated', timestamp: Date.now(),
    });
    render(<CoworkSurface />);
    await send('tidy the folder');
    await act(async () => { stream.push({ type: 'text', content: 'one ' }); await flush(); });
    await act(async () => { useCoworkStore.getState().setCurrentChat(OTHER); });
    await act(async () => {
      stream.push({ type: 'text', content: 'two' });
      stream.end();
      await flush();
    });

    expect(useCoworkStore.getState().messages[CHAT]?.at(-1)?.content).toBe('one two');
    expect(useCoworkStore.getState().messages[OTHER]?.at(-1)?.content).toBe('unrelated');
  });
});

/*
 * Two things start a Cowork turn: the composer, and the auto-continue fired when
 * the agent looks like it ran out of turns mid-task. The second used to
 * hand-copy a subset of the request and had drifted eight fields short — a user
 * who chose Magazine Bold got an unstyled deck whenever the turn
 * auto-continued, because the continuation ran as a user with no theme set.
 * Both now go through the one turn path; this holds them to the same request.
 */
describe('CoworkSurface — the auto-continue is the same user as the typed turn', () => {
  const chatBodies = () =>
    fetchMock.mock.calls
      .filter(([u]) => String(u).includes('/api/chat/'))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

  it('carries the settings the typed turn carried', async () => {
    useSettingsStore.setState({
      deckTheme: 'magazine-bold',
      personalPreferences: 'Be brief.',
      displayName: 'Ada',
      blockNetworkCommands: true,
    } as never);
    // Each request gets its own body; the continuation must not reuse a closed one.
    let current = controllableFetch();
    fetchMock.mockImplementation((url: string) => {
      if (!String(url).includes('/api/chat/')) return Promise.resolve(new Response('{}', { status: 200 }));
      stream = current;
      const response = current.fetch();
      current = controllableFetch();
      return response;
    });

    // Not the first exchange: a first turn is never auto-continued.
    useCoworkStore.getState().addMessage(CHAT, { id: 'u0', role: 'user', content: 'hello', timestamp: 1 });
    useCoworkStore.getState().addMessage(CHAT, { id: 'a0', role: 'assistant', content: 'Hi.', timestamp: 2 });
    render(<CoworkSurface />);
    await send('build the quarterly deck');
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        stream.push({ type: 'tool_use', id: `t${i}`, name: 'Read', input: { file_path: `/tmp/f${i}.md` } });
      }
      stream.push({ type: 'text', content: 'Now let me build the slides.' });
      stream.end();
      await flush();
    });
    // The continuation waits a beat so the partial reply shows first.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1600));
      await flush();
    });

    const [typed, continued] = chatBodies();
    expect(continued, 'the turn did not auto-continue').toBeDefined();
    expect(continued.message).toMatch(/^Continue/);
    for (const field of ['deckTheme', 'searchSettings', 'securitySettings', 'personalPreferences', 'displayName']) {
      expect(continued[field], `${field} missing from the continuation`).toEqual(typed[field]);
    }
    expect((continued.deckTheme as { id: string }).id).toBe('magazine-bold');
    // The continuation is shown as one, and is not what Up-arrow recalls.
    const msgs = useCoworkStore.getState().messages[CHAT] ?? [];
    expect(msgs.filter((m) => m.isAutoContinue)).toHaveLength(1);
  });
});
