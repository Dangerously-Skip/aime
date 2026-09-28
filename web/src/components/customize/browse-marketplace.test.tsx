// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { BrowseMarketplace } from './browse-marketplace';

/**
 * A failed load says so and offers Retry.
 *
 * REGRESSION: `useMarketplace().error` was never read, so a failed load fell
 * through to "No plugins match your search." — shown to someone who had not
 * searched, with nothing to press. Only fetch is stubbed.
 */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();

const PLUGIN = { name: 'figma', description: 'Design files', source: './figma', category: 'design' };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BrowseMarketplace', () => {
  it('shows an error with Retry when the directory fails to load, and Retry reloads it', async () => {
    let marketplaceCalls = 0;
    fetchMock.mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/marketplace')) {
        marketplaceCalls += 1;
        return marketplaceCalls === 1
          ? json({ error: "Couldn't reach the plugin directory." }, 502)
          : json({ plugins: [PLUGIN], categories: ['design'] });
      }
      return json({ plugins: [] }); // /api/mcp/installed
    });

    render(<BrowseMarketplace />);

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load the Marketplace");
    expect(screen.queryByText('No plugins match your search.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('figma')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(marketplaceCalls).toBe(2);
  });

  it('capitalises every category chip the same way, and names the back button', async () => {
    fetchMock.mockImplementation(async (url: RequestInfo | URL) =>
      String(url).includes('/api/marketplace')
        ? json({
            plugins: [PLUGIN, { ...PLUGIN, name: 'zapier', category: 'automation' }, { ...PLUGIN, name: 'x', category: 'ai-ml' }],
          })
        : json({ plugins: [] }),
    );
    render(<BrowseMarketplace />);
    await screen.findByText('zapier');

    const chips = within(screen.getByRole('group', { name: 'Plugin categories' }))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(chips).toEqual(['All', 'Design', 'Automation', 'AI Ml']);
    expect(screen.getByRole('button', { name: 'Back to Customize' })).toBeTruthy();
  });

  it('shows a scroll affordance only when the chip row overflows', async () => {
    const widths = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    try {
      fetchMock.mockImplementation(async (url: RequestInfo | URL) =>
        String(url).includes('/api/marketplace') ? json({ plugins: [PLUGIN] }) : json({ plugins: [] }),
      );
      render(<BrowseMarketplace />);
      await screen.findByText('figma');

      expect(await screen.findByRole('button', { name: 'Scroll categories right' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Scroll categories left' })).toBeNull();

      widths.mockReturnValue(400);
      fireEvent.scroll(screen.getByRole('group', { name: 'Plugin categories' }));
      expect(screen.queryByRole('button', { name: 'Scroll categories right' })).toBeNull();
    } finally {
      widths.mockRestore();
      client.mockRestore();
    }
  });

  it('keeps "No plugins match your search." for a search that matches nothing', async () => {
    fetchMock.mockImplementation(async (url: RequestInfo | URL) =>
      String(url).includes('/api/marketplace')
        ? json({ plugins: [PLUGIN], categories: ['design'] })
        : json({ plugins: [] }),
    );
    render(<BrowseMarketplace />);
    await screen.findByText('figma');

    fireEvent.change(screen.getByPlaceholderText('Search plugins'), { target: { value: 'zzz' } });

    expect(screen.getByText('No plugins match your search.')).toBeTruthy();
  });
});
