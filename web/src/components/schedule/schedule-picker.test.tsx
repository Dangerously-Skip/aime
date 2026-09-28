// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SchedulePicker } from './schedule-picker';

afterEach(cleanup);

/** Monday 20 July 2026, 08:00 local. */
const NOW = new Date(2026, 6, 20, 8, 0).getTime();

describe('SchedulePicker', () => {
  it('opens a stored cron on its preset and says it in words, with the next run', () => {
    render(<SchedulePicker value={{ type: 'cron', expression: '0 9 * * 1-5' }} onChange={() => {}} now={NOW} />);
    expect((screen.getByLabelText('Repeat') as HTMLSelectElement).value).toBe('weekdays');
    expect(screen.getByTestId('schedule-preview').textContent).toBe('Weekdays at 9:00 AM · Next run: Today 9:00 AM');
  });

  it('builds a trigger from a preset', () => {
    const onChange = vi.fn();
    render(<SchedulePicker value={{ type: 'interval', expression: '30m' }} onChange={onChange} now={NOW} />);
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByLabelText('Day of the week'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '17:30' } });
    expect(onChange).toHaveBeenLastCalledWith({ trigger: { type: 'cron', expression: '30 17 * * 5' }, error: null });
    expect(screen.getByTestId('schedule-preview').textContent).toBe('Every Friday at 5:30 PM · Next run: Fri 24 Jul, 5:30 PM');
  });

  it('counts a new interval from now, as the ticker will', () => {
    render(<SchedulePicker value={{ type: 'interval', expression: '90 minutes' }} onChange={() => {}} now={NOW} />);
    expect(screen.getByTestId('schedule-preview').textContent).toBe('Every 90 minutes · Next run: Today 9:30 AM');
  });

  it('validates Custom with the real parser and reports why', () => {
    const onChange = vi.fn();
    render(<SchedulePicker value={{ type: 'cron', expression: '0 9 1 * *' }} onChange={onChange} now={NOW} />);
    expect((screen.getByLabelText('Repeat') as HTMLSelectElement).value).toBe('custom');
    fireEvent.change(screen.getByLabelText('Custom schedule'), { target: { value: '0 9 * * FUNDAY' } });
    expect(screen.getByRole('alert').textContent).toMatch(/not a valid day of week/);
    expect(onChange).toHaveBeenLastCalledWith({ trigger: null, error: expect.stringMatching(/day of week/) });

    // Names and 7 = Sunday are VALID now — they used to save and never match.
    fireEvent.change(screen.getByLabelText('Custom schedule'), { target: { value: '0 9 * * 7' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('schedule-preview').textContent).toMatch(/^Every Sunday at 9:00 AM · Next run: Sun 26 Jul/);
  });

  it('refuses an out-of-range count', () => {
    const onChange = vi.fn();
    render(<SchedulePicker value={{ type: 'interval', expression: '2h' }} onChange={onChange} now={NOW} />);
    fireEvent.change(screen.getByLabelText('Every how many hours'), { target: { value: '0' } });
    expect(screen.getByRole('alert').textContent).toMatch(/1 to 168/);
    expect(onChange).toHaveBeenLastCalledWith({ trigger: null, error: expect.any(String) });
  });
});
