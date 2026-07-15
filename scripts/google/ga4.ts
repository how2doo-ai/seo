#!/usr/bin/env npx tsx
/**
 * GA4 Analytics — fetch traffic, engagement, and conversion data.
 *
 * Usage:
 *   npx tsx scripts/ga4.ts traffic --days 30 [--organic]
 *   npx tsx scripts/ga4.ts pages --days 7 --limit 20
 *   npx tsx scripts/ga4.ts sources --days 30
 *   npx tsx scripts/ga4.ts geo --by city --days 30
 *   npx tsx scripts/ga4.ts conversions --days 30 [--event purchase] [--organic]
 *
 * `conversions` reports conversions + revenue split by channel, so the
 * "Organic Search" row is the SEO-attributed business outcome. Pass
 * --event <name> to isolate a single key event (e.g. the Compatibility Chart
 * purchase). Note: returns zeros unless GA4 has key events / ecommerce set up.
 *
 * Requires: googleapis package (npm install in this tool's scripts/ dir).
 */

import { env, serviceAccountKey } from "../lib/env.js";

const SERVICE_ACCOUNT_KEY = serviceAccountKey();
const PROPERTY_ID = env.GA4_PROPERTY_ID;

if (!SERVICE_ACCOUNT_KEY) {
  console.error("Error: GSC_SERVICE_ACCOUNT_KEY or GSC_SERVICE_ACCOUNT_KEY_FILE required in .env");
  process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
const command = args[0] ?? "traffic";
let days = 30;
let limit = 20;
let eventName = "";
let geoBy = "city";
const organicOnly = args.includes("--organic");

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--days" && args[i + 1]) days = Number.parseInt(args[++i], 10);
  else if (args[i] === "--limit" && args[i + 1]) limit = Number.parseInt(args[++i], 10);
  else if (args[i] === "--event" && args[i + 1]) eventName = args[++i];
  else if (args[i] === "--by" && args[i + 1]) geoBy = args[++i];
}

// Every command except `properties` (which discovers ids) needs a property id.
if (command !== "properties" && !PROPERTY_ID) {
  console.error("Error: GA4_PROPERTY_ID required in .env (e.g. properties/123456789)");
  console.error("Tip: run `ga4.ts properties` to list the property ids this account can access.");
  process.exit(1);
}

// GA4 channel grouping value for organic search traffic.
const ORGANIC_FILTER = {
  filter: {
    fieldName: "sessionDefaultChannelGroup",
    stringFilter: { matchType: "EXACT", value: "Organic Search" },
  },
};

const { google } = await import("googleapis");

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(SERVICE_ACCOUNT_KEY),
  scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
});

const analyticsData = google.analyticsdata({ version: "v1beta", auth });

if (command === "properties") {
  // Discover every GA4 property this service account can access, with its
  // numeric id and display name — the value to put in GA4_PROPERTY_ID. Uses the
  // Admin API (accountSummaries) rather than the Data API.
  const admin = google.analyticsadmin({ version: "v1beta", auth });
  try {
    const res = await admin.accountSummaries.list({ pageSize: 200 });
    const out = (res.data.accountSummaries ?? []).flatMap((acc) =>
      (acc.propertySummaries ?? []).map((p) => ({
        account: acc.displayName,
        property: p.property, // e.g. "properties/123456789"
        property_id: `properties/${(p.property ?? "").split("/").pop()}`,
        display_name: p.displayName,
      })),
    );
    console.log(JSON.stringify({ accessible_properties: out }, null, 2));
    process.exit(0);
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    if (/SERVICE_DISABLED|has not been used in project|accessNotConfigured/.test(msg)) {
      console.error("The Google Analytics Admin API is not enabled in this service account's GCP project.");
      console.error("Enable it once (it's free), then retry:");
      console.error("  https://console.developers.google.com/apis/api/analyticsadmin.googleapis.com/overview");
      console.error("Or just copy the numeric Property ID from GA4 Admin → Property Settings into GA4_PROPERTY_ID.");
    } else {
      console.error(`Failed to list GA4 properties: ${msg.slice(0, 300)}`);
    }
    process.exit(1);
  }
}

// --prev shifts the window back one full period, for period-over-period diffs.
const prevPeriod = args.includes("--prev");
const startDate = prevPeriod ? `${2 * days}daysAgo` : `${days}daysAgo`;
const endDate = prevPeriod ? `${days + 1}daysAgo` : "today";

async function runReport(
  dimensions: string[],
  metrics: string[],
  orderBy?: string,
  dimensionFilter?: Record<string, unknown>,
) {
  const response = await analyticsData.properties.runReport({
    property: PROPERTY_ID,
    requestBody: {
      dateRanges: [{ startDate, endDate }],
      dimensions: dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      limit,
      orderBys: orderBy
        ? [{ metric: { metricName: orderBy }, desc: true }]
        : undefined,
      dimensionFilter,
    },
  });
  return response.data;
}

if (command === "traffic") {
  // Daily traffic overview (optionally organic-only).
  const data = await runReport(
    ["date"],
    ["sessions", "totalUsers", "newUsers", "screenPageViews", "averageSessionDuration", "bounceRate"],
    undefined,
    organicOnly ? ORGANIC_FILTER : undefined,
  );

  const rows = (data.rows ?? []).map((row) => ({
    date: row.dimensionValues?.[0]?.value,
    sessions: Number(row.metricValues?.[0]?.value ?? 0),
    users: Number(row.metricValues?.[1]?.value ?? 0),
    new_users: Number(row.metricValues?.[2]?.value ?? 0),
    pageviews: Number(row.metricValues?.[3]?.value ?? 0),
    avg_session_sec: Number(row.metricValues?.[4]?.value ?? 0).toFixed(1),
    bounce_rate: (Number(row.metricValues?.[5]?.value ?? 0) * 100).toFixed(1) + "%",
  }));

  const totals = data.totals?.[0]?.metricValues;
  console.log(JSON.stringify({
    period: `${days} days`,
    totals: {
      sessions: Number(totals?.[0]?.value ?? 0),
      users: Number(totals?.[1]?.value ?? 0),
      new_users: Number(totals?.[2]?.value ?? 0),
      pageviews: Number(totals?.[3]?.value ?? 0),
    },
    daily: rows,
  }, null, 2));

} else if (command === "pages") {
  // Top pages by views — matches GA4 "Pages and screens" (views, active users,
  // views per active user).
  const data = await runReport(
    ["pagePath", "pageTitle"],
    ["screenPageViews", "activeUsers", "totalUsers", "screenPageViewsPerUser", "averageSessionDuration", "bounceRate"],
    "screenPageViews",
  );

  const rows = (data.rows ?? []).map((row) => ({
    path: row.dimensionValues?.[0]?.value,
    title: row.dimensionValues?.[1]?.value,
    pageviews: Number(row.metricValues?.[0]?.value ?? 0),
    active_users: Number(row.metricValues?.[1]?.value ?? 0),
    users: Number(row.metricValues?.[2]?.value ?? 0),
    views_per_user: Number(row.metricValues?.[3]?.value ?? 0).toFixed(2),
    avg_session_sec: Number(row.metricValues?.[4]?.value ?? 0).toFixed(1),
    bounce_rate: (Number(row.metricValues?.[5]?.value ?? 0) * 100).toFixed(1) + "%",
  }));

  console.log(JSON.stringify({ period: `${days} days`, top_pages: rows }, null, 2));

} else if (command === "sources") {
  // Traffic sources
  const data = await runReport(
    ["sessionSource", "sessionMedium"],
    ["sessions", "totalUsers", "screenPageViews", "averageSessionDuration"],
    "sessions",
  );

  const rows = (data.rows ?? []).map((row) => ({
    source: row.dimensionValues?.[0]?.value,
    medium: row.dimensionValues?.[1]?.value,
    sessions: Number(row.metricValues?.[0]?.value ?? 0),
    users: Number(row.metricValues?.[1]?.value ?? 0),
    pageviews: Number(row.metricValues?.[2]?.value ?? 0),
    avg_session_sec: Number(row.metricValues?.[3]?.value ?? 0).toFixed(1),
  }));

  console.log(JSON.stringify({ period: `${days} days`, sources: rows }, null, 2));

} else if (command === "geo") {
  // Location + engagement breakdown. --by city|country|region (default: city).
  // Reproduces GA4 "Demographic details": engagement time per user, events, etc.
  const dim = ["city", "country", "region"].includes(geoBy) ? geoBy : "city";
  const data = await runReport(
    [dim],
    ["activeUsers", "sessions", "screenPageViews", "userEngagementDuration", "engagedSessions", "engagementRate", "eventCount"],
    "activeUsers",
  );

  const rows = (data.rows ?? []).map((row) => {
    const activeUsers = Number(row.metricValues?.[0]?.value ?? 0);
    const engagementSec = Number(row.metricValues?.[3]?.value ?? 0);
    return {
      location: row.dimensionValues?.[0]?.value,
      active_users: activeUsers,
      sessions: Number(row.metricValues?.[1]?.value ?? 0),
      pageviews: Number(row.metricValues?.[2]?.value ?? 0),
      avg_engagement_sec_per_user: activeUsers > 0 ? Math.round(engagementSec / activeUsers) : 0,
      engaged_sessions: Number(row.metricValues?.[4]?.value ?? 0),
      engagement_rate: (Number(row.metricValues?.[5]?.value ?? 0) * 100).toFixed(1) + "%",
      event_count: Number(row.metricValues?.[6]?.value ?? 0),
    };
  });

  console.log(JSON.stringify({ period: `${days} days`, by: dim, locations: rows }, null, 2));

} else if (command === "conversions") {
  // Conversions + revenue split by channel → the "Organic Search" row is the
  // SEO-attributed business outcome. Optionally isolate one key event.
  const eventFilter = eventName
    ? { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: eventName } } }
    : undefined;
  const dimensionFilter = organicOnly
    ? eventFilter
      ? { andGroup: { expressions: [ORGANIC_FILTER, eventFilter] } }
      : ORGANIC_FILTER
    : eventFilter;

  let data: Awaited<ReturnType<typeof runReport>>;
  try {
    data = await runReport(
      ["sessionDefaultChannelGroup"],
      ["sessions", "conversions", "eventCount", "totalRevenue"],
      "conversions",
      dimensionFilter,
    );
  } catch (e) {
    console.error(`GA4 rejected the conversions query — the property may lack key events / ecommerce.`);
    console.error(String(e).slice(0, 300));
    process.exit(1);
  }

  const rows = (data.rows ?? []).map((row) => ({
    channel: row.dimensionValues?.[0]?.value,
    sessions: Number(row.metricValues?.[0]?.value ?? 0),
    conversions: Number(row.metricValues?.[1]?.value ?? 0),
    event_count: Number(row.metricValues?.[2]?.value ?? 0),
    revenue: Number(row.metricValues?.[3]?.value ?? 0),
  }));
  const organic = rows.find((r) => r.channel === "Organic Search") ?? null;

  console.log(JSON.stringify({
    period: `${days} days`,
    event: eventName || "(all key events)",
    organic_search: organic,
    by_channel: rows,
    note: rows.every((r) => r.conversions === 0 && r.revenue === 0)
      ? "All zero — GA4 likely has no key events / ecommerce configured for this property."
      : undefined,
  }, null, 2));

} else {
  console.error("Usage: ga4.ts <traffic|pages|sources|geo|conversions> [--days 30] [--limit 20] [--organic] [--event <name>] [--by city|country]");
  process.exit(1);
}
