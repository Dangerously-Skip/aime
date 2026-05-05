import type { AssistantCard } from '@/stores/assistant-store';

/**
 * Widget preset = a `addCard()` payload that turns a card into an
 * auto-refreshing dashboard tile. The `widget.regeneratePrompt` is sent
 * to /api/chat/<surface> on each `widget.refreshIntervalMs` interval.
 */
export interface WidgetPreset {
  id: string;
  /** Short label shown on the install button. */
  label: string;
  /** Lucide icon name. */
  icon: string;
  /** One-line description shown beneath the label. */
  description: string;
  /** Card payload passed to addCard(). */
  build: () => Omit<AssistantCard, 'id' | 'timestamp' | 'unread' | 'pinned'>;
}

const FIFTEEN_MIN = 15 * 60_000;
const ONE_HOUR = 60 * 60_000;

export const WIDGET_PRESETS: WidgetPreset[] = [
  {
    id: 'weather',
    label: 'Weather',
    icon: 'cloud-sun',
    description: 'Local forecast for the day, refreshed every 15 minutes',
    build: () => ({
      title: 'Weather',
      summary: 'Loading…',
      widget: {
        refreshIntervalMs: FIFTEEN_MIN,
        surface: 'assistant',
        regeneratePrompt:
          'Use WebFetch to get the current weather and a 6-hour forecast for the user\'s location (or Sydney, Australia if location is unknown). ' +
          'Use https://api.open-meteo.com/v1/forecast?latitude=-33.87&longitude=151.21&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,weather_code&timezone=auto&forecast_days=1 ' +
          '— this endpoint requires no API key. ' +
          'Then call the canvas tool with templateId "architecture" disabled — instead emit a raw A2UI doc using "stat" + "list" components: ' +
          'one stat block showing current temperature + condition + wind, and one list of the next 6 hourly entries with temperature and a weather emoji. Title: "Weather".',
      },
    }),
  },
  {
    id: 'stock_ticker',
    label: 'Stock ticker',
    icon: 'trending-up',
    description: 'Watch tickers refreshed every 15 minutes',
    build: () => ({
      title: 'Stock ticker',
      summary: 'Loading…',
      widget: {
        refreshIntervalMs: FIFTEEN_MIN,
        surface: 'assistant',
        regeneratePrompt:
          'Fetch current quotes for ASX:NHF (nib Holdings), ^AXJO (S&P/ASX 200), and AUD/USD via WebFetch using ' +
          'https://query1.finance.yahoo.com/v8/finance/chart/<symbol>?interval=1d&range=2d ' +
          '(URL-encode ^AXJO as %5EAXJO, AUDUSD=X for currency). ' +
          'Compute today\'s change vs previous close. ' +
          'Emit a raw A2UI canvas doc with title "Markets" and one "stat" component listing each symbol with its value, trend (up/down/neutral), and trendValue showing the percent change.',
      },
    }),
  },
  {
    id: 'world_clock',
    label: 'World clock',
    icon: 'globe-2',
    description: 'Sydney, San Francisco, London, Singapore — refreshed hourly',
    build: () => ({
      title: 'World clock',
      summary: 'Loading…',
      widget: {
        refreshIntervalMs: ONE_HOUR,
        surface: 'assistant',
        regeneratePrompt:
          'Compute the current local time in Sydney, San Francisco, London, and Singapore. ' +
          'Use Bash with `TZ=<zone> date "+%Y-%m-%d %H:%M %Z"` for each: ' +
          'Australia/Sydney, America/Los_Angeles, Europe/London, Asia/Singapore. ' +
          'Emit a raw A2UI canvas doc with title "World clock" and one "stat" component listing each city as label and the time as value. ' +
          'No trend data needed.',
      },
    }),
  },
];
