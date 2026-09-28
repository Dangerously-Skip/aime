// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SkillDetail } from './skill-detail';
import { useAppStore } from '@/stores/app-store';
import { useCustomizeUiStore } from '@/stores/customize-ui-store';

/**
 * Create, save and delete report what the server said.
 *
 * All three ignored a failed response: `if (res.ok) { ... }` with no else, so
 * a 409 for a name already in use or a 500 from a read-only disk looked
 * exactly like a click that had not registered. Only fetch is stubbed.
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();

const SKILL = {
  id: 'weekly-report',
  name: 'weekly-report',
  description: 'Writes the weekly report',
  path: '/x/weekly-report',
  frontmatter: { name: 'weekly-report' },
  content: 'Do the thing.',
  files: [],
};

type Handler = (url: string, init?: RequestInit) => Response | undefined;

function serve(handler: Handler = () => undefined) {
  fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const hit = handler(u, init);
    if (hit) return hit;
    if (u.includes('/api/marketplace')) return json({ plugins: [] });
    if (u.endsWith(`/api/customize/skills/${SKILL.id}`)) return json({ skill: SKILL });
    return json({});
  });
}

function Harness() {
  const id = useAppStore((s) => s.selectedSkillId);
  return <SkillDetail skillId={id} />;
}

beforeEach(() => {
  fetchMock.mockReset();
  serve();
  vi.stubGlobal('fetch', fetchMock);
  useAppStore.setState({ customizeSection: 'skills', selectedSkillId: null });
  useCustomizeUiStore.setState({ composingSkill: false, skillsRevision: 0 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openComposerAndFill(name: string) {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: /Create skill/ }));
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
}

describe('SkillDetail — create', () => {
  it('shows the server reason when the create is refused, and keeps the form', async () => {
    serve((u, init) =>
      u.endsWith('/api/customize/skills') && init?.method === 'POST'
        ? json({ error: 'Skill directory already exists' }, 409)
        : undefined,
    );
    await openComposerAndFill('weekly-report');

    expect((await screen.findByRole('alert')).textContent).toContain('Skill directory already exists');
    expect(screen.getByText('Create New Skill')).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('weekly-report');
    expect(useCustomizeUiStore.getState().skillsRevision).toBe(0);
  });

  it('says so when the request never reaches the server', async () => {
    serve((u, init) => {
      if (u.endsWith('/api/customize/skills') && init?.method === 'POST') throw new TypeError('Failed to fetch');
      return undefined;
    });
    await openComposerAndFill('weekly-report');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't create the skill/);
  });

  it('on success opens the new skill and tells the sidebar to refetch', async () => {
    serve((u, init) =>
      u.endsWith('/api/customize/skills') && init?.method === 'POST' ? json({ skill: SKILL }, 201) : undefined,
    );
    await openComposerAndFill('weekly-report');

    await waitFor(() => expect(useAppStore.getState().selectedSkillId).toBe('weekly-report'));
    expect(useCustomizeUiStore.getState().skillsRevision).toBe(1);
    expect(await screen.findByText('Writes the weekly report')).toBeTruthy();
  });
});

describe('SkillDetail — save and delete', () => {
  beforeEach(() => {
    useAppStore.setState({ selectedSkillId: SKILL.id });
  });

  it('a refused save shows the reason and stays in edit mode', async () => {
    serve((u, init) =>
      init?.method === 'PUT' ? json({ error: 'Skill not found' }, 404) : undefined,
    );
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit skill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Skill not found');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('a refused delete keeps the skill open and says why', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    serve((u, init) =>
      init?.method === 'DELETE' ? json({ error: 'Permission denied' }, 500) : undefined,
    );
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete skill' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
    expect(useAppStore.getState().selectedSkillId).toBe(SKILL.id);
  });

  it('a successful delete clears the selection and refreshes the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    serve((u, init) => (init?.method === 'DELETE' ? json({ success: true }) : undefined));
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete skill' }));

    await waitFor(() => expect(useAppStore.getState().selectedSkillId).toBeNull());
    expect(useCustomizeUiStore.getState().skillsRevision).toBe(1);
  });
});
