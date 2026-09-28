// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Tabbar } from './tabbar';
import { useAppStore } from '@/stores/app-store';
import { useWidgetStore } from '@/stores/widget-store';
import { useContextBusStore } from '@/stores/context-bus-store';

/**
 * The tab bar printed a number on every tab and only handled ⌘1–⌘4, so ⌘5
 * (Assistant) did nothing. And in Customize/Projects — which replace the
 * surface area — "Chat" stayed highlighted over a page that was not Chat.
 */

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  useWidgetStore.setState({ widgets: [] } as never);
  useContextBusStore.setState({ events: [] } as never);
  useAppStore.setState({ activeSurface: 'chat', sidebarMode: 'history' } as never);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const tab = (label: string) => screen.getByText(label).closest('button')!;

describe('⌘-digit shortcuts', () => {
  it.each([
    ['1', 'chat'],
    ['2', 'cowork'],
    ['3', 'code'],
    ['4', 'browser'],
    ['5', 'assistant'],
  ])('⌘%s selects %s', (key, surface) => {
    useAppStore.setState({ activeSurface: key === '1' ? 'code' : 'chat' } as never);
    render(<Tabbar />);
    fireEvent.keyDown(window, { key, metaKey: true });
    expect(useAppStore.getState().activeSurface).toBe(surface);
  });

  it('ignores digits past the last tab, and unmodified digits', () => {
    render(<Tabbar />);
    fireEvent.keyDown(window, { key: '6', metaKey: true });
    fireEvent.keyDown(window, { key: '3' });
    expect(useAppStore.getState().activeSurface).toBe('chat');
  });

  it('leaves Customize when a shortcut picks a surface', () => {
    useAppStore.setState({ sidebarMode: 'customize' } as never);
    render(<Tabbar />);
    fireEvent.keyDown(window, { key: '3', ctrlKey: true });
    expect(useAppStore.getState().activeSurface).toBe('code');
    expect(useAppStore.getState().sidebarMode).toBe('history');
  });
});

describe('active highlight', () => {
  it('marks the active surface in history mode', () => {
    render(<Tabbar />);
    expect(tab('Chat').getAttribute('aria-current')).toBe('page');
  });

  it.each(['customize', 'projects'] as const)('marks no tab while %s is open', (mode) => {
    useAppStore.setState({ sidebarMode: mode } as never);
    render(<Tabbar />);
    for (const label of ['Chat', 'Cowork', 'Code', 'Browser', 'Assistant']) {
      expect(tab(label).getAttribute('aria-current')).toBeNull();
    }
  });

  it('clicking a tab from Projects returns to the surfaces', () => {
    useAppStore.setState({ sidebarMode: 'projects' } as never);
    render(<Tabbar />);
    fireEvent.click(tab('Browser'));
    expect(useAppStore.getState()).toMatchObject({ activeSurface: 'browser', sidebarMode: 'history' });
  });
});
