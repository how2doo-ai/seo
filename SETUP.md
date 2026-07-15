# Setup — creating the service account ("the user") and configuring a project

The GA4 and Search Console scripts authenticate as a **Google Cloud service
account** — a non-human "user" with its own email and a private key, that you
grant read access to your Analytics property and Search Console site. You create
it **once** and can reuse the same key across every project; per project you just
grant that email access and point the project's `.env` at the key.

This is the part people forget. Here it is end to end.

---

## 1. Create the service account (the "user")

You need a Google Cloud **project** (any one will do — it's just the billing/API
container; the APIs used here are free). Then create the service account inside it.

### Option A — `gcloud` CLI (fastest)

```bash
# Pick or create a GCP project
gcloud projects create my-seo-project           # or reuse an existing one
PROJECT_ID=my-seo-project

# Create the service account — this is "the user"
gcloud iam service-accounts create seo-agent \
  --display-name "SEO Agent" \
  --project "$PROJECT_ID"

# Its email (you'll grant THIS access in GA4 + GSC):
#   seo-agent@<PROJECT_ID>.iam.gserviceaccount.com

# Enable the two APIs the scripts call
gcloud services enable searchconsole.googleapis.com analyticsdata.googleapis.com \
  --project "$PROJECT_ID"

# Create and download a JSON key
gcloud iam service-accounts keys create service-account.json \
  --iam-account "seo-agent@${PROJECT_ID}.iam.gserviceaccount.com"
```

`service-account.json` is the secret. Keep it out of git.

### Option B — Google Cloud Console (clicks)

1. https://console.cloud.google.com/iam-admin/serviceaccounts → pick/create a project → **Create service account**. Name it `seo-agent`. Skip the optional role grants (it doesn't need project IAM roles — access is granted inside GA4/GSC instead). Create.
2. Open the new account → **Keys** → **Add key → Create new key → JSON** → download. That's your `service-account.json`.
3. Enable the APIs: **APIs & Services → Enable APIs and services**, enable **Google Search Console API** and **Google Analytics Data API**. (Or visit the API pages directly and click Enable.)

Either way you end up with: a key JSON file, and a service-account **email** that looks like `seo-agent@<project>.iam.gserviceaccount.com`. The email is also inside the JSON as `client_email`.

---

## 2. Grant that email access to your data

The service account can't see anything until you invite its email — exactly like
sharing with a person.

**Search Console** (https://search.google.com/search-console)
- Settings → **Users and permissions** → **Add user**
- Paste the service-account email, permission **Full** (or Restricted — read is enough for reporting).

**Google Analytics 4** (https://analytics.google.com)
- Admin (gear) → under the **Property** column → **Property Access Management**
- **+** → add the service-account email with role **Viewer**.

---

## 3. Find the two identifiers the scripts need

- **`GSC_SITE_URL`** — must match the property *exactly* as it appears in Search
  Console. A **Domain** property is `sc-domain:example.com`. A **URL-prefix**
  property is the full origin with trailing slash, e.g. `https://example.com/`.
- **`GA4_PROPERTY_ID`** — GA4 Admin → **Property Settings** → **Property ID**
  (a number like `529789574`). In config it's `properties/529789574`. Note: this
  is the numeric Property ID, **not** the `G-XXXXXXX` measurement/tag id you put
  on the site.

---

## 4. Write the project config

In the project you want to analyze:

```bash
mkdir -p .claude/seo
cp <plugin>/.env.example .claude/seo/.env
mv service-account.json .claude/seo/service-account.json
```

Edit `.claude/seo/.env`:

```
GSC_SERVICE_ACCOUNT_KEY_FILE=service-account.json
GSC_SITE_URL=https://example.com/
GA4_PROPERTY_ID=properties/123456789
# optional: DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD, SEO_STRONG_DOMAINS, ...
```

Make sure the key and env are git-ignored. The conventional way:

```
echo ".claude/seo/" >> .gitignore
```

---

## 5. Verify

```bash
npm install --prefix <plugin>/scripts        # one time per plugin install
npx tsx <plugin>/scripts/ping.ts
```

You should see `OK` for GSC and GA4 (and DataForSEO if you set its creds). A
`FAIL` with `403` almost always means step 2 was skipped or the email/property
doesn't match; a `404` on GSC usually means `GSC_SITE_URL` doesn't exactly match
the property string.

---

## DataForSEO (optional — research scripts)

GA4/GSC cover *your* site's data. The research scripts (`keyword-research.ts`,
`serp-analyze.ts`, `competitors.ts`, `trends.ts`, `backlinks.ts`, `score.ts`)
query the wider market through **DataForSEO**, which needs its own credentials:

1. Register at https://app.dataforseo.com — new accounts come with a small
   trial credit, enough to try every script before paying.
2. Open **API Access**: https://app.dataforseo.com/api-access
3. Copy the two values into `.env`:
   - `DATAFORSEO_LOGIN` — your account email
   - `DATAFORSEO_PASSWORD` — the **generated API password shown on that page**.
     This is *not* the password you log in to the dashboard with — using that
     one is the most common cause of `401` from these scripts.

Cost model: pay-per-request (fractions of a cent for keyword data, more for
live SERPs). Two built-in guards keep spend low:

- **Response cache** — identical requests within `SEO_CACHE_TTL` (default 7
  days) are served from disk, free. Leave it on.
- Top up manually (no auto-billing by default), so a runaway loop can't spend
  more than your balance.

Re-run `ping.ts` after adding the creds — it should now print `OK` for
DataForSEO too.

---

## Reusing across projects

The service account is global. For each new project: grant its email access to
that project's GSC + GA4 (step 2), then create that project's `.claude/seo/.env`
pointing at the same key JSON (or paste the key inline). No new service account
needed.

With 2+ projects, prefer **one canonical key outside any repo** over per-repo
copies — fewer secret copies on disk, one file to rotate:

```bash
mkdir -p ~/.config/seo-agent
cp <key>.json ~/.config/seo-agent/service-account.json
chmod 600 ~/.config/seo-agent/service-account.json
```

Machine-wide values (the key path, DataForSEO credentials — anything that is
the same for every project) go in the **user-global env**,
`~/.config/seo-agent/.env` (`chmod 600` it), which every project inherits as
the lowest-priority layer:

```bash
# ~/.config/seo-agent/.env
GSC_SERVICE_ACCOUNT_KEY_FILE=/Users/you/.config/seo-agent/service-account.json
DATAFORSEO_LOGIN=you@example.com
DATAFORSEO_PASSWORD=api-password
```

Per-project `.claude/seo/.env` then holds only what is actually per-site
(`GSC_SITE_URL`, `GA4_PROPERTY_ID`, niche tuning) and can override any global
value. Full priority: shell/CI env > `.claude/seo/.env` > project root `.env` >
`~/.config/seo-agent/.env`.

Teams: don't share one key file between people. A service account can hold
multiple keys — each person creates their own (step 1's `keys create`), so one
person's key can be revoked without rotating everyone.
