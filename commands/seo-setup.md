---
description: Set up seo-agent for this project — scaffold via init.sh, interview only for the gaps, verify
---

Configure the seo-agent for the **current project**. The deterministic work is a script; your job is only the judgment gaps and the two Google-UI grants the user must click. Read `${CLAUDE_PLUGIN_ROOT}/SETUP.md` before starting.

## 1. Scaffold (deterministic — run the script, don't do this by hand)

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/init.sh"
```

Always run it from the **repo root** (`git rev-parse --show-toplevel`); it anchors there itself, creates `.claude/seo/.env` from the example, git-ignores the dir, and prints a `[ok]/[MISSING]` status. Exit 0 means config is complete; exit 1 means values are missing — the status lines are your interview checklist. Vars already present in the project's root `.env` are honored too (lowest priority), so also check there before asking.

## 2. Interview — ask only for what init reported MISSING

Use the AskUserQuestion tool, one batch where possible:

1. **Service account** — reuse an existing key JSON (ask for the path) or create a new one:
   ```bash
   gcloud iam service-accounts create seo-agent --display-name "SEO Agent"
   gcloud services enable searchconsole.googleapis.com analyticsdata.googleapis.com --project <PROJECT_ID>
   gcloud iam service-accounts keys create seo-agent-key.json \
     --iam-account seo-agent@<PROJECT_ID>.iam.gserviceaccount.com
   ```
   (or the Console: https://console.cloud.google.com/iam-admin/serviceaccounts — create account, enable **Search Console API** + **Google Analytics Data API**, download a JSON key.)
2. **`GSC_SITE_URL`** — `sc-domain:<domain>` for a Domain property, `https://<site>/` for URL-prefix. Propose the repo's domain as the default; ask which property *type* they verified in Search Console.
3. **`GA4_PROPERTY_ID`** — `properties/<numeric id>` (GA4 Admin → Property Settings; NOT the `G-XXXX` measurement id).
4. **DataForSEO** (optional, pay-per-request) — if wanted: `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` from https://app.dataforseo.com/api-access (the *API* password).

## 3. Apply — rerun init.sh with the answers (never hand-edit)

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/init.sh" \
  GSC_SITE_URL=sc-domain:example.com \
  GA4_PROPERTY_ID=properties/123456789 \
  --key=/path/to/key.json
```

It is idempotent — rerun with more `KEY=VALUE` args until it exits 0.

## 4. Access grants (user does the clicks)

Print the service-account email (`client_email` in the key JSON) and wait for the user to confirm both:

- Search Console → Settings → Users and permissions → add it as **Full** (or Restricted) user.
- GA4 → Admin → Property Access Management → add it as **Viewer**.

## 5. Verify

```bash
npm install --prefix "${CLAUDE_PLUGIN_ROOT}/scripts"
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/ping.ts"
```

All configured integrations should report OK. If GSC/GA4 fail with a permissions error, the step-4 grants were missed or haven't propagated — re-check with the user rather than debugging the scripts. Finish by suggesting `/seo-analytics` for a first snapshot.
