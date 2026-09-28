// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/schedule/orders')) return json({ orders: [] });
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

  it('"Schedule a morning briefing" opens the cron form, filled in', () => {
    render(<AutomationSection />);

    fireEvent.click(screen.getByRole('button', { name: /Schedule a morning briefing/ }));

    expect((screen.getByLabelText('Cron Expression') as HTMLInputElement).value).toBe(MORNING_BRIEFING_DRAFT.expression);
    expect((screen.getByLabelText('Prompt') as HTMLInputElement).value).toBe(MORNING_BRIEFING_DRAFT.prompt);
  });

  it('icon-only buttons are named', () => {
    render(<AutomationSection />);
    expect(screen.getByRole('button', { name: 'Back to Customize' })).toBeTruthy();
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
