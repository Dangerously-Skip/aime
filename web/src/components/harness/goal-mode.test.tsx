// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { GoalModeBar, goalSettingsFrom, DEFAULT_BUDGET_USD } from './goal-mode';

afterEach(cleanup);

const bar = (over: Partial<Parameters<typeof GoalModeBar>[0]> = {}) =>
  render(
    <GoalModeBar budget="2" cap="12" onBudget={() => {}} onCap={() => {}} {...over} />,
  );

describe('the goal-mode explainer', () => {
  it('is hidden until asked for', () => {
    bar();
    expect(screen.queryByText(/differs from a normal message/i)).toBeNull();
  });

  it('explains how a goal DIFFERS from a normal send, not just what the numbers mean', () => {
    /*
     * The numbers were explained and the mode was not, so the toggle read as
     * "chat, but with a budget". The difference is the whole point: many turns
     * rather than one, a plan of checkable steps, and a separate agent that
     * re-runs the checks before anything counts as done.
     */
    bar();
    fireEvent.click(screen.getByRole('button', { name: /what do these limits mean/i }));
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/differs from a normal message/i);
    expect(text).toMatch(/one turn/i);
    expect(text).toMatch(/many turns/i);
    // The verifier, which is the part nobody would guess at.
    expect(text).toMatch(/cannot edit anything/i);
    // And that it waits rather than timing out.
    expect(text).toMatch(/however long that takes/i);
  });

  it('still explains the limits', () => {
    bar();
    fireEvent.click(screen.getByRole('button', { name: /what do these limits mean/i }));
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/spends money with nobody watching/i);
    expect(text).toMatch(/three sessions in a row/i);
  });

  it('is ATTACHED to the composer, not a card of its own', () => {
    /*
     * "It looks like a box under a box." The numbers belong to the send button
     * whose meaning they change, so the bar shares the composer's border rather
     * than floating below it. A structural check on the class list — the visual
     * result still needs eyes.
     */
    const { container } = bar();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('border-t');
    expect(root.className).not.toContain('rounded');
  });

  it('shows an error where the numbers are', () => {
    bar({ error: 'Give it a budget above zero.' });
    expect(screen.getByText(/budget above zero/i)).toBeTruthy();
  });
});

describe('goalSettingsFrom', () => {
  it('accepts sensible numbers', () => {
    expect(goalSettingsFrom(String(DEFAULT_BUDGET_USD), '12')).toEqual({ budgetUsd: 2, sessionCap: 12 });
  });
  it('refuses a zero or negative budget', () => {
    expect(typeof goalSettingsFrom('0', '12')).toBe('string');
    expect(typeof goalSettingsFrom('-1', '12')).toBe('string');
  });
  it('refuses a fractional session count', () => {
    expect(typeof goalSettingsFrom('2', '1.5')).toBe('string');
  });
});
