---
description: Set up seo-agent for this project — interview for config, create the service account, write .env, verify
---

Walk the user through configuring the seo-agent for the **current project**. Be concrete and do the file/CLI work for them where you can; only the Google Cloud Console clicks and the GA4/GSC access grants must be done by the user. Read `${CLAUDE_PLUGIN_ROOT}/SETUP.md` for the full walkthrough before starting.

**Config location is the repo root**: `$(git rev-parse --show-toplevel)/.claude/seo/.env`. The scripts resolve `.claude/seo/.env` against the cwd they run from, which is the session's repo root — in a monorepo, never place it under an app/package subdirectory. Use absolute paths for every file you create in this flow.

## 1. Detect current state

- Read `<repo-root>/.claude/seo/.env` if it exists, and `${CLAUDE_PLUGIN_ROOT}/.env.example` for the full variable list. Also scan for stray copies (`git ls-files --others --ignored --exclude-standard '*/.claude/seo/*'` or a quick find) — if config exists somewhere other than the root, move it up and delete the stray (it may hold a key).
- Look for a reusable service-account key: check sibling projects the user mentions, or an existing `service-account.json` under `.claude/seo/` anywhere they point you.
- Tell the user in one line what is already configured and what is missing, then only ask about the gaps.

## 2. Interview — ask, don't lecture

Use the AskUserQuestion tool for each missing value (one batch where possible). Collect:

1. **Service account** — reuse an existing key JSON, or create a new one?
   - *Reuse*: ask for the path to the key JSON. They only need to grant that account's email access to THIS project's GSC + GA4 (step 3).
   - *Create*: offer to run these (substituting their GCP project id), or point them at the Console (https://console.cloud.google.com/iam-admin/serviceaccounts):
     ```bash
     gcloud iam service-accounts create seo-agent --display-name "SEO Agent"
     gcloud services enable searchconsole.googleapis.com analyticsdata.googleapis.com --project <PROJECT_ID>
     gcloud iam service-accounts keys create seo-agent-key.json \
       --iam-account seo-agent@<PROJECT_ID>.iam.gserviceaccount.com
     ```
2. **`GSC_SITE_URL`** — the exact Search Console property: `https://example.com/` or `sc-domain:example.com`. If the project's domain is obvious from the repo, propose it as the default option.
3. **`GA4_PROPERTY_ID`** — `properties/<numeric id>` (GA4 Admin → Property Settings → Property ID).
4. **DataForSEO** (optional — keyword/SERP research, pay-per-request): do they want it now? If yes, ask for `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`. If no, skip — the analytics half works without it.
5. **Niche tuning** (optional): `SEO_STRONG_DOMAINS` — competitor domains that count as "strong" in scoring. Fine to leave for later.

## 3. Access grants (user does the clicks)

Give them the service-account email (`seo-agent@<project>.iam.gserviceaccount.com`) and wait until they confirm both:

- Search Console → Settings → Users and permissions → add it as **Full** (or Restricted) user.
- GA4 → Admin → Property Access Management → add it as **Viewer**.

## 4. Write the config

- Create `.claude/seo/.env` from `${CLAUDE_PLUGIN_ROOT}/.env.example`, filled with the interview answers.
- Copy the key JSON to `.claude/seo/service-account.json` and set `GSC_SERVICE_ACCOUNT_KEY_FILE=service-account.json`.
- Ensure `.claude/seo/` is git-ignored (the key and any DataForSEO password are secrets) — add the ignore rule yourself if missing.

## 5. Verify

```bash
npm install --prefix "${CLAUDE_PLUGIN_ROOT}/scripts"
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/ping.ts"
```

All configured integrations should report OK. If GSC/GA4 fail with a permissions error, the access grants from step 3 haven't propagated or were missed — re-check them with the user rather than debugging the scripts. Finish by suggesting `/seo-analytics` for a first snapshot.
