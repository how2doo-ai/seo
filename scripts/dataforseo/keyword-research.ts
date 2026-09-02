#!/usr/bin/env npx tsx
/**
 * Keyword Research — related keywords / suggestions with volume, KD, intent.
 *
 * Two discovery modes:
 *   related (default)  semantic neighbours via Labs related_keywords
 *   --suggestions      substring/phrase expansion via Labs keyword_suggestions,
 *                      which additionally returns search INTENT + difficulty
 *
 * The two endpoints return DIFFERENT item shapes — see keyword-shapes.ts, which
 * owns the types and the endpoint-aware normalizer. Do not read `keyword_info`
 * off a discovery item here; go through keywordDataOf(items, mode).
 *
 * Usage:
 *   npx tsx scripts/keyword-research.ts "astrology readings" --location 2840 --lang en --limit 30
 *   npx tsx scripts/keyword-research.ts "daily horoscope" --suggestions --limit 50
 *
 * fetchKeywordOverview() is exported: an exact-keyword lookup (volume + KD +
 * intent in one batched call) used by the scorer.
 */

import { dataforseoPost, tasks, parseArgs, printJson, printError } from "../lib/dataforseo.js";
import { keywordDataOf, toRow } from "./keyword-shapes.js";
import type { DiscoveryMode, DiscoveryResult, OverviewResult } from "./keyword-shapes.js";

export * from "./keyword-shapes.js";

export interface KeywordOverview {
  volume: number | null;
  kd: number | null;
  intent: string | null;
}

/**
 * Exact-keyword lookup: volume + keyword difficulty + search intent for the
 * given keywords (not expansions). One batched Labs keyword_overview call.
 * Returns a map keyed by lowercased keyword.
 */
export async function fetchKeywordOverview(
  keywords: string[],
  opts: { location: number; lang: string },
): Promise<Record<string, KeywordOverview>> {
  const out: Record<string, KeywordOverview> = {};
  for (const k of keywords) out[k.toLowerCase()] = { volume: null, kd: null, intent: null };
  if (keywords.length === 0) return out;

  const response = await dataforseoPost<OverviewResult>("/dataforseo_labs/google/keyword_overview/live", [
    { keywords, location_code: opts.location, language_code: opts.lang },
  ]);
  for (const task of tasks(response)) {
    // keyword_overview items are FLAT — no keyword_data wrapper. Verified
    // against the endpoint's contract, not against a cached response: this
    // set has never paid for a keyword_overview call.
    for (const item of task.result?.items ?? []) {
      out[(item.keyword ?? "").toLowerCase()] = {
        volume: item.keyword_info?.search_volume ?? null,
        kd: item.keyword_properties?.keyword_difficulty ?? null,
        intent: item.search_intent_info?.main_intent ?? null,
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------- CLI entry
// Anchored to the filename so importing this module (from a test, or from
// score.ts) can never trip the CLI on a loose substring match.
const invokedDirectly = /[/\\]keyword-research\.(ts|mts|js|mjs)$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  const { positional: keywords, location, lang, limit } = parseArgs(process.argv.slice(2));
  const useSuggestions = process.argv.includes("--suggestions");
  const mode: DiscoveryMode = useSuggestions ? "suggestions" : "related";

  if (keywords.length === 0) {
    printError(
      "Usage: keyword-research.ts <keyword> [<keyword2>...] [--suggestions] [--location 2840] [--lang en] [--limit 20]",
    );
  }

  const endpoint = useSuggestions
    ? "/dataforseo_labs/google/keyword_suggestions/live"
    : "/dataforseo_labs/google/related_keywords/live";

  const payload = keywords.map((keyword) =>
    useSuggestions
      ? { keyword, location_code: location, language_code: lang, limit, include_seed_keyword: true }
      : { keyword, location_code: location, language_code: lang, limit, include_seed_keyword: true, depth: 2 },
  );

  const response = await dataforseoPost<DiscoveryResult>(endpoint, payload);

  const output = tasks(response).map((task) => {
    if (!task.ok || !task.result) {
      return { keyword: task.keyword, error: task.error };
    }
    const result = task.result;
    const seed = result.seed_keyword_data;
    // `mode` — not the item's own shape — decides how items are read.
    const items = keywordDataOf(result.items, mode).map(toRow);
    items.sort((a, b) => b.volume - a.volume);

    return {
      mode,
      seed_keyword: result.seed_keyword,
      seed_volume: seed?.keyword_info?.search_volume ?? 0,
      seed_competition: seed?.keyword_info?.competition_level ?? "N/A",
      related_count: result.items_count,
      related: items,
      cost: task.cost,
    };
  });

  printJson(output);
}
