#!/usr/bin/env npx tsx
/**
 * Competitor Analysis — compare domains by keyword overlap and backlink profiles.
 *
 * Usage:
 *   npx tsx scripts/competitors.ts "starogram.com" "astro.com" "horoscope.com"
 *   npx tsx scripts/competitors.ts "starogram.com" "costar.com" --location 2840 --lang en
 */

import { dataforseoPost, firstTask, totalCost, parseArgs, printJson, printError } from "../lib/dataforseo.js";

interface CompetitorKeyword {
  keyword: string;
  search_volume: number;
  competition_level: string;
  cpc: number;
  intersections: Record<string, { rank: number; url: string } | null>;
}

interface IntersectionResult {
  total_count: number;
  items_count: number;
  items: Array<{
    keyword_data: {
      keyword: string;
      keyword_info: {
        search_volume: number;
        competition_level: string;
        cpc: number;
      };
    };
    intersection_result: Record<string, Array<{ rank_group: number; url: string }> | null>;
  }> | null;
}

interface DomainRankResult {
  target: string;
  organic: {
    count: number;
    estimated_traffic_cost: number;
    pos_1: number;
    pos_2_3: number;
    pos_4_10: number;
    pos_11_20: number;
    pos_21_30: number;
  };
  backlinks: {
    total_backlinks: number;
    referring_domains: number;
  };
}

interface CompetitorsDomainResult {
  items: Array<{
    domain: string;
    intersections: number | null;
    avg_position: number | null;
    metrics?: { organic?: { count?: number; etv?: number } } | null;
    full_domain_metrics?: { organic?: { count?: number; etv?: number } } | null;
  }> | null;
}

const { positional: domains, location, lang, limit } = parseArgs(process.argv.slice(2));
const discoverMode = process.argv.includes("--discover");

// Discovery mode: find who organically competes with a single domain, rather
// than comparing domains you already named.
if (discoverMode) {
  if (domains.length === 0) {
    printError("Usage: competitors.ts <domain> --discover [--location 2840] [--lang en] [--limit 25]");
  }
  const target = domains[0];
  const response = await dataforseoPost<CompetitorsDomainResult>(
    "/dataforseo_labs/google/competitors_domain/live",
    [
      {
        target,
        location_code: location,
        language_code: lang,
        limit: limit > 0 ? limit : 25,
        order_by: ["intersections,desc"],
      },
    ],
  );
  const result = firstTask(response).result;
  const rivals = (result?.items ?? []).map((it) => {
    const organic = it.metrics?.organic ?? it.full_domain_metrics?.organic ?? {};
    return {
      domain: it.domain,
      shared_keywords: it.intersections ?? 0,
      avg_position: it.avg_position ?? null,
      organic_keywords: organic.count ?? 0,
      estimated_traffic_value: Math.round(organic.etv ?? 0),
    };
  });
  printJson({ target, mode: "discover", competing_domains: rivals, cost: totalCost(response) });
  process.exit(0);
}

if (domains.length < 2) {
  printError(
    "Usage: competitors.ts <your-domain> <competitor1> [<competitor2>...] [--location 2840] [--lang en]\n" +
      "   or: competitors.ts <domain> --discover   (find organic rivals automatically)",
  );
}

const yourDomain = domains[0];
const competitors = domains.slice(1);

// 1. Domain intersection (shared keywords)
const intersectionTargets: Record<string, string> = {};
for (let i = 0; i < domains.length; i++) {
  intersectionTargets[`${i + 1}`] = domains[i];
}

const [intersectionRes, ...rankResults] = await Promise.all([
  dataforseoPost<IntersectionResult>(
    "/dataforseo_labs/google/domain_intersection/live",
    [
      {
        targets: intersectionTargets,
        location_code: location,
        language_code: lang,
        limit,
        order_by: ["keyword_data.keyword_info.search_volume,desc"],
      },
    ],
  ),
  // Domain rank overview for each domain
  ...domains.map((domain) =>
    dataforseoPost<DomainRankResult>("/dataforseo_labs/google/domain_rank_overview/live", [
      {
        target: domain,
        location_code: location,
        language_code: lang,
      },
    ]),
  ),
]);

// Parse intersection results
const sharedKeywords = (firstTask(intersectionRes).result?.items ?? []).map((item) => {
  const kw = item.keyword_data;
  const intersections: Record<string, { rank: number; url: string } | null> = {};

  for (const [key, domain] of Object.entries(intersectionTargets)) {
    const data = item.intersection_result?.[key]?.[0];
    intersections[domain] = data ? { rank: data.rank_group, url: data.url } : null;
  }

  return {
    keyword: kw.keyword,
    volume: kw.keyword_info?.search_volume ?? 0,
    competition: kw.keyword_info?.competition_level ?? "N/A",
    cpc: kw.keyword_info?.cpc ?? 0,
    rankings: intersections,
  };
});

// Parse domain ranks
const domainOverviews = domains.map((domain, i) => {
  const result = firstTask(rankResults[i]).result;
  if (!result) return { domain, error: "No data" };

  return {
    domain,
    organic_keywords: result.organic?.count ?? 0,
    estimated_traffic_cost: result.organic?.estimated_traffic_cost ?? 0,
    top_3_keywords: (result.organic?.pos_1 ?? 0) + (result.organic?.pos_2_3 ?? 0),
    top_10_keywords: (result.organic?.pos_1 ?? 0) + (result.organic?.pos_2_3 ?? 0) + (result.organic?.pos_4_10 ?? 0),
    total_backlinks: result.backlinks?.total_backlinks ?? 0,
    referring_domains: result.backlinks?.referring_domains ?? 0,
  };
});

const cost = totalCost(intersectionRes) + rankResults.reduce((sum, r) => sum + totalCost(r), 0);

printJson({
  your_domain: yourDomain,
  competitors,
  domain_overviews: domainOverviews,
  shared_keywords: sharedKeywords,
  cost,
});
