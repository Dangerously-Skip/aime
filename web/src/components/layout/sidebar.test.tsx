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
