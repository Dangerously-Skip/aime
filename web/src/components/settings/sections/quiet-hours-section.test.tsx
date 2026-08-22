// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QuietHoursSection } from './quiet-hours-section';
import { useSettingsStore } from '@/stores/settings-store';

/**
 * The control for a setting that already worked and nobody could reach.
 *
 * `quietHours` persisted and its logic was tested before anything rendered it,
 * which is this codebase's most repeated shape — a capability that is wired and
 * unreachable. These assert the panel actually drives the store.
 */

beforeEach(() => {
  useSettingsStore.setState({ quietHours: null } as never);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const quiet = () => useSettingsStore.getState().quietHours;

describe('turning it on', () => {
  it('starts off', () => {
    render(<QuietHoursSection />);
    // `role=switch`, not an <input>, so the ARIA state is the real one — and it
    // is what a screen reader reads.
    expect(screen.getByLabelText('Enable quiet hours').getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByLabelText('Quiet hours start')).toBeNull();
  });

  it('enabling writes a sensible overnight default', () => {
    // A default nobody has to think about: the case everyone configures.
    render(<QuietHoursSection />);
    fireEvent.click(screen.getByLabelText('Enable quiet hours'));
    expect(quiet()).toEqual({ fromHour: 22, toHour: 7 });
  });

  it('disabling clears it to null, not to a zero-width window', () => {
    /*
     * `{from: 0, to: 0}` means ALWAYS QUIET in the policy — the exact opposite
     * of off. Writing that on disable would silence every notification for ever
     * and look like the feature was broken.
     */
    useSettingsStore.setState({ quietHours: { fromHour: 22, toHour: 7 } } as never);
    render(<QuietHoursSection />);
    fireEvent.click(screen.getByLabelText('Enable quiet hours'));
    expect(quiet()).toBeNull();
  });
});

describe('choosing the window', () => {
  beforeEach(() => {
    useSettingsStore.setState({ quietHours: { fromHour: 22, toHour: 7 } } as never);
  });

  it('changing the start keeps the end', () => {
    render(<QuietHoursSection />);
    fireEvent.change(screen.getByLabelText('Quiet hours start'), { target: { value: '23' } });
    expect(quiet()).toEqual({ fromHour: 23, toHour: 7 });
  });

  it('changing the end keeps the start', () => {
    render(<QuietHoursSection />);
    fireEvent.change(screen.getByLabelText('Quiet hours end'), { target: { value: '8' } });
    expect(quiet()).toEqual({ fromHour: 22, toHour: 8 });
  });

  it('labels an overnight window, which otherwise reads as an error', () => {
    // "from 22:00 to 07:00" looks backwards until it is spelled out.
    render(<QuietHoursSection />);
    expect(screen.getByText('(overnight)')).toBeTruthy();
  });

  it('warns when the window is always-quiet', () => {
    useSettingsStore.setState({ quietHours: { fromHour: 9, toHour: 9 } } as never);
    render(<QuietHoursSection />);
    expect(screen.getByText(/always quiet/i)).toBeTruthy();
  });
});

describe('what it promises', () => {
  it('says briefings still RUN — the meaning users would otherwise assume', () => {
    /*
     * "Quiet hours" plausibly means either "do not notify" or "do not run", and
     * the one that would surprise someone is silently skipping the work. The
     * panel has to say which it is.
     */
    render(<QuietHoursSection />);
    expect(screen.getByText(/still run/i)).toBeTruthy();
    expect(screen.getByText(/still mark their tile as new/i)).toBeTruthy();
  });
});
