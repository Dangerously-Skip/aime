// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Sidebar } from './sidebar';
import { useAppStore } from '@/stores/app-store';

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => json({})));
  useAppStore.setState({ sidebarMode: 'history', customizeSection: 'landing', settingsOpen: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Sidebar — Customize', () => {
  it('returns to the Customize landing page from inside a section', () => {
    useAppStore.setState({ sidebarMode: 'customize', customizeSection: 'design' });
    render(<Sidebar onNewProject={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));

    expect(useAppStore.getState().sidebarMode).toBe('customize');
    expect(useAppStore.getState().customizeSection).toBe('landing');
  });
});

describe('Sidebar — feedback without a FeedlyBackly key', () => {
  it('is labelled for what it does, opens GitHub Issues, and loads no widget script', () => {
    vi.stubEnv('NEXT_PUBLIC_FEEDLYBACKLY_API_KEY', '');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    try {
      render(<Sidebar onNewProject={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: 'Report an issue on GitHub' }));

      expect(open).toHaveBeenCalledWith(
        'https://github.com/Dangerously-Skip/aime/issues/new',
        '_blank',
        'noopener,noreferrer',
      );
      expect(document.getElementById('feedlybackly-script')).toBeNull();
    } finally {
      open.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
