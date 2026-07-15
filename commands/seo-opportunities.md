---
description: Ranked content opportunities — demand/competition/timing-scored keywords (DataForSEO + GSC)
---

Produce a ranked, seasonally-timed list of content opportunities for the current project. Requires DataForSEO credentials. This is the most API-hungry command (~several requests per keyword; cached re-runs free) — with more than ~20 candidates, confirm with the user before scoring.

1. Gather candidates: `$ARGUMENTS` if given; otherwise seed from reality — `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/google/gsc.ts" queries --days 28 --limit 15`, expanded via `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/dataforseo/keyword-research.ts" "<top-seed>" --suggestions --limit 30`.
2. Score them: `npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/dataforseo/score.ts" "<kw1>" "<kw2>" ...` — composes Demand (volume gate), Competition (AI Overview + strong-domain top-3), and seasonal timing (peaks landing in the 2–8-week publish-to-rank window score highest). Results land in `agents-info/seo/scored/`.
3. Report the PASSes ranked by score with the gate breakdown per keyword (why it passed, when its peak is), then FAILs worth revisiting off-season.
4. For each top PASS, propose the concrete content move (new page vs optimize existing — check `gsc.ts query-pages "<kw>"` to see if the site already half-ranks).

Tuning knobs live in `SEO_*` env vars (`SEO_STRONG_DOMAINS`, `SEO_DEMAND_MIN_VOLUME`, `SEO_TIMING_*`) — see `.env.example`.
