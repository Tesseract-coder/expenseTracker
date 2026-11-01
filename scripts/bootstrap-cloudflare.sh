#!/usr/bin/env bash
# One-time creation of Kharcha's Cloudflare resources (preview + production).
# Safe to re-run: existing resources are reported, not recreated.
#
# Prereqs: `pnpm install`, then `pnpm --filter @kharcha/api exec wrangler login`
#          (or export CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID).
# Usage:   scripts/bootstrap-cloudflare.sh [--with-queues]
set -euo pipefail

cd "$(dirname "$0")/../apps/api"
WRANGLER=(pnpm exec wrangler)
WITH_QUEUES=false
[[ "${1:-}" == "--with-queues" ]] && WITH_QUEUES=true

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

d1_id() {
  "${WRANGLER[@]}" d1 list --json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const db=JSON.parse(s).find(d=>d.name===process.argv[1]);process.stdout.write(db?db.uuid:"")})' "$1"
}

ensure_d1() {
  local name=$1 id
  id=$(d1_id "$name")
  if [[ -z "$id" ]]; then
    log "Creating D1 database $name (location hint: apac)"
    "${WRANGLER[@]}" d1 create "$name" --location apac >/dev/null
    id=$(d1_id "$name")
  else
    log "D1 database $name already exists"
  fi
  printf '%s' "$id"
}

ensure_r2() {
  local name=$1
  if "${WRANGLER[@]}" r2 bucket info "$name" >/dev/null 2>&1; then
    log "R2 bucket $name already exists"
  else
    log "Creating private R2 bucket $name"
    "${WRANGLER[@]}" r2 bucket create "$name" --location apac
  fi
}

PREVIEW_D1=$(ensure_d1 kharcha-preview)
PROD_D1=$(ensure_d1 kharcha-prod)
ensure_r2 kharcha-statements-preview
ensure_r2 kharcha-statements

if $WITH_QUEUES; then
  for q in kharcha-jobs-preview kharcha-jobs; do
    log "Creating queue $q (ignore 'already exists')"
    "${WRANGLER[@]}" queues create "$q" || true
  done
fi

cat <<EOT

────────────────────────────────────────────────────────────────────────
Done. Put these IDs into apps/api/wrangler.toml:

  [[env.preview.d1_databases]]     database_id = "$PREVIEW_D1"
  [[env.production.d1_databases]]  database_id = "$PROD_D1"

Next steps (see docs/DEPLOYMENT.md):
  1. Enable Cloudflare Access on both workers.dev hostnames; copy each AUD tag
     into ACCESS_AUD and your team domain into ACCESS_TEAM_DOMAIN.
  2. Set the allow-list secret for each env:
       pnpm exec wrangler secret put ALLOWED_EMAILS --env preview
       pnpm exec wrangler secret put ALLOWED_EMAILS --env production
  3. Apply migrations:  pnpm db:migrate:preview && pnpm db:migrate:production
────────────────────────────────────────────────────────────────────────
EOT
