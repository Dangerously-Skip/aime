import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A DETERMINISTIC WIDGET NEVER REACHES A MODEL — INCLUDING ON ITS SCHEDULE.
 *
 * `Widget.refreshKind`'s own documentation says "a stock price should never cost
 * a model call". The TILE honoured that; the SERVER did not. So the manual
 * button ran the built-in fetcher for free, and the scheduled path — the one
 * that runs unattended every 15 minutes for every weather and ticker tile — sent
 * the recipe to an agent instead.
 *
 * Three live consequences, and the cost one is the least of them: without web
 * access, "Current conditions where you are" can only be answered from model
 * weights, so the tile reported INVENTED weather in the same typeface as the
 * real fetcher's. And a user who set their location to Lisbon would have it
 * honoured by the button and ignored by the schedule.
 *
 * These drive the real `refreshWidget`, with the provider mocked so that ANY
 * model call is an observable failure rather than a slow test.
 */

let dir = '';
const provider = { query: vi.fn() };

vi.mock('@/lib/app-paths', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getDataDir: () => dir,
}));
vi.mock('@/lib/providers', () => ({ getProvider: () => provider }));

const fetchMock = vi.fn();

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aime-det-'));
  provider.query.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(dir, { recursive: true, force: true });
});

const weatherWidget = (config?: unknown) =>
  ({
    id: 'w-weather',
    title: 'Weather',
    recipe: 'Current conditions where you are',
    refreshKind: 'weather',
    render: null,
    enabled: true,
    createdAt: 0,
    config,
  }) as never;

/** Open-Meteo's shape, narrowed to what the fetcher reads. */
const openMeteoOk = {
  ok: true,
  json: async () => ({ current: { temperature_2m: 21.4, weather_code: 0, wind_speed_10m: 9 } }),
};

describe('a scheduled refresh of a deterministic widget', () => {
  it('renders WITHOUT asking a model — no manifest, no key, no cost', async () => {
    fetchMock.mockResolvedValue(openMeteoOk);
    const { refreshWidget } = await import('./refresh-service');

    const result = await refreshWidget(weatherWidget(), 'cron');

    /*
     * The whole point. Note there is no execution manifest in `dir` at all —
     * previously that alone produced "No model is configured for this
     * capability", so a weather tile failed every tick on a BYOK-only account
     * for wanting a model it never needed.
     */
    expect(provider.query).not.toHaveBeenCalled();
    expect(result.node).toBeTruthy();
    expect(result.status).toBe(200);
    expect(result.run?.status).toBe('succeeded');
  });

  it('records the run as deterministic, at zero cost', async () => {
    fetchMock.mockResolvedValue(openMeteoOk);
    const { refreshWidget } = await import('./refresh-service');

    const { run } = await refreshWidget(weatherWidget(), 'cron');

    // Named rather than blank: a blank model reads as missing data, and this is
    // a fact about how the tile works. The Cockpit's "spent" total depends on it.
    expect(run?.model).toBe('deterministic');
    expect(run?.cost?.totalUsd ?? 0).toBe(0);
  });

  it("HONOURS THE WIDGET'S OWN CONFIG — the tailored location reaches the schedule", async () => {
    fetchMock.mockResolvedValue(openMeteoOk);
    const { refreshWidget } = await import('./refresh-service');

    await refreshWidget(
      weatherWidget({ weather: { label: 'Lisbon', latitude: 38.72, longitude: -9.14 } }),
      'cron',
    );

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('latitude=38.72');
    expect(url).toContain('longitude=-9.14');
  });

  it('says WHERE it is — an unlabelled temperature is unreadable', async () => {
    /*
     * Four weather tiles rendered three identical numbers and no location, so
     * none of them said what they were of. Reported as "weather seems to just
     * be showing weather for wherever it decides to show weather".
     */
    fetchMock.mockResolvedValue(openMeteoOk);
    const { refreshWidget } = await import('./refresh-service');

    const { node } = await refreshWidget(
      weatherWidget({ weather: { label: 'Lisbon', latitude: 38.72, longitude: -9.14 } }),
      'cron',
    );

    const items = (node as { items?: Array<{ label: string; value: string }> })?.items ?? [];
    expect(items.find((i) => i.label === 'Where')?.value).toBe('Lisbon');
  });

  it('still names the place when the forecast is unavailable', async () => {
    // The failure case is where you most need to know which city failed.
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const { refreshWidget } = await import('./refresh-service');

    const { node } = await refreshWidget(
      weatherWidget({ weather: { label: 'Lisbon', latitude: 38.72, longitude: -9.14 } }),
      'cron',
    );

    const items = (node as { items?: Array<{ label: string; value: string }> })?.items ?? [];
    expect(items.find((i) => i.label === 'Where')?.value).toBe('Lisbon');
    expect(items.find((i) => i.label === 'Status')?.value).toBe('Unavailable');
  });

  it('an AGENT widget still goes to the model — the branch is narrow', async () => {
    /*
     * The guard against fixing this by routing everything to a fetcher. A widget
     * with no `refreshKind` has only its recipe, and that needs a model.
     */
    const { refreshWidget } = await import('./refresh-service');
    const agentWidget = { ...(weatherWidget() as object), refreshKind: undefined } as never;

    const result = await refreshWidget(agentWidget, 'cron');

    // No manifest in `dir`, so it stops at model resolution — which is itself
    // proof it took the model path rather than the fetcher one.
    expect(result.node).toBeNull();
    expect(String(result.error)).toMatch(/model is configured/i);
  });
});

describe('the ticker fetch server-side', () => {
  it('calls Yahoo directly rather than a relative proxy URL', async () => {
    /*
     * `/api/widget/stock` does not resolve in the scheduler process — it has no
     * origin. A ticker refreshed on its schedule therefore came back empty while
     * the same tile refreshed by hand worked, which is invisible: the tile just
     * showed em-dashes.
     */
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ chart: { result: [{ indicators: { quote: [{ close: [100, 101] }] } }] } }),
    });
    const { refreshWidget } = await import('./refresh-service');

    await refreshWidget(
      {
        id: 'w-t',
        title: 'Ticker',
        recipe: 'markets',
        refreshKind: 'tickers',
        render: null,
        enabled: true,
        createdAt: 0,
        config: { tickers: [{ symbol: 'AAPL', label: 'Apple' }] },
      } as never,
      'cron',
    );

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.startsWith('https://query1.finance.yahoo.com/'))).toBe(true);
    expect(urls.some((u) => u.startsWith('/api/'))).toBe(false);
  });
});
