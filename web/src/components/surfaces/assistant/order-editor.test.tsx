// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OrderEditor } from './order-editor';
import { TemplateDialog } from './template-dialog';
import { useAssistantStore, type StandingOrder } from '@/stores/assistant-store';
import { STANDING_ORDER_TEMPLATES } from '@/lib/standing-order-templates';

const order = (over: Partial<StandingOrder> = {}): StandingOrder => ({
  id: 'o1',
  instruction: 'Summarise the build',
  trigger: { type: 'event', event: 'build-failed' },
  state: {},
  status: 'active',
  notifyVia: 'assistant',
  runCount: 4,
  errorCount: 0,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const stored = () => useAssistantStore.getState().orders[0];

beforeEach(() => {
  useAssistantStore.setState({ orders: [order()], cards: [], activity: [] });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const open = (tab: 'Summary' | 'Customize' | 'Advanced') => {
  render(<OrderEditor orderId="o1" onClose={() => {}} />);
  fireEvent.click(screen.getByRole('tab', { name: tab }));
};

describe('Customize', () => {
  it('keeps an event trigger through a save — it used to be cast to cron/interval', () => {
    open('Customize');
    expect((screen.getByLabelText('Runs') as HTMLSelectElement).value).toBe('event');
    fireEvent.change(screen.getByLabelText('Instruction'), { target: { value: 'Summarise the failed build' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(stored().trigger).toEqual({ type: 'event', event: 'build-failed' });
    expect(stored().instruction).toBe('Summarise the failed build');
    // Confirmed, not silent.
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });

  it('saves a schedule through the picker and refuses an invalid one', () => {
    useAssistantStore.setState({ orders: [order({ trigger: { type: 'interval', expression: '1h' } })] });
    open('Customize');
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Custom schedule'), { target: { value: '0 9 * * *  *' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(stored().trigger).toEqual({ type: 'interval', expression: '1h' });
    expect(screen.getAllByRole('alert').some((a) => /5 fields/.test(a.textContent ?? ''))).toBe(true);

    fireEvent.change(screen.getByLabelText('Custom schedule'), { target: { value: '0 9 * * MON-FRI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(stored().trigger).toEqual({ type: 'cron', expression: '0 9 * * MON-FRI' });
  });
});

describe('Advanced', () => {
  it('shows a parse error instead of swallowing it', () => {
    open('Advanced');
    fireEvent.change(screen.getByLabelText('Schedule JSON'), { target: { value: '{ nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Not valid JSON/);
  });

  it('refuses scheduler-owned fields like status and runCount', () => {
    open('Advanced');
    const json = screen.getByLabelText('Schedule JSON') as HTMLTextAreaElement;
    expect(json.value).not.toContain('runCount');
    fireEvent.change(json, { target: { value: JSON.stringify({ status: 'completed', runCount: 0 }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));
    expect(screen.getByRole('alert').textContent).toMatch(/status, runCount cannot be edited/);
    expect(stored()).toMatchObject({ status: 'active', runCount: 4 });
  });

  it('applies a valid edit and confirms it', () => {
    open('Advanced');
    fireEvent.change(screen.getByLabelText('Schedule JSON'), {
      target: { value: JSON.stringify({ trigger: { type: 'interval', expression: '90 minutes' } }) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));
    expect(stored().trigger).toEqual({ type: 'interval', expression: '90 minutes' });
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });
});

describe('Summary', () => {
  it('shows the schedule in words with its next run, and where it runs', () => {
    useAssistantStore.setState({ orders: [order({ trigger: { type: 'cron', expression: '0 9 * * 1-5' } })] });
    open('Summary');
    expect(screen.getByText('Weekdays at 9:00 AM')).toBeTruthy();
    expect(screen.getByText(/^Next run: /)).toBeTruthy();
    expect(screen.getByText(/Runs in background/)).toBeTruthy();
  });
});

describe('Delete asks first', () => {
  it('does nothing when the confirmation is declined', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    open('Summary');
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(useAssistantStore.getState().orders).toHaveLength(1);
  });

  it('deletes when confirmed', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClose = vi.fn();
    render(<OrderEditor orderId="o1" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    expect(useAssistantStore.getState().orders).toHaveLength(0);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('TemplateDialog', () => {
  it('uses the shared picker, seeded with the template default, and saves the picked schedule', () => {
    useAssistantStore.setState({ orders: [] });
    const tpl = STANDING_ORDER_TEMPLATES.find((t) => t.id === 'morning-briefing')!;
    render(<TemplateDialog template={tpl} onClose={() => {}} />);
    expect((screen.getByLabelText('Repeat') as HTMLSelectElement).value).toBe('weekdays');
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '07:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(stored().trigger).toEqual({ type: 'cron', expression: '45 7 * * 1-5' });
    // The icon name is not rendered as text any more ("sun" used to show).
    expect(screen.queryByText('sun')).toBeNull();
  });

  it('every template builds a valid schedule by default', async () => {
    const { validateTrigger } = await import('@/lib/schedule/schedule');
    for (const tpl of STANDING_ORDER_TEMPLATES) {
      expect(validateTrigger(tpl.buildOrder().trigger), tpl.id).toBeNull();
    }
  });
});
