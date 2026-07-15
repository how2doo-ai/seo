#!/usr/bin/env npx tsx
/**
 * Ping all SEO agent integrations to verify connectivity.
 *
 * Usage:
 *   npx tsx scripts/ping.ts
 */

import { dataforseoGet } from "./lib/dataforseo.js";
import { env, serviceAccountKey as getServiceAccountKey } from "./lib/env.js";

const serviceAccountKey = getServiceAccountKey();

interface PingResult {
  service: string;
  status: "ok" | "fail" | "skip";
  detail?: string;
  ms?: number;
}

const results: PingResult[] = [];

// 1. DataForSEO
async function pingDataForSEO(): Promise<PingResult> {
  const start = Date.now();
  try {
    const res = await dataforseoGet<{ money?: { balance?: number } }>("/appendix/user_data");
    const money = res.tasks?.[0]?.result?.[0]?.money;
    return {
      service: "DataForSEO",
      status: "ok",
      detail: `balance: $${money?.balance?.toFixed(2) ?? "?"}`,
      ms: Date.now() - start,
    };
  } catch (e) {
    return { service: "DataForSEO", status: "fail", detail: String(e), ms: Date.now() - start };
  }
}

// 2. GSC
async function pingGSC(): Promise<PingResult> {
  if (!serviceAccountKey || !env.GSC_SITE_URL) {
    return { service: "GSC", status: "skip", detail: "GSC_SERVICE_ACCOUNT_KEY or GSC_SITE_URL not set" };
  }
  const start = Date.now();
  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(serviceAccountKey),
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    });
    const searchconsole = google.searchconsole({ version: "v1", auth });
    const res = await searchconsole.sites.get({ siteUrl: env.GSC_SITE_URL });
    return {
      service: "GSC",
      status: "ok",
      detail: `site: ${res.data.siteUrl}, level: ${res.data.permissionLevel}`,
      ms: Date.now() - start,
    };
  } catch (e) {
    return { service: "GSC", status: "fail", detail: String(e).slice(0, 200), ms: Date.now() - start };
  }
}

// 3. GA4
async function pingGA4(): Promise<PingResult> {
  if (!serviceAccountKey || !env.GA4_PROPERTY_ID) {
    return { service: "GA4", status: "skip", detail: "GSC_SERVICE_ACCOUNT_KEY or GA4_PROPERTY_ID not set" };
  }
  const start = Date.now();
  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(serviceAccountKey),
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    const analyticsData = google.analyticsdata({ version: "v1beta", auth });
    const res = await analyticsData.properties.runReport({
      property: env.GA4_PROPERTY_ID,
      requestBody: {
        dateRanges: [{ startDate: "1daysAgo", endDate: "today" }],
        metrics: [{ name: "sessions" }],
        limit: 1,
      },
    });
    const sessions = res.data.totals?.[0]?.metricValues?.[0]?.value ?? "0";
    return {
      service: "GA4",
      status: "ok",
      detail: `property: ${env.GA4_PROPERTY_ID}, sessions (24h): ${sessions}`,
      ms: Date.now() - start,
    };
  } catch (e) {
    return { service: "GA4", status: "fail", detail: String(e).slice(0, 200), ms: Date.now() - start };
  }
}

// 4. SEO API
async function pingSeoAPI(): Promise<PingResult> {
  if (!env.SEO_API_URL) {
    return { service: "SEO API", status: "skip", detail: "SEO_API_URL not set" };
  }
  const start = Date.now();
  try {
    const headers: Record<string, string> = {};
    if (env.SEO_API_TOKEN) headers.Authorization = `Bearer ${env.SEO_API_TOKEN}`;
    const res = await fetch(`${env.SEO_API_URL}/health`, { headers });
    const data = await res.json() as Record<string, string>;
    return {
      service: "SEO API",
      status: res.ok ? "ok" : "fail",
      detail: `${res.status} ${data.status ?? ""}`,
      ms: Date.now() - start,
    };
  } catch (e) {
    return { service: "SEO API", status: "fail", detail: String(e).slice(0, 200), ms: Date.now() - start };
  }
}

// Run all in parallel
const [d4seo, gsc, ga4, seoApi] = await Promise.all([
  pingDataForSEO(),
  pingGSC(),
  pingGA4(),
  pingSeoAPI(),
]);

results.push(d4seo, gsc, ga4, seoApi);

// Print results
console.log("\n  SEO Agent — Integration Status\n");
for (const r of results) {
  const icon = r.status === "ok" ? "OK" : r.status === "skip" ? "--" : "FAIL";
  const time = r.ms ? ` (${r.ms}ms)` : "";
  console.log(`  [${icon}]  ${r.service}${time}`);
  if (r.detail) console.log(`        ${r.detail}`);
}

const failed = results.filter((r) => r.status === "fail");
console.log("");
if (failed.length > 0) {
  console.log(`  ${failed.length} integration(s) failed.`);
  process.exit(1);
} else {
  console.log("  All integrations healthy.");
}
