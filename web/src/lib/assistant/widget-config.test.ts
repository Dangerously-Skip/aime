import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  cityFromTimeZone,
  defaultWeather,
  defaultClocks,
  defaultTickers,
  defaultWidgetPresetConfig,
  resolveWidgetPresetConfig,
} from './widget-config';

/**
 * THE QUICK-ADD WIDGETS WERE HARDCODED TO ONE PERSON'S LIFE.
 *
 * Sydney's latitude and longitude, `NHF (nib)` — the former employer this repo
 * was scrubbed of — and clocks for Sydney/SF/London/Singapore. The file said
 * "Sydney by default; could read from settings later."
 *
 * For anyone else every card was wrong on arrival, in an open-source product
 * where the Assistant surface is one of the first things you see. That is worse
 * than an empty state: it looks like the product is confidently reporting your
 * data, and it is reporting someone else's.
 */

describe('nothing personal survives in the defaults', () => {
  it('no former-employer ticker anywhere in the source', () => {
    /*
     * The scrub that removed nib-group and data-ai-squad missed this one,
     * because it is a DATA VALUE rather than a code reference or a comment —
     * `{ symbol: 'NHF.AX', label: 'NHF (nib)' }` matches no identifier pattern.
     */
    const dir = path.join(process.cwd(), 'src/lib/assistant');
    // Not the tests: this file names the symbol in order to forbid it.
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      // The test's own prose names it, so match the SYMBOL rather than the word.
      expect(src, `${file} still ships a personal holding`).not.toMatch(/NHF\.AX/);
    }
  });

  it('the default tickers are indices, not somebody holdings', () => {
    const labels = defaultTickers().map((t) => t.label);
    expect(labels).toContain('S&P 500');
    expect(labels.join(' ')).not.toMatch(/nib|NHF/i);
  });
});

describe('defaults follow the user, not the author', () => {
  it('weather is where the user is', () => {
    expect(defaultWeather('Europe/London')).toEqual({
      label: 'London', latitude: 51.51, longitude: -0.13,
    });
    expect(defaultWeather('America/New_York').label).toBe('New York');
  });

  it('an unknown zone gets a neutral location, not another continent', () => {
    // Honest beats confidently-wrong: Greenwich says "we do not know you".
    const w = defaultWeather('Antarctica/Troll');
    expect(w.latitude).toBeCloseTo(51.48, 1);
    expect(w.longitude).toBeCloseTo(0, 1);
  });

  it('the local clock comes first', () => {
    expect(defaultClocks('Europe/Berlin')[0]).toEqual({ label: 'Berlin', tz: 'Europe/Berlin' });
  });

  it('does not list the local zone twice', () => {
    // "London" appearing twice on a London machine reads as a bug, and makes a
    // default feel unconsidered.
    const zones = defaultClocks('Europe/London').map((c) => c.tz);
    expect(new Set(zones).size).toBe(zones.length);
  });

  it('turns a zone into a city a person would recognise', () => {
    expect(cityFromTimeZone('America/Los_Angeles')).toBe('Los Angeles');
    expect(cityFromTimeZone('UTC')).toBe('UTC');
  });
});

describe('stored config wins, field by field', () => {
  it('falls back entirely when nothing is stored', () => {
    expect(resolveWidgetPresetConfig(null, 'Europe/London')).toEqual(
      defaultWidgetPresetConfig('Europe/London'),
    );
  });

  it('keeps defaults for fields the user never touched', () => {
    /*
     * Someone who edited only their tickers still gets sensible clocks — and a
     * config written by an older build gains new fields rather than blanking
     * the card.
     */
    const resolved = resolveWidgetPresetConfig(
      { tickers: [{ symbol: 'AAPL', label: 'Apple' }] },
      'Europe/London',
    );
    expect(resolved.tickers).toEqual([{ symbol: 'AAPL', label: 'Apple' }]);
    expect(resolved.clocks[0].tz).toBe('Europe/London');
    expect(resolved.weather.label).toBe('London');
  });

  it('an EMPTY list is a choice and survives', () => {
    // "Show me no tickers" must not be overwritten by the defaults.
    expect(resolveWidgetPresetConfig({ tickers: [] }).tickers).toEqual([]);
  });
});
