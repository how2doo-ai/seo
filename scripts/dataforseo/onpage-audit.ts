#!/usr/bin/env npx tsx
/**
 * On-Page Technical SEO Audit — crawl a site and report issues.
 *
 * Usage:
 *   npx tsx scripts/onpage-audit.ts "https://starogram.com"
 *   npx tsx scripts/onpage-audit.ts "https://starogram.com" --limit 100
 *
 * Note: This is a two-step process (POST task, then GET results).
 * The script polls until results are ready (max 5 minutes).
 */

import { dataforseoPost, dataforseoGet, parseArgs, printJson, printError } from "../lib/dataforseo.js";

interface TaskPostResult {
  id: string;
}

interface OnPageSummary {
  crawl_progress: string;
  crawl_status: {
    pages_in_queue: number;
    pages_crawled: number;
  };
  pages_count: number;
  page_metrics: {
    checks: Record<string, number>;
    onpage_score: number;
  };
}

interface OnPagePage {
  url: string;
  status_code: number;
  meta: {
    title: string;
    description: string;
    canonical: string;
    htags: Record<string, string[]>;
  };
  onpage_score: number;
  checks: Record<string, boolean>;
  page_timing: {
    time_to_interactive: number;
    dom_complete: number;
    largest_contentful_paint: number;
    first_input_delay: number;
    cumulative_layout_shift: number;
  };
  total_dom_size: number;
  content: {
    plain_text_word_count: number;
    automated_readability_index: number;
  };
}

interface OnPagePagesResult {
  items_count: number;
  items: OnPagePage[] | null;
}

const { positional: urls, limit } = parseArgs(process.argv.slice(2));

if (urls.length === 0) {
  printError("Usage: onpage-audit.ts <url> [--limit 100]");
}

const targetUrl = urls[0];

// Step 1: Create crawl task
console.error("Starting crawl...");
const taskRes = await dataforseoPost<TaskPostResult>(
  "/on_page/task_post",
  [
    {
      target: targetUrl,
      max_crawl_pages: limit > 0 ? limit : 100,
      load_resources: true,
      enable_javascript: true,
      enable_browser_rendering: true,
      store_raw_html: false,
    },
  ],
  { useCache: false }, // stateful: each run must launch a fresh crawl
);

const taskId = taskRes.tasks[0]?.id;
if (!taskId) {
  printError(`Failed to create crawl task: ${taskRes.tasks[0]?.status_message}`);
}

// Step 2: Poll for completion (max 5 min)
const MAX_WAIT = 300_000;
const POLL_INTERVAL = 10_000;
let elapsed = 0;

while (elapsed < MAX_WAIT) {
  await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  elapsed += POLL_INTERVAL;

  const summaryRes = await dataforseoGet<OnPageSummary>(`/on_page/summary/${taskId}`, { useCache: false });
  const summary = summaryRes.tasks[0]?.result?.[0];

  if (!summary) continue;

  console.error(`Crawl progress: ${summary.crawl_status.pages_crawled} pages crawled`);

  if (summary.crawl_progress === "finished") {
    // Step 3: Get page-level results
    const pagesRes = await dataforseoPost<OnPagePagesResult>(
      "/on_page/pages",
      [
        {
          id: taskId,
          limit: 100,
          order_by: ["onpage_score,asc"], // worst pages first
        },
      ],
      { useCache: false }, // keyed to a per-run crawl id — caching is moot
    );

    const pages = (pagesRes.tasks[0]?.result?.[0]?.items ?? []).map((page) => ({
      url: page.url,
      status_code: page.status_code,
      score: page.onpage_score,
      title: page.meta?.title,
      description: page.meta?.description?.slice(0, 200),
      canonical: page.meta?.canonical,
      h1_count: page.meta?.htags?.h1?.length ?? 0,
      word_count: page.content?.plain_text_word_count ?? 0,
      dom_size: page.total_dom_size,
      timing: page.page_timing
        ? {
            tti: page.page_timing.time_to_interactive,
            lcp: page.page_timing.largest_contentful_paint,
            cls: page.page_timing.cumulative_layout_shift,
          }
        : null,
      issues: Object.entries(page.checks ?? {})
        .filter(([, v]) => v === false)
        .map(([k]) => k),
    }));

    printJson({
      target: targetUrl,
      summary: {
        pages_crawled: summary.crawl_status.pages_crawled,
        onpage_score: summary.page_metrics?.onpage_score,
        checks: summary.page_metrics?.checks,
      },
      pages,
      cost: (taskRes.tasks[0]?.cost ?? 0) + (pagesRes.tasks[0]?.cost ?? 0),
    });

    process.exit(0);
  }
}

printError("Crawl timed out after 5 minutes. Try again or reduce --limit.");
