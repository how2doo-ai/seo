#!/usr/bin/env npx tsx
/**
 * Backlinks Analysis — get backlink profile summary and top links.
 *
 * Usage:
 *   npx tsx scripts/backlinks.ts "starogram.com"
 *   npx tsx scripts/backlinks.ts "starogram.com" --limit 50
 */

import { dataforseoPost, firstTask, parseArgs, printJson, printError } from "../lib/dataforseo.js";

interface BacklinksSummary {
  target: string;
  total_backlinks: number;
  total_referring_domains: number;
  nofollow: number;
  dofollow: number;
  broken_backlinks: number;
  referring_domains_nofollow: number;
  referring_ips: number;
  referring_subnets: number;
  backlinks_spam_score: number;
  rank: number;
}

interface BacklinkItem {
  type: string;
  domain_from: string;
  url_from: string;
  url_to: string;
  anchor: string;
  is_new: boolean;
  is_lost: boolean;
  dofollow: boolean;
  page_from_rank: number;
  domain_from_rank: number;
  first_seen: string;
  last_seen: string;
}

interface BacklinksResult {
  total_count: number;
  items_count: number;
  items: BacklinkItem[] | null;
}

const { positional: targets, limit } = parseArgs(process.argv.slice(2));

if (targets.length === 0) {
  printError("Usage: backlinks.ts <domain> [--limit 20]");
}

const target = targets[0];

// Fetch summary and top backlinks in parallel
const [summaryRes, backlinksRes] = await Promise.all([
  dataforseoPost<BacklinksSummary>("/backlinks/summary/live", [
    { target, internal_list_limit: 0 },
  ]),
  dataforseoPost<BacklinksResult>("/backlinks/backlinks/live", [
    {
      target,
      limit,
      order_by: ["rank:desc"],
      mode: "as_is",
    },
  ]),
]);

const summaryTask = firstTask(summaryRes);
const backlinksTask = firstTask(backlinksRes);
const summary = summaryTask.result;
const backlinks = backlinksTask.result;

const topLinks = (backlinks?.items ?? []).map((item) => ({
  from_domain: item.domain_from,
  from_url: item.url_from,
  to_url: item.url_to,
  anchor: item.anchor,
  dofollow: item.dofollow,
  domain_rank: item.domain_from_rank,
  first_seen: item.first_seen,
}));

printJson({
  target,
  summary: summary
    ? {
        total_backlinks: summary.total_backlinks,
        referring_domains: summary.total_referring_domains,
        dofollow: summary.dofollow,
        nofollow: summary.nofollow,
        broken: summary.broken_backlinks,
        spam_score: summary.backlinks_spam_score,
        rank: summary.rank,
      }
    : null,
  top_backlinks: topLinks,
  cost: summaryTask.cost + backlinksTask.cost,
});
