// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { NARROW_WINDOW_QUERY, SidebarFrame, useResponsiveSidebar } from './responsive-sidebar';
import { useAppStore } from '@/stores/app-store';

/**
 * Narrow windows collapse the sidebar; the user's own choice survives.
 *
 * REGRESSION: the sidebar was a fixed 250px at every width, so at 900px the
 * Browser surface was ~280px wide. matchMedia is stubbed with a controllable
 * width (jsdom has none); the real hook, store and frame run.
 */

let width = 1400;
const listeners = new Set<() => void>();

function setWidth(w: number) {
  width = w;
  act(() => listeners.forEach((l) => l()));
}

beforeEach(() => {
  width = 1400;
  listeners.clear();
  window.localStorage.clear();
  vi.stubGlobal('matchMedia', (query: string) => {
    expect(query).toBe(NARROW_WINDOW_QUERY);
    return {
      get matches() { return width < 1100; },
      media: query,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    };
  });
  useAppStore.setState({ sidebarVisible: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The shell's wiring, minus everything else the shell mounts. */
function Shell() {
  const narrow = useResponsiveSidebar();
  const open = useAppStore((s) => s.sidebarVisible);
  const close = () => useAppStore.getState().setSidebarVisible(false);
  return (
    <SidebarFrame narrow={narrow} open={open} onClose={close}>
      <nav>sidebar</nav>
    </SidebarFrame>
  );
}

const frame = () => screen.getByText('sidebar').parentElement!;
const visible = () => useAppStore.getState().sidebarVisible;

describe('useResponsiveSidebar', () => {
  it('stays docked on a wide window', () => {
    render(<Shell />);
    expect(frame().dataset.sidebarMode).toBe('docked');
    expect(visible()).toBe(true);
  });

  it('collapses below 1100px and restores the docked sidebar when widened', () => {
    render(<Shell />);
    setWidth(900);
    expect(visible()).toBe(false);
    expect(frame().dataset.sidebarMode).toBe('overlay');

    setWidth(1300);
    expect(visible()).toBe(true);
    expect(frame().dataset.sidebarMode).toBe('docked');
  });

  it('starts collapsed when the window is already narrow at launch', () => {
    width = 900;
    render(<Shell />);
    expect(visible()).toBe(false);
  });

  it('respects a sidebar the user hid: it stays hidden after a trip through narrow', () => {
    useAppStore.setState({ sidebarVisible: false });
    render(<Shell />);
    setWidth(900);
    // Opened as an overlay while narrow…
    act(() => useAppStore.getState().setSidebarVisible(true));
    setWidth(1300);
    // …but the docked choice was "hidden", and that is what comes back.
    expect(visible()).toBe(false);
  });

  it('a collapse is not persisted as the user\'s choice across a relaunch', () => {
    width = 900;
    const first = render(<Shell />);
    expect(visible()).toBe(false); // the persisted store now says hidden
    first.unmount();

    width = 1300;
    render(<Shell />);
    expect(visible()).toBe(true);
  });
});

describe('SidebarFrame overlay', () => {
  it('opens over the content with the existing toggle, and closes on backdrop or Escape', () => {
    render(<Shell />);
    setWidth(900);
    expect(frame().getAttribute('aria-hidden')).toBe('true');

    act(() => useAppStore.getState().toggleSidebar());
    expect(frame().getAttribute('aria-hidden')).toBe('false');
    expect(frame().className).toContain('fixed');

    fireEvent.click(screen.getByTestId('sidebar-backdrop'));
    expect(visible()).toBe(false);

    act(() => useAppStore.getState().toggleSidebar());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(visible()).toBe(false);
  });

  it('keeps the sidebar mounted while collapsed (it owns the Settings dialog)', () => {
    render(<Shell />);
    setWidth(900);
    expect(visible()).toBe(false);
    expect(screen.getByText('sidebar')).toBeTruthy();
  });
});
