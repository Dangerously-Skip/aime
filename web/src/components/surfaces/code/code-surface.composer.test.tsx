// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { ReactNode } from 'react';

/*
 * Code's composer, as the surface wires it.
 *
 * The active composer (every message after the first) was once a second,
 * hand-written composer that was never given `cwd` or `onSlashCommand`, so
 * @-mentions and slash commands died after the first message. Enter while
 * streaming aborted the turn, every send renamed the conversation, and the file
 * tree / editor / terminal stayed hidden behind a mascot until the first
 * message. Code now uses the shared Composer; these pin that it is wired.
 *
 * The workspace itself (dockview) is replaced by a stub that renders the chat
 * slot: what is under test is what the SURFACE puts in it.
 */

const sse = vi.hoisted(() => ({ sendMessage: vi.fn(async () => {}), abort: vi.fn() }));
const at = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('./workspace/workspace-layout', () => ({
  WorkspaceLayout: ({ slots }: { slots?: { chat?: ReactNode } }) => (
    <div data-testid="workspace">{slots?.chat}</div>
  ),
}));
vi.mock('@/components/shared/preview-panel', () => ({ PreviewPanel: () => null }));
vi.mock('@/components/shared/model-selector', () => ({ ModelSelector: () => null }));
vi.mock('@/components/shared/connection-selector', () => ({ ConnectionSelector: () => null }));
vi.mock('@/components/shared/editor-picker', () => ({ EditorPicker: () => null }));
vi.mock('@/components/shared/folder-picker', () => ({ FolderPicker: () => <button>Pick folder</button> }));
vi.mock('@/components/shared/attachment-menu', () => ({ AttachmentMenu: () => null }));
vi.mock('@/components/shared/voice-button', () => ({ VoiceButton: () => null }));
vi.mock('@/components/harness/goal-question', () => ({ GoalQuestion: () => null }));
vi.mock('@/components/harness/goal-run-status', () => ({ GoalRunStatus: () => null }));
vi.mock('@/components/harness/use-goal-autoopen', () => ({ useGoalAutoOpen: () => {} }));
vi.mock('@/components/harness/use-goal-transcript', () => ({ useGoalTranscript: () => {} }));
vi.mock('@/components/harness/use-start-goal', () => ({
  useStartGoal: () => ({ start: vi.fn(), phase: 'idle', error: null, setError: vi.fn() }),
}));
vi.mock('@/hooks/use-sse-stream', async (orig) => ({
  ...(await orig<typeof import('@/hooks/use-sse-stream')>()),
  useSSEStream: () => sse,
}));
vi.mock('@/hooks/use-turn-wiring', () => ({
  useTurnWiring: () => ({
    runRecorder: { begin: vi.fn(), succeed: vi.fn(), fail: vi.fn(), onUsage: vi.fn() },
    onQuestionAnswered: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-builtin-access', () => ({
  useBuiltinAccess: () => ({ hasAnthropicKey: true, hasBedrock: false, known: true }),
}));
vi.mock('@/hooks/use-at-suggestions', async (orig) => ({
  ...(await orig<typeof import('@/hooks/use-at-suggestions')>()),
  useAtSuggestions: () => ({
    fileSuggestions: [],
    atLoading: false,
    fetchAtSuggestions: at.fetch,
    clearAtSuggestions: vi.fn(),
    resolveFileAsAttachment: vi.fn(async () => null),
  }),
}));

import { CodeSurface } from './code-surface';
import { useCodeStore } from '@/stores/code-store';
import { useConversationStore } from '@/stores/conversation-store';

const WS = '/tmp/ws';
const CHAT = 'c1';

function seed({ folder = WS as string | null, messages = 0, title = 'New Chat', streaming = false } = {}) {
  useConversationStore.setState({
    conversations: [{ id: CHAT, title, surface: 'code', lastMessage: '', createdAt: 0, updatedAt: 0 }],
    activeId: CHAT,
  } as never);
  useCodeStore.setState({
    currentChatId: CHAT,
    folderByChat: folder ? { [CHAT]: folder } : {},
    isStreaming: streaming,
    streamingChats: streaming ? { [CHAT]: true } : {},
    messages: {
      [CHAT]: Array.from({ length: messages }, (_, i) => ({
        id: `m${i}`, role: i % 2 ? 'assistant' : 'user', content: `msg ${i}`, timestamp: i,
      })),
    },
  } as never);
}

const composer = () => screen.getByRole('textbox') as HTMLTextAreaElement;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no layout, so no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  sse.sendMessage.mockClear();
  sse.abort.mockClear();
  at.fetch.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the workspace shows as soon as a folder is chosen', () => {
  it('no folder → the welcome card, no workspace', () => {
    seed({ folder: null });
    render(<CodeSurface />);
    expect(screen.getByText('Start coding')).toBeTruthy();
    expect(screen.queryByTestId('workspace')).toBeNull();
  });

  it('folder but no messages → the workspace, with the composer docked in chat', () => {
    seed({ messages: 0 });
    render(<CodeSurface />);
    expect(screen.getByTestId('workspace')).toBeTruthy();
    expect(screen.getByTestId('code-chat-empty')).toBeTruthy();
    expect(composer().placeholder).toMatch(/small todo/);
  });
});

describe('the composer after the first message', () => {
  it('still offers slash commands', () => {
    seed({ messages: 2 });
    render(<CodeSurface />);
    fireEvent.change(composer(), { target: { value: '/thi' } });
    expect(screen.getByText('/think')).toBeTruthy();
  });

  it('still resolves @-mentions against the folder', () => {
    seed({ messages: 2 });
    render(<CodeSurface />);
    fireEvent.change(composer(), { target: { value: 'look at @src' } });
    expect(at.fetch).toHaveBeenCalledWith('src', WS);
  });

  it('runs a slash command locally instead of sending it', async () => {
    seed({ messages: 2 });
    render(<CodeSurface />);
    fireEvent.change(composer(), { target: { value: '/think high' } });
    // Close the suggestion list first so Enter is a submit, not a pick.
    fireEvent.keyDown(composer(), { key: 'Escape' });
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(sse.sendMessage).not.toHaveBeenCalled();
    expect(useCodeStore.getState().sessionControls[CHAT]).toBeTruthy();
  });

  it('Enter while streaming does not abort; Esc does', () => {
    seed({ messages: 2, streaming: true });
    render(<CodeSurface />);
    fireEvent.change(composer(), { target: { value: 'next thing' } });
    fireEvent.keyDown(composer(), { key: 'Enter' });
    expect(sse.abort).not.toHaveBeenCalled();
    fireEvent.keyDown(composer(), { key: 'Escape' });
    expect(sse.abort).toHaveBeenCalledTimes(1);
  });

  it('Enter during IME composition does not send', () => {
    seed({ messages: 2 });
    render(<CodeSurface />);
    fireEvent.change(composer(), { target: { value: 'にほん' } });
    fireEvent.keyDown(composer(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(composer(), { key: 'Enter', keyCode: 229 });
    expect(sse.sendMessage).not.toHaveBeenCalled();
  });

  it('a later send does not rename a titled conversation', async () => {
    seed({ messages: 2, title: 'Fix the login test' });
    render(<CodeSurface />);
    fireEvent.change(composer(), { target: { value: 'also update the README' } });
    await act(async () => { fireEvent.keyDown(composer(), { key: 'Enter' }); });
    await vi.waitFor(() => expect(sse.sendMessage).toHaveBeenCalled());
    const conv = useConversationStore.getState().conversations.find((c) => c.id === CHAT)!;
    expect(conv.title).toBe('Fix the login test');
    expect(conv.lastMessage).toBe('also update the README');
  });

  it('a turn carries the folder and the user’s settings, which Code once did not send', async () => {
    seed({ messages: 0 });
    render(<CodeSurface />);
    fireEvent.change(composer(), { target: { value: 'add dark mode' } });
    await act(async () => { fireEvent.keyDown(composer(), { key: 'Enter' }); });
    await vi.waitFor(() => expect(sse.sendMessage).toHaveBeenCalled());
    const [message, chatId, surface, , extra] = sse.sendMessage.mock.calls[0] as unknown as [
      string, string, string, unknown, Record<string, unknown>,
    ];
    expect([message, chatId, surface]).toEqual(['add dark mode', CHAT, 'code']);
    expect(extra.cwd).toBe(WS);
    expect(extra).toHaveProperty('securitySettings');
    expect(extra).toHaveProperty('searchSettings');
    expect(extra).toHaveProperty('deckTheme');
  });

  it('the first send titles an untitled conversation', async () => {
    seed({ messages: 0, title: 'New Chat' });
    render(<CodeSurface />);
    fireEvent.change(composer(), { target: { value: 'add dark mode' } });
    await act(async () => { fireEvent.keyDown(composer(), { key: 'Enter' }); });
    await vi.waitFor(() => expect(sse.sendMessage).toHaveBeenCalled());
    expect(useConversationStore.getState().conversations.find((c) => c.id === CHAT)!.title).toBe('add dark mode');
  });
});
