// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { GoalEntry } from './goal-entry';

/**
 * The entry point has to exist where the user is.
 *
 * The start form was first mounted only in the Cowork sidebar — which does not
 * render in the empty state — so a fresh conversation with a folder chosen, the
 * exact moment someone wants a goal run, offered nothing at all. Tests passed
 * throughout; only looking at the screen found it.
 */
vi.mock('./start-goal', () => ({
  StartGoal: () => <div>START FORM</div>,
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ goal: null }) })) as unknown as typeof fetch;

describe('GoalEntry', () => {
  it('offers the option once a folder is chosen', () => {
    render(<GoalEntry chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    expect(screen.getByRole('button', { name: /pursue a goal/i })).toBeTruthy();
  });

  it('renders NOTHING without a folder, rather than a dead end', () => {
    // The ledger and progress log live in the working folder; offering the
    // option with nowhere to put them would be offering a failure.
    render(<GoalEntry chatId="c1" folder={null} surfaceId="cowork" />);
    expect(screen.queryByRole('button', { name: /pursue a goal/i })).toBeNull();
  });

  it('is collapsed until asked for', () => {
    // Ordinary chat is what the surface is for; an always-open form would make
    // an occasional mode look like the main one.
    render(<GoalEntry chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    expect(screen.queryByText('START FORM')).toBeNull();
  });

  it('opens the form when clicked', () => {
    render(<GoalEntry chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    fireEvent.click(screen.getByRole('button', { name: /pursue a goal/i }));
    expect(screen.getByText('START FORM')).toBeTruthy();
  });
});

vi.mock('./goal-panel', () => ({ GoalPanel: () => <div>STATUS PANEL</div> }));

describe('GoalEntry — an existing run', () => {
  it('shows STATUS, not a start form, once a goal exists', async () => {
    /*
     * The failure this fixes: a goal ran to completion and fixed the code, and
     * the only thing on screen was a start form erroring "this conversation
     * already has a goal". The status panel lives in the sidebar, which the
     * empty state does not render — so a working run was invisible.
     */
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ goal: { objective: 'x' } }) })) as unknown as typeof fetch;
    render(<GoalEntry chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByText('STATUS PANEL')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /pursue a goal/i })).toBeNull();
  });

  it('still offers to start when there is no goal', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ goal: null }) })) as unknown as typeof fetch;
    render(<GoalEntry chatId="c1" folder="/tmp/p" surfaceId="cowork" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /pursue a goal/i })).toBeTruthy());
    expect(screen.queryByText('STATUS PANEL')).toBeNull();
  });
});
