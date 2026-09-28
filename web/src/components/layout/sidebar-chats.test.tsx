// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SidebarChats } from './sidebar-chats';
import { useConversationStore } from '@/stores/conversation-store';
import { useChatStore } from '@/stores/chat-store';
import { useCoworkStore } from '@/stores/cowork-store';
import { useAppStore } from '@/stores/app-store';

const conv = (id: string, surface: string, title: string) => ({
  id, surface, title, lastMessage: '', createdAt: Date.now(), updatedAt: Date.now(),
});

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  (Element.prototype as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [];
  useConversationStore.setState({
    conversations: [conv('cw1', 'cowork', 'Tidy the downloads folder'), conv('cw2', 'cowork', 'Budget sheet')],
    activeId: null,
  });
  useChatStore.setState({ messages: { chatA: [] }, currentChatId: 'chatA' });
  useCoworkStore.setState({
    currentChatId: 'cw2',
    messages: {
      cw1: [{ id: 'm1', role: 'user', content: 'move every PDF into Archive', timestamp: 0 }],
      cw2: [{ id: 'm2', role: 'user', content: 'sum column B', timestamp: 0 }],
    },
  });
  useAppStore.setState({ activeSurface: 'cowork' } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SidebarChats — deleting', () => {
  it('clears the transcript from the store that owns it, and leaves Chat alone', () => {
    render(<SidebarChats />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Tidy the downloads folder' }));

    expect(useConversationStore.getState().conversations.map((c) => c.id)).toEqual(['cw2']);
    expect(useCoworkStore.getState().messages.cw1).toBeUndefined();
    // Cowork's other conversation is untouched, and so is Chat's selection.
    expect(useCoworkStore.getState().currentChatId).toBe('cw2');
    expect(useChatStore.getState().currentChatId).toBe('chatA');
  });

  it('deleting the open conversation clears that surface’s selection only', () => {
    render(<SidebarChats />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Budget sheet' }));
    expect(useCoworkStore.getState().currentChatId).toBe('');
    expect(useChatStore.getState().currentChatId).toBe('chatA');
  });

  it('can be undone: the conversation and its messages come back', () => {
    render(<SidebarChats />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Tidy the downloads folder' }));
    expect(screen.getByRole('status').textContent).toMatch(/Deleted/);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(useConversationStore.getState().conversations.some((c) => c.id === 'cw1')).toBe(true);
    expect(useCoworkStore.getState().messages.cw1?.[0].content).toBe('move every PDF into Archive');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('SidebarChats — search', () => {
  it('finds a conversation by what was said in it, not only its title', () => {
    render(<SidebarChats />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'archive' } });
    expect(screen.getByText('Tidy the downloads folder')).toBeTruthy();
    expect(screen.queryByText('Budget sheet')).toBeNull();
  });
});
