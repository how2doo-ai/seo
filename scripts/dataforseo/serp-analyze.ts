#!/usr/bin/env npx tsx
/**
 * SERP Analysis — live Google SERP + full signal extraction.
 *
 * Usage:
 *   npx tsx scripts/serp-analyze.ts "daily horoscope" --location 2840 --lang en
 *   npx tsx scripts/serp-analyze.ts "leo compatibility" --device mobile --limit 10
 *
 * Beyond the organic results, this extracts the signals that actually decide
 * whether a keyword is worth chasing today:
 *   - top_domains:       who owns the top 10 (the "can we even compete" signal)
 *   - has_ai_overview:   AI Overview present? (suppresses organic CTR) + its sources
 *   - has_featured_snippet + the snippet text/source
 *   - paa:               People-Also-Ask questions + answers (content outline gold)
 *   - related_searches:  Google's "people also search for"
 *   - serp_features:     count of every block type present
 *
 * `analyzeSerp()` is exported so the scorer (score.ts) reuses the exact logic.
 */

import { dataforseoPost, tasks, parseArgs, printJson, printError } from "../lib/dataforseo.js";

// The /advanced endpoint returns heterogeneous blocks; type loosely and read
// defensively. Only the fields we actually touch are named.
interface SerpBlock {
  type?: string;
  rank_group?: number;
  title?: string;
  url?: string;
  domain?: string;
  description?: string;
  items?: SerpBlock[];
  expanded_element?: Array<{ url?: string; domain?: string; description?: string }>;
  references?: Array<{ url?: string; domain?: string; title?: string }>;
  text?: string;
}

interface SerpResult {
  keyword: string;
  type: string;
  se_results_count: number;
  items_count: number;
  items: SerpBlock[] | null;
  spell?: { type: string; keyword: string } | null;
}

export interface SerpSignals {
  top_organic: Array<{ rank: number | null; domain: string; title?: string; url?: string; snippet?: string }>;
  top_domains: string[];
  paa: Array<{ question?: string; answer_url?: string; answer_domain?: string; answer_snippet?: string }>;
  related_searches: string[];
  has_ai_overview: boolean;
  ai_overview: { references: Array<{ url?: string; domain?: string; title?: string }>; text: string } | null;
  has_featured_snippet: boolean;
  featured_snippet: { text?: string; url?: string; domain?: string } | null;
  serp_features: Record<string, number>;
}

function paaAnswer(elem: SerpBlock) {
  const a = elem.expanded_element?.[0];
  return {
    answer_url: a?.url,
    answer_domain: a?.domain,
    answer_snippet: a?.description,
  };
}

function aiOverviewText(block: SerpBlock): string {
  const parts: string[] = [];
  for (const it of block.items ?? []) {
    if (it.text) parts.push(it.text);
    for (const sub of it.items ?? []) {
      if (sub.text) parts.push(sub.text);
    }
  }
  return parts.map((p) => p.trim()).filter(Boolean).join("\n");
}

/** Extract every useful signal from a SERP's items array. */
export function analyzeSerp(items: SerpBlock[]): SerpSignals {
  const topOrganic: SerpSignals["top_organic"] = [];
  const paa: SerpSignals["paa"] = [];
  const relatedSearches: string[] = [];
  let aiOverview: SerpSignals["ai_overview"] = null;
  let featuredSnippet: SerpSignals["featured_snippet"] = null;
  const features: Record<string, number> = {};

  for (const it of items) {
    const t = it.type ?? "unknown";
    features[t] = (features[t] ?? 0) + 1;

    if (t === "organic") {
      topOrganic.push({
        rank: it.rank_group ?? null,
        domain: it.domain ?? "",
        title: it.title,
        url: it.url,
        snippet: it.description?.slice(0, 200),
      });
    } else if (t === "people_also_ask") {
      for (const elem of it.items ?? []) {
        paa.push({ question: elem.title, ...paaAnswer(elem) });
      }
    } else if (t === "related_searches") {
      for (const q of it.items ?? []) {
        if (typeof q === "string") relatedSearches.push(q);
        else if (q && typeof q === "object" && q.title) relatedSearches.push(q.title);
      }
    } else if (t === "ai_overview") {
      aiOverview = {
        references: (it.references ?? []).map((r) => ({ url: r.url, domain: r.domain, title: r.title })),
        text: aiOverviewText(it),
      };
    } else if (t === "featured_snippet") {
      featuredSnippet = { text: it.description, url: it.url, domain: it.domain };
    }
  }

  topOrganic.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const topDomains: string[] = [];
  const seen = new Set<string>();
  for (const r of topOrganic.slice(0, 10)) {
    if (r.domain && !seen.has(r.domain)) {
      seen.add(r.domain);
      topDomains.push(r.domain);
    }
  }

  return {
    top_organic: topOrganic.slice(0, 20),
    top_domains: topDomains,
    paa,
    related_searches: relatedSearches,
    has_ai_overview: aiOverview !== null,
    ai_overview: aiOverview,
    has_featured_snippet: featuredSnippet !== null,
    featured_snippet: featuredSnippet,
    serp_features: features,
  };
}

/** Fetch a single query's SERP and return its extracted signals. Cached via the client. */
export async function fetchSerpSignals(
  keyword: string,
  opts: { location: number; lang: string; device?: string; depth?: number } = { location: 2840, lang: "en" },
): Promise<SerpSignals> {
  const response = await dataforseoPost<SerpResult>("/serp/google/organic/live/advanced", [
    {
      keyword,
      location_code: opts.location,
      language_code: opts.lang,
      device: opts.device ?? "desktop",
      depth: opts.depth ?? 20,
      load_async_ai_overview: true,
      people_also_ask_click_depth: 1,
    },
  ]);
  const items = tasks(response)[0]?.result?.items ?? [];
  return analyzeSerp(items as SerpBlock[]);
}

// ---------------------------------------------------------------- CLI entry
// Only run the CLI when invoked directly, so score.ts can import the helpers.
const invokedDirectly = process.argv[1]?.includes("serp-analyze");
if (invokedDirectly) {
  const { positional: keywords, location, lang, limit, device } = parseArgs(process.argv.slice(2));

  if (keywords.length === 0) {
    printError("Usage: serp-analyze.ts <keyword> [--location 2840] [--lang en] [--device desktop] [--limit 20]");
  }

  const payload = keywords.map((keyword) => ({
    keyword,
    location_code: location,
    language_code: lang,
    device,
    depth: limit,
    load_async_ai_overview: true,
    people_also_ask_click_depth: 1,
  }));

  const response = await dataforseoPost<SerpResult>("/serp/google/organic/live/advanced", payload);

  const output = tasks(response).map((task) => {
    if (!task.ok || !task.result) {
      return { keyword: task.keyword, error: task.error };
    }
    const result = task.result;
    const sig = analyzeSerp((result.items ?? []) as SerpBlock[]);
    return {
      keyword: result.keyword,
      total_results: result.se_results_count,
      spell_correction: result.spell?.keyword ?? null,
      serp_features: Object.keys(sig.serp_features),
      has_ai_overview: sig.has_ai_overview,
      ai_overview_sources: sig.ai_overview?.references.map((r) => r.domain).filter(Boolean) ?? [],
      has_featured_snippet: sig.has_featured_snippet,
      featured_snippet: sig.featured_snippet,
      people_also_ask: sig.paa,
      related_searches: sig.related_searches,
      top_domains: sig.top_domains,
      organic_results: sig.top_organic.map((o) => ({
        position: o.rank,
        domain: o.domain,
        title: o.title,
        url: o.url,
        description: o.snippet,
      })),
      cost: task.cost,
    };
  });

  printJson(output);
}
