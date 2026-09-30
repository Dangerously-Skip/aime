// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { ProjectGrid } from './project-grid';
import { ProjectDetail } from './project-detail';
import { useProjectStore, type Project } from '@/stores/project-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useChatStore } from '@/stores/chat-store';
import { useAppStore } from '@/stores/app-store';
import { useHandoffStore } from '@/hooks/use-handoff-turn';
import { resetServerCredentials } from '@/hooks/use-builtin-access';
import { useComposerDrafts } from '@/components/shared/composer/draft-store';
import { ChatSurface } from '@/components/surfaces/chat/chat-surface';
import { streamRegistry } from '@/lib/stream-registry';
import { APP_NAME } from '@/config/branding';

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Launch',
  description: 'Ship it',
  customInstructions: '',
  knowledgeFiles: [],
  surfaces: [],
  color: '',
  icon: 'folder',
  starred: false,
  createdAt: 1,
  updatedAt: 1,
  artifacts: [],
  timeline: [],
  conversationIds: {},
  ...over,
} as Project);

let manifest: unknown[] = [];
let puts: unknown[][] = [];

beforeEach(() => {
  manifest = [];
  puts = [];
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/api/schedule/orders')) {
      if (init?.method === 'PUT') {
        const orders = JSON.parse(String(init.body)).orders;
        puts.push(orders);
        manifest = orders;
        return new Response('{}', { status: 200 });
      }
      return new Response(JSON.stringify({ orders: manifest }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
  useConversationStore.setState({ conversations: [], activeId: null } as never);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProjectGrid', () => {
  it('an empty page has ONE "New project" button', () => {
    useProjectStore.setState({ projects: [] } as never);
    render(<ProjectGrid onSelectProject={() => {}} onNewProject={() => {}} />);
    expect(screen.getAllByRole('button', { name: /New project/ })).toHaveLength(1);
    // Nothing to search or sort yet.
    expect(screen.queryByPlaceholderText('Search projects...')).toBeNull();
  });

  it('with projects, the header keeps its button', () => {
    useProjectStore.setState({ projects: [project()] } as never);
    render(<ProjectGrid onSelectProject={() => {}} onNewProject={() => {}} />);
    expect(screen.getAllByRole('button', { name: /New project/ })).toHaveLength(1);
    expect(screen.getByPlaceholderText('Search projects...')).toBeTruthy();
  });
});

describe('ProjectDetail', () => {
  const renderDetail = () =>
    render(<ProjectDetail projectId="p1" onBack={() => {}} onOpenConversation={() => {}} onOpenSettings={() => {}} />);

  beforeEach(() => {
    useProjectStore.setState({ projects: [project()] } as never);
  });

  it('has no fake "Team — Coming Soon" block', () => {
    renderDetail();
    expect(screen.queryByText(/Multiplayer Mode Coming Soon/)).toBeNull();
    expect(screen.queryByText('Invite teammate')).toBeNull();
  });

  it('schedules an automation through the picker, filed under the project', async () => {
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Add automation' }));
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekdays' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:30' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Standup notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0][0]).toMatchObject({
      instruction: 'Standup notes',
      attended: true,
      projectId: 'p1',
      trigger: { type: 'cron', expression: '30 8 * * 1-5' },
    });
    // Listed in words, with where it runs.
    expect(await screen.findByText('Weekdays at 8:30 AM')).toBeTruthy();
    expect(screen.getByText(`Needs ${APP_NAME} open`)).toBeTruthy();
  });

  /*
   * The project page used to run its first chat turn itself — a sixth copy of
   * the send path, which sent no memories, theme, search or security settings,
   * wrote failures into the reply as text, and could not be retried because it
   * unmounted as soon as it opened the chat. It now hands the message to Chat.
   */
  describe('starting a chat from the project', () => {
    const answerModels = (anthropic: boolean) =>
      vi.fn(async (url: string) =>
        String(url).includes('/api/models')
          ? new Response(JSON.stringify({ anthropic, bedrock: false }), { status: 200 })
          : new Response('{}', { status: 200 }),
      );

    beforeEach(() => {
      resetServerCredentials();
      useHandoffStore.setState({ turns: {} });
      useComposerDrafts.setState({ drafts: {}, lastSent: {} });
      useAppStore.setState({ activeSurface: 'cowork' } as never);
    });

    async function type(text: string) {
      const box = screen.getByPlaceholderText('How can I help you today?');
      fireEvent.change(box, { target: { value: text } });
      await act(async () => {
        fireEvent.keyDown(box, { key: 'Enter' });
      });
    }

    it('files a chat under the project, opens it, and hands Chat the message', async () => {
      const fetchMock = answerModels(true);
      vi.stubGlobal('fetch', fetchMock);
      const onOpen = vi.fn();
      render(<ProjectDetail projectId="p1" onBack={() => {}} onOpenConversation={onOpen} onOpenSettings={() => {}} />);
      await act(async () => { await Promise.resolve(); });
      await type('Summarise the launch plan');

      const conv = useConversationStore.getState().conversations.find((c) => c.projectId === 'p1')!;
      expect(conv).toMatchObject({ surface: 'chat' });
      expect(onOpen).toHaveBeenCalledWith(conv.id);
      expect(useConversationStore.getState().activeId).toBe(conv.id);
      expect(useAppStore.getState().activeSurface).toBe('chat');
      // The page sends nothing itself: Chat runs the turn.
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/chat/'))).toBe(false);
      expect(useHandoffStore.getState().turns[`chat:${conv.id}`]).toMatchObject({ text: 'Summarise the launch plan' });
    });

    it('says "Connect a model" instead of opening a chat that can only fail', async () => {
      vi.stubGlobal('fetch', answerModels(false));
      const onOpen = vi.fn();
      render(<ProjectDetail projectId="p1" onBack={() => {}} onOpenConversation={onOpen} onOpenSettings={() => {}} />);
      await act(async () => { await Promise.resolve(); });
      await type('hello');
      expect(onOpen).not.toHaveBeenCalled();
      expect(useConversationStore.getState().conversations).toHaveLength(0);
      expect(screen.getByRole('alert').textContent).toMatch(/No model is set up yet/);
    });

    it('Chat sends the handed-over message with the project’s instructions', async () => {
      useProjectStore.setState({ projects: [project({ customInstructions: 'Answer in French.' })] } as never);
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes('/api/models')) return new Response(JSON.stringify({ anthropic: true, bedrock: false }));
        if (String(url).includes('/api/chat/')) {
          // Headers arrive; the body never does — enough to read the request.
          const signal = init?.signal as AbortSignal;
          const body = new ReadableStream({ start(c) { signal.addEventListener('abort', () => c.error(signal.reason)); } });
          return new Response(body, { status: 200 });
        }
        return new Response('{}', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      Element.prototype.scrollIntoView = () => {};
      useChatStore.setState({ messages: {}, currentChatId: null, streamingChats: {} } as never);

      const detail = render(<ProjectDetail projectId="p1" onBack={() => {}} onOpenConversation={() => {}} onOpenSettings={() => {}} />);
      await act(async () => { await Promise.resolve(); });
      await type('Summarise the launch plan');
      detail.unmount();
      const conv = useConversationStore.getState().conversations.find((c) => c.projectId === 'p1')!;

      // What the app shell does next: the surfaces mount with the chat active.
      render(<ChatSurface />);
      await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/chat/'))).toBe(true));
      const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/chat/'))!;
      const body = JSON.parse(String(init!.body));
      expect(body).toMatchObject({ message: 'Summarise the launch plan', chatId: conv.id, projectInstructions: 'Answer in French.' });
      expect(useConversationStore.getState().conversations.find((c) => c.id === conv.id)?.title).toBe('Summarise the launch plan');
      streamRegistry.abort(conv.id, 'user');
    });
  });

  it('says so when the save did not land, instead of losing the schedule', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Add automation' }));
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not save/);
  });
});
