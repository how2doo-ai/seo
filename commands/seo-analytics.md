---
description: Quick traffic + search snapshot (GA4 + Search Console) for this project
---

Produce a concise analytics snapshot for the current project using the seo-agent scripts. Steps:

1. Confirm config exists (`.claude/seo/.env`, or `$SEO_AGENT_ENV`). If missing, stop and point the user to `/seo-setup`.
2. If this is the first run, ensure deps: `npm install --prefix "${CLAUDE_PLUGIN_ROOT}/scripts"`.
3. Run, in parallel where possible:
   - `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/google/ga4.ts" traffic --days 28 --prev` (overall, period-over-period)
   - `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/google/ga4.ts" traffic --organic --days 28` (organic only)
   - `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/google/ga4.ts" pages --days 28 --limit 15`
   - `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/google/gsc.ts" queries --days 28 --limit 20`
   - `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/google/gsc.ts" pages --days 28 --limit 15`
4. Summarize: total vs organic sessions and the period-over-period delta; top pages; top queries with CTR vs position (flag queries ranking well with low CTR — title/meta opportunities); anything notably up or down.

Keep it tight and data-led. Cite the actual numbers. $ARGUMENTS may override the window (e.g. "--days 7").
