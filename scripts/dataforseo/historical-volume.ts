#!/usr/bin/env npx tsx
/**
 * Historical Search Volume — absolute monthly volume + seasonality math.
 *
 * Usage:
 *   npx tsx scripts/historical-volume.ts "daily horoscope" "mercury retrograde"
 *   npx tsx scripts/historical-volume.ts "leo season" --location 2840 --lang en
 *
 * Unlike trends.ts (Google Trends *relative* 0-100 interest), this returns the
 * real monthly search-volume series from DataForSEO Labs and derives:
 *   - peak / trough volume + the month each falls in
 *   - amplitude_ratio (peak/trough) and is_evergreen (low amplitude)
 *   - weeks_to_peak: how long until the next seasonal peak from today
 *
 * For astrology this is the timing engine — zodiac seasons, retrogrades and
 * eclipses spike predictably, and weeks_to_peak tells you what to publish now.
 * `fetchSeasonality()` is exported for the scorer.
 */

import { dataforseoPost, tasks, parseArgs, printJson, printError } from "../lib/dataforseo.js";
import { config } from "../lib/seo-config.js";

interface MonthlySearch {
  year: number;
  month: number;
  search_volume: number | null;
}

interface HistoricalItem {
  keyword: string;
  keyword_info: { monthly_searches: MonthlySearch[] | null } | null;
}

interface HistoricalResult {
  items: HistoricalItem[] | null;
}

export interface Seasonality {
  peak_volume: number;
  peak_month: number;
  peak_year: number;
  trough_volume: number;
  trough_month: number;
  amplitude_ratio: number;
  weeks_to_peak: number;
  is_evergreen: boolean;
}

/** Derive seasonality from a monthly_searches series. Returns null when no data. */
export function seasonalityFromMonthly(monthly: MonthlySearch[] | null | undefined): Seasonality | null {
  const rows = (monthly ?? [])
    .filter((m) => m.year && m.month)
    .map((m) => ({ year: m.year, month: m.month, vol: m.search_volume ?? 0 }));
  if (rows.length === 0) return null;

  const peak = rows.reduce((a, b) => (b.vol > a.vol ? b : a));
  const trough = rows.reduce((a, b) => (b.vol < a.vol ? b : a));
  const amplitude = peak.vol / Math.max(trough.vol, 1);
  const isEvergreen = amplitude < config.timing.evergreenAmplitude;

  // Weeks until the next occurrence of the peak month (mid-month anchor).
  const today = new Date();
  let target = new Date(today.getFullYear(), peak.month - 1, 15);
  if (target < today) target = new Date(today.getFullYear() + 1, peak.month - 1, 15);
  const weeksToPeak = Math.max(0, Math.floor((target.getTime() - today.getTime()) / (7 * 24 * 3600 * 1000)));

  return {
    peak_volume: peak.vol,
    peak_month: peak.month,
    peak_year: peak.year,
    trough_volume: trough.vol,
    trough_month: trough.month,
    amplitude_ratio: Math.round(amplitude * 10) / 10,
    weeks_to_peak: weeksToPeak,
    is_evergreen: isEvergreen,
  };
}

/**
 * Fetch seasonality for a batch of keywords. Returns a map keyed by the
 * lowercased keyword; keywords Labs has no data for map to null.
 */
export async function fetchSeasonality(
  keywords: string[],
  opts: { location: number; lang: string } = { location: config.defaultLocation, lang: config.defaultLang },
): Promise<Record<string, Seasonality | null>> {
  const out: Record<string, Seasonality | null> = {};
  for (const k of keywords) out[k.toLowerCase()] = null;
  if (keywords.length === 0) return out;

  const response = await dataforseoPost<HistoricalResult>("/dataforseo_labs/google/historical_search_volume/live", [
    { keywords, location_code: opts.location, language_code: opts.lang },
  ]);

  for (const task of tasks(response)) {
    for (const item of task.result?.items ?? []) {
      out[(item.keyword ?? "").toLowerCase()] = seasonalityFromMonthly(item.keyword_info?.monthly_searches);
    }
  }
  return out;
}

// ---------------------------------------------------------------- CLI entry
const invokedDirectly = process.argv[1]?.includes("historical-volume");
if (invokedDirectly) {
  const { positional: keywords, location, lang } = parseArgs(process.argv.slice(2));
  if (keywords.length === 0) {
    printError("Usage: historical-volume.ts <keyword> [<keyword2>...] [--location 2840] [--lang en]");
  }

  const seasonality = await fetchSeasonality(keywords, { location, lang });
  const output = keywords.map((kw) => ({
    keyword: kw,
    seasonality: seasonality[kw.toLowerCase()],
  }));
  printJson(output);
}
