// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

afterEach(cleanup);

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
