/**
 * What the quick-add widgets actually show, as configuration rather than code.
 *
 * WHAT THIS REPLACES. The presets were hardcoded to one person's life: Sydney's
 * latitude and longitude, `NHF (nib)` — the former employer this repo was
 * scrubbed of — and clocks for Sydney/SF/London/Singapore. The file even said
 * "Sydney by default; could read from settings later."
 *
 * For anybody else, every card was wrong on arrival, in an open-source product
 * where the first thing a new user sees is the Assistant surface. That is worse
 * than an empty state: it looks like the product is confidently reporting your
 * data, and it is reporting someone else's.
 *
 * WHY DEFAULTS ARE DERIVED, NOT PICKED. The browser already knows the user's
 * time zone, so the local clock and a sensible weather location follow from
 * `Intl` rather than from a guess. A default that is right for the person in
 * front of you needs no editing, and the edit UI exists for when it is wrong —
 * not as the only way to make the feature usable.
 */

export interface ClockConfig {
  label: string;
  /** IANA zone, e.g. `Europe/London`. */
  tz: string;
}

export interface TickerConfig {
  /** As the quote API expects it, e.g. `^GSPC`, `AAPL`, `AUDUSD=X`. */
  symbol: string;
  label: string;
}

export interface WeatherConfig {
  label: string;
  latitude: number;
  longitude: number;
}

export interface WidgetPresetConfig {
  weather: WeatherConfig;
  tickers: TickerConfig[];
  clocks: ClockConfig[];
}

/** The user's IANA zone, or UTC when the runtime will not say. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** `Australia/Sydney` → `Sydney`. The city is the useful half of a zone name. */
export function cityFromTimeZone(tz: string): string {
  const last = tz.split('/').pop() ?? tz;
  return last.replace(/_/g, ' ');
}

/**
 * Rough coordinates for common zones, so a first-run weather card is about
 * WHERE THE USER IS.
 *
 * Deliberately small and deliberately approximate: this is a weather tile, not
 * navigation, and a city-centre coordinate is well inside the resolution of a
 * forecast. Anything not listed falls back to the zone's own offset, which is
 * still better than another continent.
 */
const ZONE_COORDS: Record<string, { latitude: number; longitude: number }> = {
  'Australia/Sydney': { latitude: -33.87, longitude: 151.21 },
  'Australia/Melbourne': { latitude: -37.81, longitude: 144.96 },
  'Australia/Brisbane': { latitude: -27.47, longitude: 153.03 },
  'Australia/Perth': { latitude: -31.95, longitude: 115.86 },
  'Europe/London': { latitude: 51.51, longitude: -0.13 },
  'Europe/Paris': { latitude: 48.86, longitude: 2.35 },
  'Europe/Berlin': { latitude: 52.52, longitude: 13.4 },
  'Europe/Dublin': { latitude: 53.35, longitude: -6.26 },
  'America/New_York': { latitude: 40.71, longitude: -74.01 },
  'America/Los_Angeles': { latitude: 34.05, longitude: -118.24 },
  'America/Chicago': { latitude: 41.88, longitude: -87.63 },
  'America/Toronto': { latitude: 43.65, longitude: -79.38 },
  'Asia/Singapore': { latitude: 1.35, longitude: 103.82 },
  'Asia/Tokyo': { latitude: 35.68, longitude: 139.69 },
  'Asia/Kolkata': { latitude: 19.08, longitude: 72.88 },
  'Pacific/Auckland': { latitude: -36.85, longitude: 174.76 },
};

/** Greenwich, when we know nothing — honest rather than someone else's city. */
const UNKNOWN_LOCATION = { latitude: 51.48, longitude: 0 };

export function defaultWeather(tz = localTimeZone()): WeatherConfig {
  const coords = ZONE_COORDS[tz];
  return coords
    ? { label: cityFromTimeZone(tz), ...coords }
    : { label: cityFromTimeZone(tz), ...UNKNOWN_LOCATION };
}

/**
 * The user's own zone first, then a spread of major markets.
 *
 * The local one is not duplicated: a list showing "Sydney" twice on a Sydney
 * machine reads as a bug, and it is the kind of thing that makes a default feel
 * unconsidered.
 */
export function defaultClocks(tz = localTimeZone()): ClockConfig[] {
  const others = ['America/New_York', 'Europe/London', 'Asia/Singapore'];
  return [
    { label: cityFromTimeZone(tz), tz },
    ...others.filter((z) => z !== tz).map((z) => ({ label: cityFromTimeZone(z), tz: z })),
  ].slice(0, 4);
}

/**
 * Broad market indices, and NOTHING personal.
 *
 * The previous list led with `NHF (nib)` — a single mid-cap holding of the
 * person who wrote it. An index is the one thing that is defensibly interesting
 * to a stranger, and everything beyond that is for the user to add.
 */
export function defaultTickers(): TickerConfig[] {
  return [
    { symbol: '%5EGSPC', label: 'S&P 500' },
    { symbol: '%5EIXIC', label: 'Nasdaq' },
    { symbol: 'BTC-USD', label: 'Bitcoin' },
  ];
}

export function defaultWidgetPresetConfig(tz = localTimeZone()): WidgetPresetConfig {
  return { weather: defaultWeather(tz), tickers: defaultTickers(), clocks: defaultClocks(tz) };
}

/**
 * Merge stored config over the defaults.
 *
 * Field by field, so a user who has only ever edited their tickers still gets
 * sensible clocks — and so a config saved by an older build gains new fields
 * instead of blanking the card.
 */
export function resolveWidgetPresetConfig(
  stored: Partial<WidgetPresetConfig> | null | undefined,
  tz = localTimeZone(),
): WidgetPresetConfig {
  const base = defaultWidgetPresetConfig(tz);
  if (!stored) return base;
  return {
    weather: stored.weather ?? base.weather,
    // An EMPTY array is a deliberate choice ("show me no tickers") and must
    // survive; only an absent one falls back.
    tickers: Array.isArray(stored.tickers) ? stored.tickers : base.tickers,
    clocks: Array.isArray(stored.clocks) ? stored.clocks : base.clocks,
  };
}
