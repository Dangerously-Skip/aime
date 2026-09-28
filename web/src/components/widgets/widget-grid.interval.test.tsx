// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { WidgetGrid } from './widget-grid';
import { useWidgetStore } from '@/stores/widget-store';
import { useRunStore } from '@/stores/run-store';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useWidgetStore.setState({ widgets: [] });
  useRunStore.setState({ goals: [], runs: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openForm = () => {
  render(<WidgetGrid />);
  fireEvent.click(screen.getByRole('button', { name: /New widget/ }));
  fireEvent.change(screen.getByPlaceholderText(/Recipe/), { target: { value: 'Top HN stories' } });
};

describe('widget refresh interval', () => {
  it('refuses an unreadable interval instead of silently making the widget manual', () => {
    openForm();
    fireEvent.change(screen.getByLabelText('Refresh every'), { target: { value: '30 mns' } });
    expect(screen.getByRole('alert').textContent).toMatch(/not an interval/);
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reads the same spellings the scheduler does, and says what it understood', () => {
    openForm();
    fireEvent.change(screen.getByLabelText('Refresh every'), { target: { value: '1.5h' } });
    expect(screen.getByText('Refreshes: every 90 minutes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(useWidgetStore.getState().widgets[0].refreshEverySeconds).toBe(5_400);
  });
});
