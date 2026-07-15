# seo-agent

An autonomous **SEO agent for Claude Code**, packaged as a plugin. It bundles a
subagent plus a set of analysis scripts:

- **Analytics & search** — Google Analytics 4 (`ga4.ts`) and Google Search
  Console (`gsc.ts`), authenticated by one Google **service account**.
- **Market research** — DataForSEO scripts for keyword research, SERP analysis,
  seasonal volume, backlinks, on-page audits, competitor comparison, and a
  seasonal **opportunity scorer** (`score.ts`).

It's **niche-agnostic**: install it once, and each project supplies its own
config (site, GA4 property, credentials, and which competitor domains count as
"strong") in `.claude/seo/.env`. Nothing is hardcoded to a particular site.

## Install

As a Claude Code plugin, from the how2doo marketplace:

```
/plugin marketplace add how2doo-ai/agents
/plugin install seo
```

Or clone and run the scripts directly:

```bash
git clone https://github.com/how2doo-ai/seo
npm install --prefix seo/scripts
```

## Configure

Each project gets its own `.claude/seo/.env` plus a service-account key. The
service account is the one thing that needs creating once — see **[SETUP.md](SETUP.md)**
for the full walkthrough (create the account, enable the APIs, grant it access
to your GA4 property and GSC site, find the property id). Scaffold and fill the
config with the init script (idempotent; anchors at the git root; exit 0 = complete):

```bash
sh scripts/init.sh \
  GSC_SITE_URL=sc-domain:example.com \
  GA4_PROPERTY_ID=properties/123456789 \
  --key=/path/to/service-account-key.json
npx tsx scripts/ping.ts    # verify all configured integrations
```

Prefer one file? The loader also honors SEO vars in your project's root `.env`,
and machine-wide secrets (DataForSEO creds, the key path) can live once in the
user-global `~/.config/seo-agent/.env` instead of being copied into every repo.
Priority: shell env > `.claude/seo/.env` > root `.env` > global.

In Claude Code, run `/seo-setup` to be walked through it, and `/seo-analytics`
for a quick traffic + search snapshot. Or just ask the **seo** agent for keyword
opportunities, a competitor audit, or a performance review.

## What needs paying for

- **GA4 + Search Console**: free. Only need the service account.
- **DataForSEO**: pay-per-request (cached locally to avoid re-billing). Optional —
  the analytics half works without it.

## Layout

```
.claude-plugin/       plugin.json + marketplace.json
agents/seo.md         the subagent
commands/             /seo-setup, /seo-analytics, /seo-keywords,
                      /seo-competitors, /seo-opportunities
scripts/
  init.sh, ping.ts    per-project scaffold (init → verify contract)
  lib/                env loader, DataForSEO client, scoring config
  google/             ga4, gsc, submit-sitemap (service account)
  dataforseo/         keyword-research, serp-analyze, competitors,
                      backlinks, historical-volume, onpage-audit,
                      trends, score (opportunity scorer)
.env.example          copy to <project>/.claude/seo/.env
SETUP.md              service-account + per-project setup
```

## License

MIT — see [LICENSE](LICENSE).
