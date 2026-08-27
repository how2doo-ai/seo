/**
 * Regression: the two Labs discovery endpoints do not share an item shape.
 *
 *   keyword_suggestions/live  items[i] IS the keyword's data      (flat)
 *   related_keywords/live     items[i].keyword_data IS it         (nested)
 *
 * Reading flat on the nested shape made every related-mode row come back
 * `keyword: undefined, volume: 0, competition: "N/A"` — indistinguishable
 * from "the vendor has no data for this locale", which is exactly the claim
 * the marketing-agents goal set was trying to falsify.
 *
 * FIXTURES ARE REDUCED REAL RESPONSES, never hand-written — a hand-written
 * fixture would encode the same misunderstanding that caused the bug. Source
 * (ipforge.xyz/.claude/seo/.cache/, trimmed: monthly_searches / serp_info /
 * avg_backlinks_info / normalized-* dropped, items capped at 3, task id and
 * offset_token stripped):
 *
 *   related-keywords.live.json
 *     <- POST__dataforseo_labs_google_related_keywords_live__18467460c90c0228.json
 *   keyword-suggestions.live.json
 *     <- POST__dataforseo_labs_google_keyword_suggestions_live__d68993917553eccb.json
 *   related-keywords.null-metrics.live.json
 *     <- POST__dataforseo_labs_google_related_keywords_live__de18fa23f791d7c5.json
 *
 * The first two are the SAME seed ("айпи логгер", ru / location 2804) through
 * the two endpoints, so any difference in the parsed rows is the shape and
 * nothing else.
 *
 * Run: npm test   (node:test + node:assert, both built in — no new deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { keywordDataOf, toRow } from "../dataforseo/keyword-shapes.js";
import type { KeywordData, RelatedItem } from "../dataforseo/keyword-shapes.js";

const here = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  tasks: Array<{ result: Array<{ seed_keyword: string; items: unknown[] | null }> }>;
}

function load(name: string): { seed: string; items: unknown[] } {
  const raw = JSON.parse(readFileSync(resolve(here, "fixtures", name), "utf-8")) as Fixture;
  const result = raw.tasks[0].result[0];
  return { seed: result.seed_keyword, items: result.items ?? [] };
}

const related = load("related-keywords.live.json");
const suggestions = load("keyword-suggestions.live.json");
const relatedNullMetrics = load("related-keywords.null-metrics.live.json");

// --------------------------------------------------- the shapes really differ
// If these ever fail, the fix below is solving a problem that no longer exists
// (or the fixtures were regenerated from the wrong endpoint).

test("related_keywords items nest the payload under keyword_data", () => {
  for (const item of related.items as Record<string, unknown>[]) {
    assert.ok(item.keyword_data, "expected items[i].keyword_data");
    assert.equal(item.keyword, undefined, "related items carry NO top-level keyword");
    assert.equal(item.keyword_info, undefined, "related items carry NO top-level keyword_info");
  }
});

test("keyword_suggestions items carry the payload flat", () => {
  for (const item of suggestions.items as Record<string, unknown>[]) {
    assert.equal(item.keyword_data, undefined, "suggestion items have NO keyword_data wrapper");
    assert.equal(typeof item.keyword, "string");
    assert.ok(item.keyword_info, "expected items[i].keyword_info");
  }
});

test("both fixtures are the same seed, so only the shape differs", () => {
  assert.equal(related.seed, "айпи логгер");
  assert.equal(suggestions.seed, "айпи логгер");
});

// ------------------------------------------------------ the normalizer itself

test("related mode reads through keyword_data — real metrics, not defaults", () => {
  const rows = keywordDataOf(related.items as RelatedItem[], "related").map(toRow);

  assert.equal(rows.length, 3, "no row may be dropped");
  assert.deepEqual(rows[0], {
    keyword: "айпи логгер",
    volume: 880,
    competition: "LOW",
    cpc: 0,
    difficulty: 0,
    intent: "navigational",
  });
  assert.deepEqual(rows[1], {
    keyword: "узнать айпи",
    volume: 880,
    competition: "LOW",
    cpc: 0,
    difficulty: 26,
    intent: "informational",
  });
  assert.equal(rows[2].keyword, "ip logger image");
  assert.equal(rows[2].volume, 390);

  // The bug's exact signature: every field at its `??` default.
  assert.ok(
    rows.every((r) => typeof r.keyword === "string" && r.keyword.length > 0),
    "every related row must name its keyword",
  );
  assert.ok(
    rows.some((r) => r.volume > 0),
    "related rows must not all flatten to volume 0",
  );
});

test("suggestions mode still reads flat — the fix must not move this path", () => {
  const rows = keywordDataOf(suggestions.items as KeywordData[], "suggestions").map(toRow);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    keyword: "айпи логгер",
    volume: 880,
    competition: "LOW",
    cpc: 0,
    difficulty: 0,
    intent: "navigational",
  });
  assert.equal(rows[1].keyword, "логгер айпи");
  assert.equal(rows[1].volume, 10);
});

test("same seed through both endpoints yields the same first row", () => {
  const a = keywordDataOf(related.items as RelatedItem[], "related").map(toRow)[0];
  const b = keywordDataOf(suggestions.items as KeywordData[], "suggestions").map(toRow)[0];
  assert.deepEqual(a, b);
});

test("mode is what does the work: reading related items as flat yields nothing", () => {
  // This is the old behaviour, reproduced deliberately. It must produce zero
  // usable rows — proving the wrong mode fails loudly rather than returning
  // a full-looking table of zeros.
  const rows = keywordDataOf(related.items as KeywordData[], "suggestions");
  assert.equal(rows.length, 0);
});

test("a genuine vendor null still reads as 0, and is not confused with the bug", () => {
  // de18fa23: one real related item whose keyword_info is entirely null.
  // The keyword survives; only the metrics are absent. That is the shape of
  // "the vendor has no data", and it is visibly different from the bug.
  const rows = keywordDataOf(relatedNullMetrics.items as RelatedItem[], "related").map(toRow);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].keyword, "узнать кто перешел по ссылке");
  assert.equal(rows[0].volume, 0);
  assert.equal(rows[0].competition, "N/A");
  assert.equal(rows[0].intent, "informational");
});

test("empty and null item lists are not an error", () => {
  assert.deepEqual(keywordDataOf(null, "related"), []);
  assert.deepEqual(keywordDataOf(undefined, "suggestions"), []);
  assert.deepEqual(keywordDataOf([], "related"), []);
});
