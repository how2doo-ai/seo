#!/usr/bin/env npx tsx
/**
 * Google Trends — interest over time via DataForSEO.
 *
 * Usage:
 *   npx tsx scripts/trends.ts "horoscope" "astrology" --days 90
 *   npx tsx scripts/trends.ts "natal chart" --type web --location 2840
 *   npx tsx scripts/trends.ts "tarot reading" "astrology reading" --days 30
 *
 * Options:
 *   --days <n>       Lookback period (default: 90)
 *   --location <id>  Location code (default: 2840 = US)
 *   --lang <code>    Language (default: en)
 *   --type <type>    Search type: web, news, youtube, images, shopping (default: web)
 *   --category <id>  Category ID, 0 = all (default: 0)
 */

import { dataforseoPost, firstTask, printJson, printError } from "../lib/dataforseo.js";

interface TrendDataPoint {
  date_from: string;
  date_to: string;
  timestamp: number;
  missing_data: boolean;
  values: number[];
}

interface TrendGraphItem {
  position: number;
  type: string;
  title: string | null;
  keywords: string[];
  data: TrendDataPoint[];
}

interface TrendsResult {
  keywords: string[];
  type: string;
  location_code: number;
  language_code: string;
  check_url: string;
  items_count: number;
  items: TrendGraphItem[];
}

const allArgs = process.argv.slice(2);

const keywords: string[] = [];
let days = 90;
let location = 2840;
let lang = "en";
let searchType = "web";
let category = 0;

for (let i = 0; i < allArgs.length; i++) {
  const arg = allArgs[i];
  if (arg === "--days" && allArgs[i + 1]) { days = Number.parseInt(allArgs[++i], 10); }
  else if (arg === "--location" && allArgs[i + 1]) { location = Number.parseInt(allArgs[++i], 10); }
  else if (arg === "--lang" && allArgs[i + 1]) { lang = allArgs[++i]; }
  else if (arg === "--type" && allArgs[i + 1]) { searchType = allArgs[++i]; }
  else if (arg === "--category" && allArgs[i + 1]) { category = Number.parseInt(allArgs[++i], 10); }
  else if (!arg.startsWith("--")) { keywords.push(arg); }
}

if (keywords.length === 0) {
  printError("Usage: trends.ts <keyword1> [keyword2...] [--days 90] [--location 2840] [--type web]");
}

if (keywords.length > 5) {
  printError("Google Trends supports max 5 keywords per request");
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const response = await dataforseoPost<TrendsResult>(
  "/keywords_data/google_trends/explore/live",
  [
    {
      keywords,
      location_code: location,
      language_code: lang,
      type: searchType,
      category_code: category,
      date_from: daysAgo(days),
      date_to: daysAgo(0),
    },
  ],
);

const task = firstTask(response);
if (!task.ok || !task.result) {
  printError(task.error ?? "Unknown error");
}

const result = task.result!;
const graphItem = result.items?.find((i) => i.type === "google_trends_graph");

if (!graphItem?.data) {
  printError("No trend data returned");
}

const data = graphItem!.data;
const kwList = graphItem!.keywords;

// Build per-keyword time series — values[] is ordered same as keywords[]
const series: Record<string, Array<{ date: string; value: number }>> = {};
for (const kw of kwList) {
  series[kw] = [];
}

for (const point of data) {
  const date = point.date_from;
  for (let i = 0; i < kwList.length; i++) {
    const value = point.values[i] ?? 0;
    series[kwList[i]].push({ date, value });
  }
}

// Summary stats per keyword
const summary = kwList.map((kw) => {
  const points = series[kw];
  const values = points.map((d) => d.value);
  const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const current = values.length > 0 ? values[values.length - 1] : 0;
  const previous = values.length > 1 ? values[values.length - 2] : current;
  const trend = current - previous;

  return {
    keyword: kw,
    current,
    average: Math.round(avg),
    max,
    min,
    trend: trend > 0 ? `+${trend}` : `${trend}`,
    data_points: points.length,
  };
});

printJson({
  keywords: kwList,
  period: `${days} days`,
  location: result.location_code,
  type: searchType,
  google_trends_url: result.check_url,
  summary,
  time_series: series,
  cost: task.cost,
});

