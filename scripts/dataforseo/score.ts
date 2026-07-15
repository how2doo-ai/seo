#!/usr/bin/env npx tsx
/**
 * Opportunity Scoring — rank keywords by what's actually winnable, now.
 *
 * Composes the other scripts (seasonality + SERP signals + exact keyword data)
 * into a single deterministic verdict per keyword. Three gates then a score:
 *
 *   Gate DEMAND       peak/current volume ≥ config.gates.demandMinVolume
 *   Gate COMPETITION  no AI Overview, OR ≤N strong-authority domains in top-3
 *   Gate FIT          (optional) our catalog can answer it  [SEO_ENFORCE_FIT=1]
 *
 *   score = base_volume × competition_mult × timing_mult
 *     competition_mult = 1 / (1 + strong_domains_in_top_3)
 *     timing_mult      = seasonal boost when the peak lands in the publish window
 *
 * Tuning lives in scripts/seo-config.ts (+ SEO_* env vars) — thresholds, the
 * strong-domain authority list, and the timing curve are all editable there.
 *
 * Usage:
 *   npx tsx scripts/score.ts "mercury retrograde" "leo season" "daily horoscope"
 *   npx tsx scripts/score.ts candidates.csv --location 2840 --lang en
 *
 * candidates.csv columns (only `query` required):
 *   query,data_layer,answerable_by_catalog,canonical,note
 *   - canonical set → row is a satellite that rolls up under that query (CAPTURED)
 *   - data_layer + answerable_by_catalog feed the FIT gate when enforced
 *
 * Output: <outputDir>/<date>_<basename>.{json,csv}  (default agents-info/seo/scored/)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs, printError } from "../lib/dataforseo.js";
import { config, isStrongDomain } from "../lib/seo-config.js";
import { fetchSeasonality, type Seasonality } from "./historical-volume.js";
import { fetchKeywordOverview } from "./keyword-research.js";
import { fetchSerpSignals, type SerpSignals } from "./serp-analyze.js";

// Output lands in the project being worked on — cwd, same anchor env.ts uses
// for config. (Climbing from __dirname breaks under real plugin installs.)
const PROJECT_ROOT = process.cwd();

interface Candidate {
  query: string;
  data_layer?: string;
  answerable_by_catalog?: boolean;
  canonical?: string;
  note?: string;
}

type Verdict = "PASS" | "FAIL" | "CAPTURED";

interface Gate {
  pass: boolean;
  reason: string;
}

interface ScoredRecord {
  query: string;
  verdict: Verdict;
  score: number | null;
  base_volume: number;
  seasonality: Seasonality | null;
  kd: number | null;
  intent: string | null;
  top_3_domains: string[];
  strong_top_3: string[];
  weak_top_3: string[];
  has_ai_overview: boolean;
  paa_count: number;
  related_searches_count: number;
  gates: Record<string, Gate> | null;
  excluded_by: string[] | null;
  canonical: string | null;
  captured_volume: number;
  captured_queries: string[];
  score_breakdown: Record<string, unknown> | null;
  reasoning: string;
}

function truthy(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  return ["true", "yes", "y", "1"].includes(String(v ?? "").trim().toLowerCase());
}

// ------------------------------------------------------------- input parsing
/** Minimal CSV parser: handles double-quoted fields with embedded commas/quotes. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f.trim() !== "")) rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function loadCandidates(arg: string | undefined, keywords: string[]): Candidate[] {
  if (arg && (arg.endsWith(".csv") || arg.endsWith(".json"))) {
    const path = resolve(arg);
    if (!existsSync(path)) printError(`candidates file not found: ${path}`);
    const raw = readFileSync(path, "utf-8");
    if (arg.endsWith(".json")) {
      const data = JSON.parse(raw);
      return (Array.isArray(data) ? data : []).map((d: unknown) =>
        typeof d === "string" ? { query: d } : (d as Candidate),
      );
    }
    return parseCsv(raw).map((r) => ({
      query: r.query,
      data_layer: r.data_layer || undefined,
      answerable_by_catalog: truthy(r.answerable_by_catalog),
      canonical: r.canonical || undefined,
      note: r.note || undefined,
    }));
  }
  return keywords.map((q) => ({ query: q }));
}

// ------------------------------------------------------------- gates + score
function timingMult(s: Seasonality | null): number {
  if (!s || s.is_evergreen) return 1.0;
  const w = s.weeks_to_peak;
  const t = config.timing;
  if (w < t.minWeeks) return 1.0; // too late to index before the peak
  if (w <= t.sweetSpotMaxWeeks) return t.sweetSpotMult;
  if (w <= t.goodMaxWeeks) return t.goodMult;
  return 1.0; // peak too far out — defer
}

function evaluate(
  candidate: Candidate,
  base: number,
  current: number,
  serp: SerpSignals | null,
  strong: string[],
  weak: string[],
): { gates: Record<string, Gate>; excluded: string[]; breakdown: Record<string, unknown> | null } {
  const demandPass = base >= config.gates.demandMinVolume;
  const gates: Record<string, Gate> = {
    demand: {
      pass: demandPass,
      reason: `peak ${base} (current ${current}) ${demandPass ? "≥" : "<"} ${config.gates.demandMinVolume}`,
    },
  };

  const hasAio = !!serp?.has_ai_overview;
  const competitionPass = !hasAio || strong.length <= config.gates.aioMaxStrongTop3;
  gates.competition = {
    pass: competitionPass,
    reason: hasAio
      ? `AIO present; ${strong.length} strong in top-3 (${strong.join(", ") || "none"})`
      : `no AIO; ${weak.length}/3 top-3 weak`,
  };

  if (config.gates.enforceFit) {
    const layer = candidate.data_layer;
    const answerable = candidate.answerable_by_catalog;
    const fitPass = !!layer && !!answerable;
    gates.fit = {
      pass: fitPass,
      reason: fitPass
        ? `layer=${layer}, answerable=true`
        : !layer
          ? "no data_layer classified"
          : "answerable_by_catalog=false",
    };
  }

  const excluded = Object.entries(gates).filter(([, g]) => !g.pass).map(([name]) => name);
  if (excluded.length) return { gates, excluded, breakdown: null };

  const compMult = 1 / (1 + strong.length);
  // timing_mult is filled by the caller (needs seasonality); placeholder here.
  return {
    gates,
    excluded,
    breakdown: { base, competition_mult: Math.round(compMult * 1000) / 1000 },
  };
}

function reasoning(r: ScoredRecord): string {
  const parts: string[] = [];
  if (r.seasonality?.peak_month) parts.push(`peak ${r.base_volume} in month ${String(r.seasonality.peak_month).padStart(2, "0")}`);
  else if (r.base_volume) parts.push(`vol ${r.base_volume}`);
  if (r.seasonality && !r.seasonality.is_evergreen) parts.push(`${r.seasonality.weeks_to_peak}wk to peak`);
  if (r.seasonality?.is_evergreen) parts.push("evergreen");
  if (r.kd != null) parts.push(`KD ${r.kd}`);
  if (r.intent) parts.push(`intent=${r.intent}`);
  if (r.strong_top_3.length) parts.push(`strong: ${r.strong_top_3.join(",")}`);
  if (r.has_ai_overview) parts.push("AIO+");
  return parts.join(" | ");
}

// ----------------------------------------------------------------- CSV out
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main(): Promise<number> {
  const { positional, location, lang } = parseArgs(process.argv.slice(2));
  const fileArg = positional.find((p) => p.endsWith(".csv") || p.endsWith(".json"));
  const keywords = positional.filter((p) => p !== fileArg);

  if (!fileArg && keywords.length === 0) {
    printError('Usage: score.ts "<keyword>" [...]  |  score.ts candidates.csv  [--location 2840] [--lang en]');
  }

  const candidates = loadCandidates(fileArg, keywords);
  const canonicalSet = new Set(candidates.filter((c) => !c.canonical).map((c) => c.query.toLowerCase()));
  for (const c of candidates) {
    if (c.canonical && !canonicalSet.has(c.canonical.toLowerCase())) {
      process.stderr.write(`  WARN  '${c.query}' canonical='${c.canonical}' not in candidates\n`);
    }
  }
  const queries = candidates.map((c) => c.query);
  process.stderr.write(`  scoring ${candidates.length} candidates (loc ${location}, lang ${lang})\n`);

  // Batched market data (one call each, cached).
  process.stderr.write("  fetching seasonality + keyword overview…\n");
  const [seasonality, overview] = await Promise.all([
    fetchSeasonality(queries, { location, lang }),
    fetchKeywordOverview(queries, { location, lang }),
  ]);

  const records: ScoredRecord[] = [];
  for (const c of candidates) {
    const key = c.query.toLowerCase();
    process.stderr.write(`  --- ${c.query}\n`);
    const seas = seasonality[key] ?? null;
    const ov = overview[key] ?? { volume: null, kd: null, intent: null };

    let serp: SerpSignals | null = null;
    if (!c.canonical) {
      try {
        serp = await fetchSerpSignals(c.query, { location, lang });
      } catch (e) {
        process.stderr.write(`    SERP error: ${String(e).slice(0, 120)}\n`);
      }
    }

    const top3 = (serp?.top_domains ?? []).slice(0, 3);
    const strong = top3.filter((d) => isStrongDomain(d));
    const weak = top3.filter((d) => !isStrongDomain(d));
    const base = seas?.peak_volume ?? ov.volume ?? 0;
    const current = ov.volume ?? 0;

    const rec: ScoredRecord = {
      query: c.query,
      verdict: "FAIL",
      score: null,
      base_volume: base,
      seasonality: seas,
      kd: ov.kd,
      intent: ov.intent,
      top_3_domains: top3,
      strong_top_3: strong,
      weak_top_3: weak,
      has_ai_overview: !!serp?.has_ai_overview,
      paa_count: serp?.paa.length ?? 0,
      related_searches_count: serp?.related_searches.length ?? 0,
      gates: null,
      excluded_by: null,
      canonical: c.canonical ?? null,
      captured_volume: 0,
      captured_queries: [],
      score_breakdown: null,
      reasoning: "",
    };

    if (c.canonical) {
      rec.verdict = "CAPTURED";
      rec.reasoning = `captured by '${c.canonical}'`;
    } else {
      const { gates, excluded, breakdown } = evaluate(c, base, current, serp, strong, weak);
      rec.gates = gates;
      rec.excluded_by = excluded.length ? excluded : null;
      if (!excluded.length && breakdown) {
        const tm = timingMult(seas);
        const compMult = breakdown.competition_mult as number;
        rec.verdict = "PASS";
        rec.score = Math.round(base * compMult * tm);
        rec.score_breakdown = {
          ...breakdown,
          timing_mult: tm,
          formula: "base_volume × competition_mult × timing_mult",
          score: rec.score,
        };
      }
      rec.reasoning = reasoning(rec);
    }
    records.push(rec);
  }

  // Roll up satellite (CAPTURED) volume under each canonical — informational.
  const capturedVol: Record<string, number> = {};
  const capturedQ: Record<string, string[]> = {};
  for (const r of records) {
    if (r.verdict !== "CAPTURED" || !r.canonical) continue;
    const ck = r.canonical.toLowerCase();
    capturedVol[ck] = (capturedVol[ck] ?? 0) + r.base_volume;
    (capturedQ[ck] ??= []).push(r.query);
  }
  for (const r of records) {
    if (r.verdict === "CAPTURED") continue;
    r.captured_volume = capturedVol[r.query.toLowerCase()] ?? 0;
    r.captured_queries = capturedQ[r.query.toLowerCase()] ?? [];
  }

  // Sort: PASS by score desc, then FAIL by base desc; CAPTURED tucked after.
  const passes = records.filter((r) => r.verdict === "PASS").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const fails = records.filter((r) => r.verdict === "FAIL").sort((a, b) => b.base_volume - a.base_volume);
  const captured = records.filter((r) => r.verdict === "CAPTURED");
  const sorted = [...passes, ...fails, ...captured];

  // Write artifacts.
  const stamp = new Date().toISOString().slice(0, 10);
  const base = fileArg ? basename(fileArg, extname(fileArg)) : "keywords";
  const outDir = resolve(PROJECT_ROOT, config.outputDir);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const jsonOut = resolve(outDir, `${stamp}_${base}.json`);
  const csvOut = resolve(outDir, `${stamp}_${base}.csv`);
  writeFileSync(jsonOut, JSON.stringify(sorted, null, 2));

  const cols = [
    "verdict", "score", "query", "base_volume", "peak_month", "weeks_to_peak",
    "kd", "intent", "top_3_domains", "strong_top_3", "has_ai_overview",
    "paa_count", "captured_volume", "excluded_by", "reasoning",
  ];
  const lines = [cols.join(",")];
  for (const r of sorted) {
    lines.push([
      r.verdict, r.score ?? "", r.query, r.base_volume,
      r.seasonality?.peak_month ?? "", r.seasonality?.weeks_to_peak ?? "",
      r.kd ?? "", r.intent ?? "", r.top_3_domains.join(" "), r.strong_top_3.join(" "),
      r.has_ai_overview, r.paa_count, r.captured_volume,
      (r.excluded_by ?? []).join(" "), r.reasoning,
    ].map(csvCell).join(","));
  }
  writeFileSync(csvOut, lines.join("\n"));

  // Summary.
  process.stderr.write(`\n  ${passes.length} PASS / ${captured.length} CAPTURED / ${fails.length} FAIL\n`);
  process.stderr.write(`  → ${jsonOut.replace(`${PROJECT_ROOT}/`, "")}\n`);
  if (passes.length) {
    process.stderr.write("\n  TOP OPPORTUNITIES:\n");
    for (const r of passes.slice(0, 10)) {
      process.stderr.write(`    ${String(r.score).padStart(6)}  ${r.query}\n            ${r.reasoning}\n`);
    }
  }
  return 0;
}

const invokedDirectly = process.argv[1]?.includes("score");
if (invokedDirectly) {
  process.exit(await main());
}
