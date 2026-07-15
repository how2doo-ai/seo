---
description: Keyword research — expand seeds into volumes, difficulty, and intent (DataForSEO)
---

Run keyword research for the current project. Requires DataForSEO credentials (`/seo-setup` if `ping.ts` shows them missing). This spends API credits — identical re-runs are cached and free.

1. Seeds: `$ARGUMENTS` if given; otherwise pull the project's top real queries first: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/google/gsc.ts" queries --days 28 --limit 10`.
2. Expand each seed: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/dataforseo/keyword-research.ts" "<seed>" --suggestions --limit 30`.
3. For the most promising candidates, add seasonality: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/dataforseo/historical-volume.ts" "<kw1>" "<kw2>" ...`.
4. Report a ranked table: keyword, monthly volume, difficulty, intent, seasonal peak. Flag keywords the site already ranks for (from step 1) separately — those are optimization targets, not new content.
5. Save the report to `agents-info/seo/keyword-reports/YYYY-MM-DD-<topic>.md` in the project.

For full opportunity *prioritization* (demand/competition/timing gates), suggest `/seo-opportunities` as the follow-up.
