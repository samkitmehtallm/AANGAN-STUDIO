#!/usr/bin/env bash
#
# One-command deploy to Vercel.
#
# Everything here is scripted. The only thing it cannot do for you is the
# Vercel login, which opens a browser and is yours to complete - a deploy
# credential has to come from the account holder.
#
#   bash scripts/deploy.sh
#
# It is safe to run more than once. It links to the existing project rather
# than creating a new one, and it upserts environment variables rather than
# duplicating them.

set -euo pipefail
cd "$(dirname "$0")/.."

# This machine has no system Node; the project installed one locally.
if ! command -v node >/dev/null 2>&1; then
  LOCAL_NODE="$HOME/.local/node/node-v22.20.0-darwin-x64/bin"
  if [ -d "$LOCAL_NODE" ]; then
    export PATH="$LOCAL_NODE:$PATH"
  else
    echo "Node is not installed and the local copy is missing." >&2
    echo "Install Node 20.9+ and run this again." >&2
    exit 1
  fi
fi

PROJECT="aangan-enquiry-system"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- 1. env
say "1/5  Checking .env.local"

if [ ! -f .env.local ]; then
  echo "  .env.local is missing. Copy .env.example and fill it in first." >&2
  exit 1
fi

missing=()
needed=(NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY VAANI_WEBHOOK_SECRET
        CLAIM_LINK_SECRET CRON_SECRET DASHBOARD_PASSWORD)
for key in "${needed[@]}"; do
  value=$(grep -E "^${key}=" .env.local | head -1 | cut -d= -f2- || true)
  if [ -z "$value" ] || [[ "$value" == PASTE_* ]]; then
    missing+=("$key")
  fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "  These still need real values in .env.local:" >&2
  printf '    %s\n' "${missing[@]}" >&2
  echo >&2
  echo "  SUPABASE_SERVICE_ROLE_KEY is at:" >&2
  echo "    supabase.com -> aangan-enquiry-system -> Settings -> API -> service_role" >&2
  exit 1
fi
echo "  All required variables are set."

# ---------------------------------------------------------------- 2. login
say "2/5  Vercel login"
if npx --yes vercel@latest whoami >/dev/null 2>&1; then
  echo "  Already signed in as $(npx --yes vercel@latest whoami 2>/dev/null)."
else
  echo "  A browser window will open. Sign in with the account that owns"
  echo "  the $PROJECT project, then come back here."
  npx --yes vercel@latest login
fi

# ---------------------------------------------------------------- 3. link
say "3/5  Linking to the existing project (not creating a new one)"
npx --yes vercel@latest link --yes --project "$PROJECT" >/dev/null
echo "  Linked to $PROJECT."

# ---------------------------------------------------------------- 4. env push
say "4/5  Pushing environment variables to production"

push_env() {
  local key="$1" value="$2"
  [ -z "$value" ] && return 0
  # Remove any existing value first so this is idempotent rather than additive.
  npx --yes vercel@latest env rm "$key" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | npx --yes vercel@latest env add "$key" production >/dev/null 2>&1
  echo "  set $key"
}

# Read .env.local without sourcing it, so a stray character cannot execute.
while IFS= read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  key="${line%%=*}"
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  case "$key" in
    APP_BASE_URL) continue ;;        # set from the real deployment URL below
    *) push_env "$key" "$value" ;;
  esac
done < .env.local

# ---------------------------------------------------------------- 5. deploy
say "5/5  Building and deploying to production"
URL=$(npx --yes vercel@latest deploy --prod --yes 2>&1 | tee /dev/stderr | grep -Eo 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1)

if [ -z "${URL:-}" ]; then
  echo "Deploy finished but no URL was captured. Check the output above." >&2
  exit 1
fi

# APP_BASE_URL has to be the real URL: it is what the Open record and claim
# links in every handoff email point at. A wrong value here sends designers
# to localhost.
push_env APP_BASE_URL "$URL"
npx --yes vercel@latest deploy --prod --yes >/dev/null 2>&1 || true

say "Deployed"
cat <<EOF

  Dashboard   $URL/dashboard
  Webhook     $URL/api/vaani/webhook
  Sweep       $URL/api/cron/sweep      (Bearer CRON_SECRET)
  Digest      $URL/api/cron/digest     (Bearer CRON_SECRET)

  The dashboard is behind HTTP basic auth. Username: anything.
  Password: the DASHBOARD_PASSWORD in your .env.local.

  Two things left, both outside this script:

  1. Vercel Deployment Protection is on for this project, which puts a Vercel
     login in front of the URL as well. Turn it off at
     vercel.com -> $PROJECT -> Settings -> Deployment Protection
     if you want the dashboard reachable with just the password above.

  2. Point Vaani at the webhook:
     app.vaanivoice.ai -> agent 42022c05-bc4f-4caa-87c9-b277292f4435
       Webhook URL     $URL/api/vaani/webhook
       Signing secret  the VAANI_WEBHOOK_SECRET in your .env.local

  Then prove the whole chain without waiting for a phone to ring:
     node --env-file=.env.local scripts/replay-vaani.mjs --url $URL

EOF
