#!/usr/bin/env sh
# Deterministic per-project scaffold for the seo-agent. Idempotent; POSIX sh,
# no dependencies — safe to run before `npm install`.
#
# Usage:
#   init.sh [KEY=VALUE ...] [--key=/path/to/service-account.json]
#
# What it does, always against the *git root* (never an app subdir):
#   1. creates .claude/seo/.env from the plugin's .env.example (if missing)
#   2. applies any KEY=VALUE args to that .env (uncommenting placeholders)
#   3. --key=... copies the service-account JSON in as service-account.json
#   4. ensures .claude/seo/ is git-ignored (the key is a secret)
#   5. prints what is still missing — this is the handoff to the human
#
# Vars can alternatively live in the project's root .env (lowest priority);
# the status report checks both.
set -eu

here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
plugin_root="$(dirname "$here")"

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
dir="$root/.claude/seo"
envfile="$dir/.env"

mkdir -p "$dir"

if [ ! -f "$envfile" ]; then
  cp "$plugin_root/.env.example" "$envfile"
  echo "created  $envfile"
else
  echo "exists   $envfile (left as-is)"
fi

# ── apply KEY=VALUE args and --key ──────────────────────────────────────────
keyfile=""
for arg in "$@"; do
  case "$arg" in
    --key=*) keyfile="${arg#--key=}" ;;
    [A-Z]*=*)
      k="${arg%%=*}" v="${arg#*=}"
      tmp="$envfile.tmp"
      # Replace the live line, else uncomment+replace the placeholder, else append.
      awk -v k="$k" -v v="$v" '
        !done && ($0 ~ "^"k"=" || $0 ~ "^# ?"k"=") { print k"="v; done=1; next }
        { print }
        END { if (!done) print k"="v }
      ' "$envfile" > "$tmp" && mv "$tmp" "$envfile"
      echo "set      $k"
      ;;
    *) echo "warning: ignoring unrecognized arg: $arg" >&2 ;;
  esac
done

if [ -n "$keyfile" ]; then
  cp "$keyfile" "$dir/service-account.json"
  chmod 600 "$dir/service-account.json"
  echo "copied   key -> .claude/seo/service-account.json"
fi

# ── git-ignore the secrets dir ──────────────────────────────────────────────
if git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$root" check-ignore -q "$envfile" 2>/dev/null; then
    echo "ignored  .claude/seo/ already git-ignored"
  else
    printf '\n# SEO agent config (service-account key + secrets)\n.claude/seo/\n' >> "$root/.gitignore"
    echo "added    .claude/seo/ to .gitignore"
  fi
fi

# ── status: what still needs a human ────────────────────────────────────────
# A var counts as set if it has a real (non-placeholder) value in .claude/seo/.env
# or in the project root .env.
val() {
  v="$(grep "^$1=" "$envfile" 2>/dev/null | tail -1 | cut -d= -f2-)"
  [ -z "$v" ] && [ -f "$root/.env" ] && v="$(grep "^$1=" "$root/.env" 2>/dev/null | tail -1 | cut -d= -f2-)"
  printf '%s' "$v"
}

echo
echo "status ($root):"
missing=0

# The key can be the conventional local file, an inline JSON value, or a
# GSC_SERVICE_ACCOUNT_KEY_FILE path (absolute, or relative to .claude/seo/).
kf="$(val GSC_SERVICE_ACCOUNT_KEY_FILE)"
case "$kf" in
  /*) keypath="$kf" ;;
  "") keypath="$dir/service-account.json" ;;
  *)  keypath="$dir/$kf" ;;
esac
if [ -f "$keypath" ] || [ -n "$(val GSC_SERVICE_ACCOUNT_KEY)" ]; then
  echo "  [ok]      service-account key ($keypath)"
else
  echo "  [MISSING] service-account key — expected at $keypath; rerun with --key=/path/to/key.json or GSC_SERVICE_ACCOUNT_KEY_FILE=/abs/path (see SETUP.md)"
  missing=1
fi

site="$(val GSC_SITE_URL)"
case "$site" in
  ""|*example.com*|*REPLACE*) echo "  [MISSING] GSC_SITE_URL — sc-domain:<domain> or https://<site>/ exactly as in Search Console"; missing=1 ;;
  *) echo "  [ok]      GSC_SITE_URL=$site" ;;
esac

ga4="$(val GA4_PROPERTY_ID)"
case "$ga4" in
  ""|*123456789*|*REPLACE*) echo "  [MISSING] GA4_PROPERTY_ID — properties/<number> from GA4 Admin -> Property Settings"; missing=1 ;;
  *) echo "  [ok]      GA4_PROPERTY_ID=$ga4" ;;
esac

d4s="$(val DATAFORSEO_LOGIN)"
case "$d4s" in
  ""|*REPLACE*) echo "  [--]      DataForSEO not set (optional — keyword/SERP research stays off)" ;;
  *) echo "  [ok]      DataForSEO ($d4s)" ;;
esac

echo
if [ "$missing" -eq 0 ]; then
  echo "all set — grant the service-account email access (GSC user + GA4 viewer), then verify:"
else
  echo "fill the missing values (rerun this script with KEY=VALUE args), then verify:"
fi
echo "  npx tsx \"$here/ping.ts\""

# Contract: exit 0 = config complete, 1 = values still missing.
exit "$missing"
