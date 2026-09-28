// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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
