// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ProjectGrid } from './project-grid';
import { ProjectDetail } from './project-detail';
import { useProjectStore, type Project } from '@/stores/project-store';
import { useConversationStore } from '@/stores/conversation-store';
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

  it('says so when the save did not land, instead of losing the schedule', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    renderDetail();
    fireEvent.click(screen.getByRole('button', { name: 'Add automation' }));
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not save/);
  });
});
