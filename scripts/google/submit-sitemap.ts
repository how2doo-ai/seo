#!/usr/bin/env npx tsx
/**
 * Submit a sitemap to Google Search Console.
 *
 * Usage:
 *   npx tsx scripts/submit-sitemap.ts                       # <site>/sitemap.xml
 *   npx tsx scripts/submit-sitemap.ts https://x.com/sitemap_index.xml
 *
 * The sitemap URL defaults to GSC_SITEMAP_URL, else <site origin>/sitemap.xml
 * derived from GSC_SITE_URL (handles both https:// and sc-domain: forms).
 */

import { env, serviceAccountKey as getServiceAccountKey } from "../lib/env.js";

const serviceAccountKey = getServiceAccountKey();
const siteUrl = env.GSC_SITE_URL;

if (!serviceAccountKey) {
  console.error("Error: GSC_SERVICE_ACCOUNT_KEY or GSC_SERVICE_ACCOUNT_KEY_FILE required");
  process.exit(1);
}
if (!siteUrl) {
  console.error("Error: GSC_SITE_URL required");
  process.exit(1);
}

/** Derive an https origin from either a URL-prefix or sc-domain: property. */
function siteOrigin(site: string): string {
  if (site.startsWith("sc-domain:")) return `https://${site.slice("sc-domain:".length)}`;
  return site.replace(/\/+$/, "");
}

const sitemapUrl =
  process.argv[2] || env.GSC_SITEMAP_URL || `${siteOrigin(siteUrl)}/sitemap.xml`;

const { google } = await import("googleapis");

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(serviceAccountKey),
  // webmasters scope (without .readonly) allows sitemap submission
  scopes: ["https://www.googleapis.com/auth/webmasters"],
});

const searchconsole = google.searchconsole({ version: "v1", auth });

console.log(`Submitting sitemap: ${sitemapUrl}`);
console.log(`Site: ${siteUrl}`);

try {
  const response = await searchconsole.sitemaps.submit({
    siteUrl,
    feedpath: sitemapUrl,
  });

  console.log(`HTTP status: ${response.status}`);
  if (response.status === 204 || response.status === 200) {
    console.log("Sitemap submitted successfully.");
  } else {
    console.log("Unexpected response:", JSON.stringify(response.data, null, 2));
  }
} catch (err: unknown) {
  const e = err as { status?: number; message?: string; errors?: unknown[] };
  console.error("Submission failed:", e.message ?? String(err));
  if (e.errors) {
    console.error("Errors:", JSON.stringify(e.errors, null, 2));
  }
  process.exit(1);
}

// Also fetch current sitemap status to confirm
try {
  const status = await searchconsole.sitemaps.get({
    siteUrl,
    feedpath: sitemapUrl,
  });
  console.log("\nSitemap status after submission:");
  console.log(JSON.stringify(status.data, null, 2));
} catch {
  // Status fetch may fail if GSC hasn't processed yet — not critical
  console.log("\n(Sitemap status not yet available — GSC may still be processing)");
}
