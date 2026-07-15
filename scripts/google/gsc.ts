#!/usr/bin/env npx tsx
/**
 * Google Search Console — fetch search performance data directly.
 *
 * Usage:
 *   npx tsx scripts/gsc.ts queries --days 30 --limit 20
 *   npx tsx scripts/gsc.ts pages --days 7 --limit 50
 *   npx tsx scripts/gsc.ts query-pages "santorini" --days 30
 *
 * Requires: googleapis package (npm install in this tool's scripts/ dir).
 */

import { env, serviceAccountKey } from "../lib/env.js";

const SERVICE_ACCOUNT_KEY = serviceAccountKey();
const SITE_URL = env.GSC_SITE_URL;

if (!SERVICE_ACCOUNT_KEY) {
  console.error("Error: GSC_SERVICE_ACCOUNT_KEY or GSC_SERVICE_ACCOUNT_KEY_FILE required in .env");
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const command = args[0] ?? "queries";
let days = 30;
let limit = 20;
let filterQuery = "";

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--days" && args[i + 1]) days = Number.parseInt(args[++i], 10);
  else if (args[i] === "--limit" && args[i + 1]) limit = Number.parseInt(args[++i], 10);
  else if (!args[i].startsWith("--")) filterQuery = args[i];
}

// `sites` lists every property the service account can see — it needs no
// GSC_SITE_URL, and is the quickest way to check whether access was granted.
if (command !== "sites" && !SITE_URL) {
  console.error("Error: GSC_SITE_URL required in .env (e.g. https://example.com or sc-domain:example.com)");
  process.exit(1);
}

const { google } = await import("googleapis");

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(SERVICE_ACCOUNT_KEY),
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
});

const searchconsole = google.searchconsole({ version: "v1", auth });

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

// --prev shifts the window back one full period, for period-over-period diffs.
const prevPeriod = args.includes("--prev");
const startDate = prevPeriod ? daysAgo(2 * days) : daysAgo(days);
const endDate = prevPeriod ? daysAgo(days + 1) : daysAgo(1); // GSC data has ~2 day lag

interface DimensionFilter {
  dimension: string;
  operator: string;
  expression: string;
}

async function query(
  dimensions: string[],
  filters?: DimensionFilter[],
) {
  const requestBody: Record<string, unknown> = {
    startDate,
    endDate,
    dimensions,
    rowLimit: limit,
  };

  if (filters && filters.length > 0) {
    requestBody.dimensionFilterGroups = [
      { groupType: "and", filters },
    ];
  }

  const response = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody,
  });

  return (response.data.rows ?? []).map((row) => ({
    keys: row.keys,
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: ((row.ctr ?? 0) * 100).toFixed(2) + "%",
    position: (row.position ?? 0).toFixed(1),
  }));
}

if (command === "sites") {
  // List every property this service account can access, with its permission
  // level — the fastest way to confirm a grant landed and to copy the exact
  // GSC_SITE_URL string (sc-domain: vs https:// form).
  const res = await searchconsole.sites.list();
  const sites = (res.data.siteEntry ?? []).map((s) => ({
    site: s.siteUrl,
    permission: s.permissionLevel,
  }));
  console.log(JSON.stringify({ accessible_sites: sites }, null, 2));

} else if (command === "queries") {
  // Top search queries
  const rows = await query(["query"]);
  const output = rows.map((r) => ({
    query: r.keys?.[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    avg_position: r.position,
  }));
  console.log(JSON.stringify({ period: `${days} days`, site: SITE_URL, queries: output }, null, 2));

} else if (command === "pages") {
  // Top pages
  const rows = await query(["page"]);
  const output = rows.map((r) => ({
    page: r.keys?.[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    avg_position: r.position,
  }));
  console.log(JSON.stringify({ period: `${days} days`, site: SITE_URL, pages: output }, null, 2));

} else if (command === "query-pages") {
  // Pages for a specific query
  if (!filterQuery) {
    console.error("Usage: gsc.ts query-pages \"keyword\" [--days 30] [--limit 20]");
    process.exit(1);
  }
  const rows = await query(
    ["page", "query"],
    [{ dimension: "query", operator: "contains", expression: filterQuery }],
  );
  const output = rows.map((r) => ({
    page: r.keys?.[0],
    query: r.keys?.[1],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    avg_position: r.position,
  }));
  console.log(JSON.stringify({ period: `${days} days`, filter: filterQuery, results: output }, null, 2));

} else {
  console.error("Usage: gsc.ts <sites|queries|pages|query-pages> [--days 30] [--limit 20]");
  process.exit(1);
}
