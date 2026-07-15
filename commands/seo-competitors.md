---
description: Competitor audit — discover organic rivals, compare domains, find link/content gaps (DataForSEO)
---

Audit the competitive landscape for the current project's domain (from `GSC_SITE_URL`). Requires DataForSEO credentials. This spends API credits — identical re-runs are cached and free.

1. Targets: `$ARGUMENTS` if given (specific rival domains); otherwise discover them: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/dataforseo/competitors.ts" "<own-domain>" --discover`.
2. Compare the top 3–5 rivals against the project's domain: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/dataforseo/competitors.ts" "<own-domain>" "<rival1>" "<rival2>" ...`.
3. Backlink profiles of the strongest rivals: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/dataforseo/backlinks.ts" "<rival>"`.
4. Report: who actually competes in organic (not who the user *thinks* competes), keyword overlap and gaps (keywords rivals rank for that the project doesn't), authority gap from backlinks, and 3–5 concrete moves.
5. Save to `agents-info/seo/competitor-reports/YYYY-MM-DD.md` and suggest adding confirmed rivals to `SEO_STRONG_DOMAINS` so `/seo-opportunities` scoring respects them.
