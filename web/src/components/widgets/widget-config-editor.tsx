"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Widget } from "@/lib/widgets/widget";
import {
  resolveWidgetPresetConfig,
  type ClockConfig,
  type TickerConfig,
  type WeatherConfig,
  type WidgetPresetConfig,
} from "@/lib/assistant/widget-config";

/**
 * Editing what a deterministic widget SHOWS.
 *
 * `widget-config.ts` has said since it was written that "the edit UI exists for
 * when [the default] is wrong — not as the only way to make the feature usable".
 * There was no edit UI. The tile called `resolveWidgetPresetConfig(null)` with a
 * hardcoded null, so stored config could never be read and nothing could write
 * it: the defaults were not defaults, they were the only possible values.
 *
 * That is the shape this codebase keeps paying for — a claim in a comment with
 * nothing behind it — and prose cannot fail a build, so `preset-config.test.ts`
 * asserts the tile passes `widget.config` through rather than a literal.
 *
 * WHY A CITY SEARCH AND NOT TWO NUMBER FIELDS. The stored form is a latitude and
 * a longitude, which nobody knows for their own city. Open-Meteo's geocoding is
 * the same unauthenticated service the forecast comes from, so asking it costs
 * nothing and no key.
 */

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

/** `Sydney, New South Wales, Australia` — enough to tell two Sydneys apart. */
function describePlace(r: GeoResult): string {
  return [r.name, r.admin1, r.country].filter(Boolean).join(", ");
}

function WeatherEditor({
  value,
  onChange,
}: {
  value: WeatherConfig;
  onChange: (w: WeatherConfig) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=5`,
      );
      if (!res.ok) throw new Error(`search failed (${res.status})`);
      const data = (await res.json()) as { results?: GeoResult[] };
      // An empty `results` key is how this API says "no match" — distinct from
      // a failure, and it must not read as one.
      setResults(data.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Location</p>
      <p className="text-xs">
        Currently <span className="font-medium">{value.label}</span>{" "}
        <span className="text-muted-foreground tabular-nums">
          ({value.latitude.toFixed(2)}, {value.longitude.toFixed(2)})
        </span>
      </p>
      <div className="flex gap-1.5">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void search()}
          placeholder="Search a city…"
          className="h-7 text-xs"
          aria-label="Search a city"
        />
        <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => void search()} disabled={searching}>
          {searching ? "…" : "Search"}
        </Button>
      </div>
      {error && <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p>}
      {results?.length === 0 && !error && (
        <p className="text-[10px] text-muted-foreground">No places matched that.</p>
      )}
      {results && results.length > 0 && (
        <ul className="space-y-0.5">
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button
                className="w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
                onClick={() => {
                  onChange({ label: r.name, latitude: r.latitude, longitude: r.longitude });
                  setResults(null);
                  setQuery("");
                }}
              >
                {describePlace(r)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Symbols as free text, `SYMBOL` or `SYMBOL=Label`.
 *
 * A picker would need a symbol directory this app does not have, and the quote
 * endpoint accepts whatever Yahoo does — indices, equities, FX pairs, crypto.
 * Free text is the honest interface to that: anything it takes, you can type.
 */
function parseTickers(text: string): TickerConfig[] {
  return text
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const eq = chunk.indexOf("=");
      // `AUDUSD=X` is itself a symbol containing `=`, so only a `=` followed by
      // something that is not a bare Yahoo suffix is treated as a label.
      if (eq > 0 && chunk.slice(eq + 1).length > 1) {
        return { symbol: chunk.slice(0, eq).trim(), label: chunk.slice(eq + 1).trim() };
      }
      return { symbol: chunk, label: chunk };
    });
}

function formatTickers(tickers: TickerConfig[]): string {
  return tickers.map((t) => (t.label === t.symbol ? t.symbol : `${t.symbol}=${t.label}`)).join(", ");
}

function parseClocks(text: string): ClockConfig[] {
  return text
    .split(",")
    .map((z) => z.trim())
    .filter(Boolean)
    .map((tz) => ({ tz, label: (tz.split("/").pop() ?? tz).replace(/_/g, " ") }));
}

/**
 * The editor for one widget's configuration.
 *
 * `onSave` receives a PARTIAL: only the section this widget's kind owns. Writing
 * the whole resolved object would freeze the other two sections at today's
 * defaults, so a later improvement to them would never reach this widget.
 */
export function WidgetConfigEditor({
  widget,
  onSave,
  onCancel,
}: {
  widget: Widget;
  onSave: (config: Partial<WidgetPresetConfig>) => void;
  onCancel: () => void;
}) {
  const resolved = resolveWidgetPresetConfig(widget.config);
  const [weather, setWeather] = useState<WeatherConfig>(resolved.weather);
  const [tickerText, setTickerText] = useState(formatTickers(resolved.tickers));
  const [clockText, setClockText] = useState(resolved.clocks.map((c) => c.tz).join(", "));

  const save = () => {
    if (widget.refreshKind === "weather") onSave({ weather });
    else if (widget.refreshKind === "tickers") onSave({ tickers: parseTickers(tickerText) });
    else if (widget.refreshKind === "clocks") onSave({ clocks: parseClocks(clockText) });
    else onCancel();
  };

  return (
    <div className="space-y-2 border-t border-border/40 px-3 py-2">
      {widget.refreshKind === "weather" && <WeatherEditor value={weather} onChange={setWeather} />}

      {widget.refreshKind === "tickers" && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbols</p>
          <Input
            value={tickerText}
            onChange={(e) => setTickerText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="AAPL, %5EGSPC=S&P 500, BTC-USD=Bitcoin"
            className="h-7 text-xs"
            aria-label="Symbols"
          />
          <p className="text-[10px] text-muted-foreground">
            Comma separated. <code>SYMBOL</code> or <code>SYMBOL=Label</code>.
          </p>
        </div>
      )}

      {widget.refreshKind === "clocks" && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Time zones</p>
          <Input
            value={clockText}
            onChange={(e) => setClockText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="Australia/Sydney, Europe/London"
            className="h-7 text-xs"
            aria-label="Time zones"
          />
          <p className="text-[10px] text-muted-foreground">
            Comma separated IANA zones. The label is the city part.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <Button size="sm" className="h-6 text-xs" onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
