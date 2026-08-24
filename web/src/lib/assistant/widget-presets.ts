import type { Widget } from '@/lib/widgets/widget';
import { resolveWidgetPresetConfig, type WidgetPresetConfig } from './widget-config';
import type { WidgetNode } from '@/lib/widgets/catalog';

/**
 * Widget preset = a self-contained dashboard tile. Instead of round-tripping
 * to the LLM, each preset's `fetchAndRender()` produces an A2UIDocument
 * directly — public APIs, pure computation, etc. Refreshes happen on the
 * heartbeat without touching the agent.
 */
export interface WidgetPreset {
  id: string;
  /** Unique kind so the heartbeat hook knows how to refresh this card. */
  kind: 'world_clock' | 'weather' | 'stock_ticker';
  label: string;
  icon: string;
  description: string;
  refreshIntervalMs: number;
  fetchAndRender(config?: WidgetPresetConfig): Promise<WidgetNode>;
}

const FIFTEEN_MIN = 15 * 60_000;
const ONE_HOUR = 60 * 60_000;

// ── World clock — pure computation ─────────────────────────────────────────────

/*
 * FROM CONFIG, not from here.
 *
 * These lists were one person's: Sydney/SF/London/Singapore, Sydney's latitude
 * and longitude, and a single mid-cap holding of the author's former employer.
 * In an open-source product where the Assistant surface is among the first
 * things a new user sees, every card was confidently wrong about their life.
 *
 * `widget-config.ts` derives defaults from the user's own time zone and lets
 * them be edited. Kept here only as the shape a caller passes in.
 */

function formatInZone(tz: string): string {
  // Intl handles DST automatically.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

async function renderWorldClock(config?: WidgetPresetConfig): Promise<WidgetNode> {
  const zones = (config ?? resolveWidgetPresetConfig(null)).clocks;
  return {
    type: 'statGrid',
    items: zones.map((z) => ({ label: z.label, value: formatInZone(z.tz) })),
  };
}

// ── Weather — Open-Meteo (no auth) ─────────────────────────────────────────────

const WEATHER_CODES: Record<number, string> = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '🌨', 75: '❄️',
  80: '🌦', 81: '🌧', 82: '⛈',
  95: '⛈', 96: '⛈', 99: '⛈',
};

async function renderWeather(config?: WidgetPresetConfig): Promise<WidgetNode> {
  // Where the USER is — see widget-config. This read Sydney's coordinates, with
  // a comment saying it "could read from settings later".
  const where = (config ?? resolveWidgetPresetConfig(null)).weather;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${where.latitude}&longitude=${where.longitude}&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&timezone=auto&forecast_days=1`;
  const fallback: WidgetNode = {
    type: 'statGrid',
    items: [{ label: 'Status', value: 'Unavailable' }],
  };
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    const data = await res.json();
    const current = data.current ?? {};
    const code = current.weather_code as number | undefined;
    const emoji = (code !== undefined && WEATHER_CODES[code]) || '🌡';
    return {
      type: 'statGrid',
      items: [
        { label: 'Now', value: `${Math.round(current.temperature_2m ?? 0)}°C` },
        { label: 'Wind', value: `${Math.round(current.wind_speed_10m ?? 0)} km/h` },
        { label: 'Sky', value: emoji },
      ],
    };
  } catch {
    return fallback;
  }
}

// ── Stock ticker — Yahoo Finance public chart API ─────────────────────────────


async function fetchQuote(symbol: string): Promise<{ value: string; trend: 'up' | 'down' | 'neutral'; trendValue: string } | null> {
  try {
    // Proxy through our local API — Yahoo blocks browser CORS.
    const res = await fetch(`/api/widget/stock?symbol=${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const closes: number[] | undefined = result?.indicators?.quote?.[0]?.close?.filter((x: number | null) => x !== null);
    if (!closes || closes.length < 2) return null;
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const pct = ((last - prev) / prev) * 100;
    return {
      value: last.toFixed(symbol.includes('=X') ? 4 : 2),
      trend: pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'neutral',
      trendValue: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
    };
  } catch {
    return null;
  }
}

async function renderStockTicker(config?: WidgetPresetConfig): Promise<WidgetNode> {
  const tickers = (config ?? resolveWidgetPresetConfig(null)).tickers;
  const quotes = await Promise.all(tickers.map((t) => fetchQuote(t.symbol)));
  return {
    type: 'statGrid',
    items: tickers.map((t, i) => {
      const q = quotes[i];
      if (!q) return { label: t.label, value: '—' };
      // `state`/`delta` is the widget catalog's spelling of trend.
      return { label: t.label, value: q.value, state: q.trend, delta: q.trendValue };
    }),
  };
}

// ── Registry ───────────────────────────────────────────────────────────────────

export const WIDGET_PRESETS: WidgetPreset[] = [
  {
    id: 'weather',
    kind: 'weather',
    label: 'Weather',
    icon: 'cloud-sun',
    description: 'Current conditions where you are, refreshed every 15 min',
    refreshIntervalMs: FIFTEEN_MIN,
    fetchAndRender: renderWeather,
  },
  {
    id: 'stock_ticker',
    kind: 'stock_ticker',
    label: 'Stock ticker',
    icon: 'trending-up',
    description: 'Markets you follow, refreshed every 15 min',
    refreshIntervalMs: FIFTEEN_MIN,
    fetchAndRender: renderStockTicker,
  },
  {
    id: 'world_clock',
    kind: 'world_clock',
    label: 'World clock',
    icon: 'globe-2',
    description: 'Your zone and three others, refreshed hourly',
    refreshIntervalMs: ONE_HOUR,
    fetchAndRender: renderWorldClock,
  },
];

/**
 * Run a widget's built-in fetcher.
 *
 * Returns null for a widget with no `refreshKind` — that one goes down the agent
 * path, and this must not guess on its behalf.
 */
export async function refreshByKind(
  refreshKind: string | undefined,
  config?: WidgetPresetConfig,
): Promise<WidgetNode | null> {
  const preset = WIDGET_PRESETS.find(
    (p) =>
      (refreshKind === 'tickers' && p.kind === 'stock_ticker') ||
      (refreshKind === 'clocks' && p.kind === 'world_clock') ||
      (refreshKind === 'weather' && p.kind === 'weather'),
  );
  if (!preset) return null;
  return preset.fetchAndRender(config);
}

export function getWidgetPreset(kind: string): WidgetPreset | undefined {
  return WIDGET_PRESETS.find((p) => p.kind === kind);
}

/** Build an AssistantCard payload for a preset. */
/**
 * A preset, as a WIDGET.
 *
 * Presets used to build an `AssistantCard` with a `widget:` block bolted on, so
 * a stock ticker — which is STATE, one current value replaced on refresh — lived
 * in the event feed alongside things that happened. It could not be edited,
 * rescheduled, or asked about, and none of the unread/digest/quiet-hours work
 * applied to it, because all of that was built for the other widget system.
 *
 * Now it is the same object as any widget you create, differing only in HOW it
 * refreshes: a built-in fetcher instead of an agent run. Free, instant, and
 * editable like everything else.
 */
export function buildPresetWidget(preset: WidgetPreset): Omit<Widget, 'id' | 'createdAt'> {
  return {
    title: preset.label,
    // A recipe for the agent path to fall back on, and the honest description of
    // what the tile is for if a user later switches it to agent refresh.
    recipe: preset.description,
    refreshKind: preset.kind === 'stock_ticker' ? 'tickers'
      : preset.kind === 'world_clock' ? 'clocks'
      : 'weather',
    refreshEverySeconds: Math.round(preset.refreshIntervalMs / 1000),
    render: null,
    enabled: true,
  };
}

