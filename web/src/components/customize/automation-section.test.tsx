// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { APP_NAME } from '@/config/branding';
import { AutomationSection, MORNING_BRIEFING_DRAFT } from './automation-section';
import { CustomizeView } from './customize-view';
import { useAppStore } from '@/stores/app-store';

/**
 * Automation claims only what it does.
 *
 * - Webhooks are being removed server-side; the "Coming soon" block and the
 *   landing card's "configure webhooks" promised a feature that is going away.
 * - The heartbeat switches saved a setting nothing read. They are now disabled
 *   WITH the reason beside them, and point at the thing that does run.
 * - Health-check fixes were browser-blue with absolute home paths.
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();
/** The orders the manifest holds — PUTs replace it, so the list reflects saves. */
let orders: Array<Record<string, unknown>> = [];

beforeEach(() => {
  orders = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/schedule/orders')) {
      if (init?.method === 'PUT') {
        orders = (JSON.parse(String(init.body)) as { orders: typeof orders }).orders;
        return json({ ok: true });
      }
      return json({ orders });
    }
    if (u.includes('/api/doctor')) {
      return json({
        ok: false,
        summary: 'warn',
        checks: [
          {
            id: 'soul',
            label: 'SOUL.md',
            status: 'warn',
            message: 'Missing /Users/alex/.claude/SOUL.md',
            fix: "Create /Users/alex/.claude/SOUL.md to configure the assistant's identity",
          },
        ],
      });
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AutomationSection', () => {
  it('makes no webhook claims, here or on the landing card', () => {
    render(<AutomationSection />);
    expect(screen.queryByText(/webhook/i)).toBeNull();
    cleanup();

    useAppStore.setState({ customizeSection: 'landing' });
    render(<CustomizeView />);
    expect(screen.queryByText(/webhook/i)).toBeNull();
  });

  it('heartbeat switches are disabled and say why', () => {
    render(<AutomationSection />);

    for (const label of ['Morning Briefing', 'Evening Wrap-up', 'Idle Nudge']) {
      const sw = screen.getByRole('switch', { name: `${label} — not available yet` });
      expect(sw.getAttribute('aria-checked')).toBe('false');
      expect(sw.hasAttribute('disabled') || sw.getAttribute('aria-disabled') === 'true').toBe(true);
    }
    expect(screen.getByText('Not available yet')).toBeTruthy();
    expect(screen.getByText(/aren't scheduled by this version/)).toBeTruthy();
  });

  it('"Schedule a morning briefing" opens the schedule form, filled in', () => {
    render(<AutomationSection />);

    fireEvent.click(screen.getByRole('button', { name: /Schedule a morning briefing/ }));

    // The shared SchedulePicker reads the draft's trigger as "Weekdays at 09:00".
    expect((screen.getByLabelText('Repeat') as HTMLSelectElement).value).toBe('weekdays');
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('09:00');
    expect(screen.getByTestId('schedule-preview').textContent).toMatch(/Next run/);
    expect((screen.getByLabelText('Prompt') as HTMLInputElement).value).toBe(MORNING_BRIEFING_DRAFT.prompt);
  });

  it('icon-only buttons are named', () => {
    render(<AutomationSection />);
    expect(screen.getByRole('button', { name: 'Back to Customize' })).toBeTruthy();
  });
});

describe('scheduled jobs use the shared SchedulePicker', () => {
  const lastPut = () =>
    fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PUT').at(-1);

  it('saves the trigger the picker built — an interval here, which a cron box could not express', async () => {
    render(<AutomationSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'every-hours' } });
    fireEvent.change(screen.getByLabelText('Every how many hours'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Check the build' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(lastPut()).toBeDefined());
    const saved = orders.at(-1)!;
    expect(saved).toMatchObject({
      instruction: 'Check the build',
      attended: true,
      surfaceId: 'cowork',
      trigger: { type: 'interval', expression: '2h' },
    });
  });

  it('refuses an invalid schedule with the picker’s reason, and saves nothing', async () => {
    render(<AutomationSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('Custom schedule'), { target: { value: '0 9 * * MON-FRI-X' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(lastPut()).toBeUndefined();
  });

  it('lists a job in words and says it needs the app open', async () => {
    orders = [
      {
        id: 'j1', instruction: 'Weekly summary', attended: true, surfaceId: 'chat',
        trigger: { type: 'cron', expression: '0 9 * * 1' }, status: 'active', createdAt: 0, updatedAt: 0,
      },
    ];
    render(<AutomationSection />);
    expect(await screen.findByText('Weekly summary')).toBeTruthy();
    expect(screen.getByText(`Needs ${APP_NAME} open`)).toBeTruthy();
    expect(screen.getByTitle('0 9 * * 1').textContent).not.toBe('0 9 * * 1');
  });
});

describe('DoctorPanel inside Automation', () => {
  it('shortens home paths and does not style the fix as a link', async () => {
    render(<AutomationSection />);
    fireEvent.click(screen.getByRole('button', { name: /Run checks/ }));

    const fix = await screen.findByText(/to configure the assistant's identity/);
    expect(fix.textContent).toContain('~/.claude/SOUL.md');
    expect(fix.textContent).not.toContain('/Users/alex');
    expect(fix.className).not.toMatch(/text-blue/);
    expect(screen.getByText('Missing ~/.claude/SOUL.md')).toBeTruthy();
  });
});
