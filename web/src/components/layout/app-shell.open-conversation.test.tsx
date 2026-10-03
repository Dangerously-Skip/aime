// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { AppShell } from './app-shell';
import { useAppStore, type Surface } from '@/stores/app-store';
import { useConversationStore } from '@/stores/conversation-store';

/**
 * Opening a conversation created IN THE SAME EVENT.
 *
 * REGRESSION: the shell's `handleOpenConversation` looked the conversation up
 * in the list from its last render. One created a moment earlier in the same
 * click was not in it, so the surface never switched — a project's "start in
 * Cowork" left you on whatever surface you had been on, looking at a
 * conversation that belonged to another. The project page papered over it for
 * Chat alone by switching the surface itself.
 *
 * The stand-in project page below does exactly what the real one does —
 * `addConversation` then `onOpenConversation`, synchronously — and nothing
 * more. The rest of the shell's heavy children are stubbed.
 */

vi.mock('@/components/projects/project-detail', async () => {
  const { useConversationStore: conversations } = await import('@/stores/conversation-store');
  return {
    ProjectDetail: ({ onOpenConversation }: { onOpenConversation: (id: string) => void }) => {
      const start = (surface: Surface) => {
        const id = `new-${surface}`;
        conversations.getState().addConversation({
          id,
          title: 'New Chat',
          surface,
          lastMessage: '',
          createdAt: 1,
          updatedAt: 1,
          projectId: 'p1',
        });
        onOpenConversation(id);
      };
      return (
        <div>
          <button onClick={() => start('cowork')}>Start in Cowork</button>
          <button onClick={() => start('code')}>Start in Code</button>
        </div>
      );
    },
  };
});
vi.mock('./surface-router', () => ({ SurfaceRouter: () => null }));
vi.mock('./tabbar', () => ({ Tabbar: () => null }));
vi.mock('./sidebar', () => ({ Sidebar: () => null }));
vi.mock('./schedulers', () => ({ Schedulers: () => null }));
vi.mock('./activity-feed-panel', () => ({ ActivityFeedPanel: () => null }));
vi.mock('./search-palette', () => ({ SearchPalette: () => null }));
vi.mock('@/components/shared/update-banner', () => ({ UpdateBanner: () => null }));
vi.mock('@/components/customize/customize-view', () => ({ CustomizeView: () => null }));
vi.mock('@/components/projects/project-grid', () => ({ ProjectGrid: () => null }));
vi.mock('@/components/projects/project-settings', () => ({ ProjectSettings: () => null }));
vi.mock('@/components/projects/project-create', () => ({ ProjectCreate: () => null }));
vi.mock('@/hooks/use-push-to-talk', () => ({ usePushToTalk: () => {} }));

beforeEach(() => {
  useAppStore.setState({ activeSurface: 'chat', sidebarMode: 'projects', viewingProjectId: 'p1', sidebarVisible: true });
  useConversationStore.setState({ activeId: null, conversations: [] } as never);
});
afterEach(() => cleanup());

describe('the shell opens a conversation created in the same click', () => {
  it.each([
    ['Cowork', 'cowork'],
    ['Code', 'code'],
  ])('switches to %s and shows the new conversation', (label, surface) => {
    render(<AppShell />);
    fireEvent.click(screen.getByText(`Start in ${label}`));

    expect(useAppStore.getState().activeSurface).toBe(surface);
    expect(useConversationStore.getState().activeId).toBe(`new-${surface}`);
    // Out of the project page and onto the conversation.
    expect(useAppStore.getState().sidebarMode).toBe('history');
    expect(useAppStore.getState().viewingProjectId).toBeNull();
  });
});
