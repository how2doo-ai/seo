/**
 * Labs keyword response shapes, and the one adapter that normalizes them.
 *
 * Pure: no API client, no credential loading, no I/O beyond a stderr warning.
 * That is deliberate — the shape logic is the part that broke, so it has to be
 * testable without a configured .env. keyword-research.ts re-exports all of it.
 *
 * The two endpoints behind the keyword-research CLI do NOT return the same
 * `items[]`:
 *
 *   keyword_suggestions/live   items[i] IS the keyword's data       (flat)
 *   related_keywords/live      items[i] WRAPS it in .keyword_data   (nested,
 *                              beside .depth and .related_keywords)
 *   keyword_overview/live      items[i] IS the keyword's data       (flat)
 *
 * Typing both as one flat type is what let a real bug compile: read flat on
 * the nested shape and *every* field falls through its `??` default —
 * keyword undefined, volume 0, competition "N/A" — which reads as "the vendor
 * has no data for this locale" rather than "we read the wrong key". So the two
 * shapes stay distinct types here, and keywordDataOf() is the only bridge.
 * competitors.ts:143 already unwrapped `item.keyword_data` correctly for
 * domain_intersection, which is where the nested shape was first confirmed.
 *
 * Ground truth for both shapes: real cached responses,
 * POST__dataforseo_labs_google_{related_keywords,keyword_suggestions}_live__*.json
 * (reduced copies in tests/fixtures/, see tests/keyword-shape.test.ts).
 */

export interface KeywordInfo {
  search_volume: number | null;
  competition_level: string | null;
  cpc: number | null;
}

/** A keyword and its metrics — the payload every Labs keyword endpoint carries. */
export interface KeywordData {
  keyword: string | null;
  keyword_info: KeywordInfo | null;
  keyword_properties: { keyword_difficulty: number | null } | null;
  search_intent_info: { main_intent: string | null } | null;
}

/** related_keywords/live wraps the KeywordData one level down. */
export interface RelatedItem {
  keyword_data: KeywordData | null;
  depth?: number;
  related_keywords?: string[] | null;
}

/**
 * Both discovery endpoints share this wrapper; only `items` differs — hence
 * the type parameter. `seed_keyword_data` is flat on BOTH: the nesting is a
 * property of the items array alone, not of the result.
 */
export interface SeedResult<TItem> {
  seed_keyword: string;
  seed_keyword_data: KeywordData | null;
  items_count: number;
  items: TItem[] | null;
}

/**
 * What the CLI actually gets back, given that the endpoint is chosen at
 * runtime. The union is deliberate and load-bearing: `item.keyword_info` no
 * longer compiles against it, so the original bug cannot be rewritten by hand.
 */
export type DiscoveryResult = SeedResult<KeywordData | RelatedItem>;

/** keyword_overview/live returns flat items, same payload shape. */
export interface OverviewResult {
  items: KeywordData[] | null;
}

export type DiscoveryMode = "related" | "suggestions";

/** A KeywordData that actually names a keyword — what keywordDataOf() emits. */
export type NamedKeywordData = KeywordData & { keyword: string };

/** One CLI output row. The public JSON shape — goal 05 and verify.mjs read it. */
export interface KeywordRow {
  keyword: string;
  volume: number;
  competition: string;
  cpc: number;
  difficulty: number | null;
  intent: string | null;
}

/**
 * Endpoint-aware normalizer: turn either endpoint's `items[]` into the one
 * internal shape.
 *
 * `mode` comes from the endpoint that was CALLED, never from sniffing the
 * payload. Sniffing would paper over a vendor shape change; keying on the
 * endpoint means such a change shows up as a dropped row plus a warning on
 * stderr instead of a plausible-looking zero.
 */
export function keywordDataOf(
  items: ReadonlyArray<KeywordData | RelatedItem> | null | undefined,
  mode: DiscoveryMode,
): NamedKeywordData[] {
  const source = items ?? [];
  const out: NamedKeywordData[] = [];

  for (const item of source) {
    const kw = mode === "related" ? (item as RelatedItem).keyword_data : (item as KeywordData);
    if (kw && typeof kw.keyword === "string") out.push(kw as NamedKeywordData);
  }

  const dropped = source.length - out.length;
  if (dropped > 0) {
    // Never silent: a row without a keyword is exactly what the old bug
    // produced for every single related-mode result.
    process.stderr.write(
      `  [warn]      ${dropped}/${source.length} ${mode} item(s) carried no keyword — response shape may have changed\n`,
    );
  }
  return out;
}

/** Project a normalized keyword onto the CLI's output row. */
export function toRow(kw: NamedKeywordData): KeywordRow {
  return {
    keyword: kw.keyword,
    volume: kw.keyword_info?.search_volume ?? 0,
    competition: kw.keyword_info?.competition_level ?? "N/A",
    cpc: kw.keyword_info?.cpc ?? 0,
    difficulty: kw.keyword_properties?.keyword_difficulty ?? null,
    intent: kw.search_intent_info?.main_intent ?? null,
  };
}
