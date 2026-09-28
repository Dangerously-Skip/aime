// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { AppShell } from './app-shell';
import { useAppStore } from '@/stores/app-store';
import { useConversationStore } from '@/stores/conversation-store';

/**
 * ⌘K opens one search palette, and so does the sidebar's Search button.
 *
 * REGRESSION: ⌘K switched to Chats and focused whichever input had
 * `placeholder="Search..."` — a field that filters only the current surface's
 * list — while "Search ⌘K" in the sidebar did the same by a second copy of
 * that selector. A chat on another surface could not be found from the
 * shortcut labelled "search".
 *
 * The shell's heavy children (surfaces, tabbar, project views, schedulers)
 * are stubbed; the real shell, sidebar, palette and stores run.
 */

vi.mock('./surface-router', () => ({ SurfaceRouter: () => null }));
vi.mock('./tabbar', () => ({ Tabbar: () => null }));
vi.mock('./schedulers', () => ({ Schedulers: () => null }));
vi.mock('./activity-feed-panel', () => ({ ActivityFeedPanel: () => null }));
vi.mock('@/components/shared/update-banner', () => ({ UpdateBanner: () => null }));
vi.mock('@/components/shared/reminder-modal', () => ({ ReminderModal: () => null }));
vi.mock('@/components/customize/customize-view', () => ({ CustomizeView: () => null }));
vi.mock('@/components/projects/project-grid', () => ({ ProjectGrid: () => null }));
vi.mock('@/components/projects/project-detail', () => ({ ProjectDetail: () => null }));
vi.mock('@/components/projects/project-settings', () => ({ ProjectSettings: () => null }));
vi.mock('@/components/projects/project-create', () => ({ ProjectCreate: () => null }));
vi.mock('@/hooks/use-push-to-talk', () => ({ usePushToTalk: () => {} }));

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

const now = Date.now();

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => json({})));
  Element.prototype.scrollIntoView = vi.fn();
  // cmdk measures its list; jsdom has no ResizeObserver.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // base-ui's ScrollArea calls viewport.getAnimations() from a timer; jsdom lacks it.
  Element.prototype.getAnimations ??= () => [];
  useAppStore.setState({ activeSurface: 'chat', sidebarMode: 'history', sidebarVisible: true, settingsOpen: false });
  useConversationStore.setState({
    activeId: null,
    conversations: [
      { id: 'c1', title: 'Quarterly revenue model', surface: 'cowork', lastMessage: '', createdAt: now, updatedAt: now },
      { id: 'c2', title: 'Fix the login bug', surface: 'code', lastMessage: '', createdAt: now, updatedAt: now - 1 },
    ],
  } as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const palette = () => screen.queryByRole('dialog', { name: 'Search' });
const pressCmdK = (init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key: 'k', metaKey: true, ...init });

describe('⌘K search palette', () => {
  it('⌘K opens the palette, and ⌘K again closes it', async () => {
    render(<AppShell />);
    expect(palette()).toBeNull();

    pressCmdK();
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeTruthy();

    pressCmdK();
    await waitFor(() => expect(palette()).toBeNull());
  });

  it('the sidebar Search button opens the same palette', async () => {
    render(<AppShell />);
    fireEvent.click(screen.getByRole('button', { name: /^Search/ }));
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeTruthy();
  });

  it('finds a chat on another surface and opens it there', async () => {
    render(<AppShell />);
    pressCmdK();
    const dialog = await screen.findByRole('dialog', { name: 'Search' });

    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'revenue' } });
    const option = await within(dialog).findByRole('option', { name: /Quarterly revenue model/ });
    expect(within(dialog).queryByRole('option', { name: /Fix the login bug/ })).toBeNull();
    fireEvent.click(option);

    await waitFor(() => expect(palette()).toBeNull());
    expect(useAppStore.getState().activeSurface).toBe('cowork');
    expect(useConversationStore.getState().activeId).toBe('c1');
  });

  it('jumps to a Customize section', async () => {
    render(<AppShell />);
    pressCmdK();
    const dialog = await screen.findByRole('dialog', { name: 'Search' });

    fireEvent.click(within(dialog).getByRole('option', { name: /Customize › Agents/ }));

    expect(useAppStore.getState().sidebarMode).toBe('customize');
    expect(useAppStore.getState().customizeSection).toBe('agents');
  });

  it('leaves ⌘K alone when a focused component already handled it', () => {
    render(<AppShell />);
    const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true });
    ev.preventDefault(); // e.g. the code terminal's clear-screen
    window.dispatchEvent(ev);
    expect(palette()).toBeNull();
  });
});
