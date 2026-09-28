// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SidebarCustomize, CUSTOMIZE_NAV } from './sidebar-customize';
import { SkillDetail } from '@/components/customize/skill-detail';
import { useAppStore } from '@/stores/app-store';
import { useCustomizeUiStore } from '@/stores/customize-ui-store';

/**
 * The Customize sidebar's controls must each do something.
 *
 * The `+` beside "No skills installed. Create one to get started." had no
 * onClick and no accessible name; an "OAuth" group was rendered from state
 * nothing ever wrote; and Agents was reachable only from the landing page.
 *
 * Only fetch is stubbed — the real stores and the real SkillDetail run, so
 * "clicking + opens the composer" is proven across the two component trees,
 * not asserted on a store call.
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();

function serve(skills: Array<{ id: string; name: string; description: string }> = []) {
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith('/api/customize/skills')) return json({ skills });
    if (u.includes('/api/customize/connectors')) return json({ connectors: [] });
    if (u.includes('/api/marketplace')) return json({ plugins: [] });
    return json({});
  });
}

/** Sidebar plus the pane it drives, wired to the real store selection. */
function Harness() {
  const selectedSkillId = useAppStore((s) => s.selectedSkillId);
  return (
    <>
      <SidebarCustomize />
      <SkillDetail skillId={selectedSkillId} />
    </>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  serve();
  vi.stubGlobal('fetch', fetchMock);
  useAppStore.setState({ customizeSection: 'skills', selectedSkillId: null, selectedConnectorId: null });
  useCustomizeUiStore.setState({ composingSkill: false, skillsRevision: 0 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SidebarCustomize — the + button', () => {
  it('is named, and opens the skill composer in the main pane', async () => {
    render(<Harness />);
    await screen.findByText(/No skills installed/);

    // The sidebar's button (first); the pane's empty state has its own.
    fireEvent.click(screen.getAllByRole('button', { name: 'Create skill' })[0]);

    expect(await screen.findByText('Create New Skill')).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it('the empty-state sentence links to the composer too', async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create one' }));
    expect(await screen.findByText('Create New Skill')).toBeTruthy();
  });

  it('in Connectors it is "Add connector" and opens the connector catalogue', async () => {
    useAppStore.setState({ customizeSection: 'connectors' });
    render(<SidebarCustomize />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add connector' }));

    expect(useAppStore.getState().customizeSection).toBe('browse-connectors');
  });

  it('refetches the skill list when the pane reports a change', async () => {
    render(<SidebarCustomize />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)); // skills + marketplace
    serve([{ id: 'new-one', name: 'new-one', description: '' }]);

    useCustomizeUiStore.getState().skillsChanged();

    expect(await screen.findByText('new-one')).toBeTruthy();
  });
});

describe('SidebarCustomize — sections', () => {
  it('lists Agents, and it navigates there', async () => {
    render(<SidebarCustomize />);
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(useAppStore.getState().customizeSection).toBe('agents');
  });

  it('has a nav entry for every Customize section with a page of its own', () => {
    const sections = CUSTOMIZE_NAV.flatMap((n) => [n.section, ...(n.alsoActiveFor ?? [])]);
    for (const s of ['skills', 'connectors', 'browse-connectors', 'browse-marketplace', 'automation', 'agents', 'design']) {
      expect(sections, s).toContain(s);
    }
  });

  it('renders no OAuth group — nothing ever populated one', async () => {
    useAppStore.setState({ customizeSection: 'connectors' });
    render(<SidebarCustomize />);
    await screen.findByText('No connectors configured yet.');
    expect(screen.queryByText('OAuth')).toBeNull();
  });
});
