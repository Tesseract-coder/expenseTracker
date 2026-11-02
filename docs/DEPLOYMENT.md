# Kharcha — Deployment

Targets: `kharcha-preview.kunalnevrekar.workers.dev` (preview) and `kharcha.kunalnevrekar.workers.dev` (production), on the Workers **Free** plan. Nothing here touches your existing zones or routes.

## 1. Prerequisites

- Node 22+ (`nvm use`) and pnpm via `corepack enable`. Then run `pnpm install`.
- Cloudflare dashboard → **R2** → enable R2. The Free tier includes 10 GB, but R2 needs a payment method on file before first use.
- Zero Trust → pick a **team name** (gives `<team>.cloudflareaccess.com`). Under Settings → Authentication, enable **One-time PIN** and/or **Google**.

## 2. Create resources (one time)

```bash
pnpm --filter @kharcha/api exec wrangler login
scripts/bootstrap-cloudflare.sh            # add --with-queues later if you enable Queues
```

Copy the two printed `database_id` values into `apps/api/wrangler.toml` (`env.preview` and `env.production`) and commit.

## 3. First deploy, then put it behind Access

Access on workers.dev is enabled per Worker, so the Worker has to exist first. Until `ACCESS_AUD` is set, the API **fails closed** (every `/api/*` returns 500 `auth_misconfigured`). Only the empty static shell is reachable during this window.

```bash
pnpm --filter @kharcha/web build
cd apps/api
pnpm exec wrangler d1 migrations apply DB --remote --env production
pnpm exec wrangler deploy --env production
```

Then, for **each** Worker (`kharcha`, and later `kharcha-preview`):

1. Workers & Pages → the Worker → **Settings → Domains & Routes** → `workers.dev` → **Enable Cloudflare Access**. For `kharcha-preview`, also enable it for **Preview URLs**.
2. Zero Trust → Access → Applications → open the generated app → **Policies**: one _Allow_ policy, Include → Emails → your email.
3. Copy the **Application Audience (AUD) tag**. In `wrangler.toml`, set `ACCESS_AUD` for that env and `ACCESS_TEAM_DOMAIN = "<team>.cloudflareaccess.com"`.
4. Set the allow-list (defense in depth; the Worker checks the email claim too):
   ```bash
   pnpm exec wrangler secret put ALLOWED_EMAILS --env production   # e.g. you@gmail.com
   ```
5. Redeploy (or merge to `main` once CI/CD is enabled).

Check it: open the URL in a private window. You should get the Access login, and after login the app shows "Signed in as …". Calling `curl https://kharcha.kunalnevrekar.workers.dev/api/health` without a token should get the Access redirect, never JSON.

## 4. CI smoke-test service token

Zero Trust → Access → **Service Auth → Create service token** (`kharcha-ci`). Then, on the production Access app, add a policy with **Action: Service Auth**, Include → Service Token → `kharcha-ci`. Service tokens carry no email, and the Worker lets them reach only `/api/health`.

## 5. GitHub configuration

**API token** (My Profile → API Tokens → Create custom token). Permissions:

| Scope   | Permission               | Why                                    |
| ------- | ------------------------ | -------------------------------------- |
| Account | Workers Scripts: Edit    | deploy / versions upload, secrets      |
| Account | D1: Edit                 | `d1 migrations apply --remote`         |
| Account | Workers R2 Storage: Edit | R2 bucket binding validation on deploy |
| Account | Queues: Edit             | only if Queues are enabled             |
| Account | Account Settings: Read   | wrangler account lookup                |
| User    | User Details: Read       | wrangler `whoami` during deploy        |

Account resources: limit to your account only. Zone resources: none.

**Repository secrets**: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`.
**Repository variable**: `CLOUDFLARE_DEPLOY_ENABLED = true`. Deploy workflows are skipped until this is set.
**Environments**: create `preview` and `production`. On `production`, add yourself as a **required reviewer** and restrict deployment branches to `main`.

## 6. Pipelines

| Workflow                | Trigger                   | What it does                                                                                                                                                   |
| ----------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | every PR / push, reusable | format, lint, typecheck, schema-drift check, build, unit + integration tests with coverage, Playwright E2E against `wrangler dev` (report uploaded on failure) |
| `deploy-preview.yml`    | PR (same-repo, non-bot)   | migrate **preview** D1 → `wrangler versions upload --env preview --preview-alias pr-N` → comment the URL on the PR                                             |
| `deploy-production.yml` | push to `main`, manual    | runs `ci.yml` → (approval) → migrate **prod** D1 → `wrangler deploy --env production` → smoke test `/api/health` expecting the new commit SHA                  |

Both deploy workflows use concurrency groups, so deploys never overlap.

**Why a separate preview Worker:** version preview URLs share the bindings of their Worker. Previewing the production Worker would hit the production D1. All PRs share one preview D1, so PR migrations land there before merge.

**Reset the preview DB** if a PR's migration is abandoned: `wrangler d1 delete kharcha-preview`, re-run the bootstrap script, update the ID, then `pnpm db:migrate:preview`.

## 7. Limits worth knowing (Workers Free)

- **Rate limiting:** `UPLOAD_LIMITER` uses the Workers Rate Limiting binding, counted per user and scope (`upload`, `import`, `bulk`). Each env has its own `namespace_id` (1001/1002/1003) in `wrangler.toml`; these are arbitrary per-account identifiers, so change them if they collide with your other Workers. Preview and production allow 30/min per scope. The local dev config allows 1,000/min because all Playwright tests share one dev user. Chunked jobs (re-run categorization, apply rule) count once per run.
- **Categorization jobs:** re-runs and "apply rule to past" process 250 transactions per request (each well inside the 10 ms CPU limit), and the app loops until done. A 10,000-transaction history takes about 40 short requests.
- **Statement size:** imports are capped at 3,000 rows and 5 MB. On the Free plan's 10 ms CPU limit, files over roughly 800 rows can fail with Cloudflare's CPU-limit error (ARCHITECTURE §4.2), so import monthly or quarterly statements.
- **R2:** original statements and short-lived `preview.json` files live under `u/{userId}/imports/…`. Both stay private and are only served through the authenticated API.

- **Cron:** production runs one daily trigger (`30 20 * * *` UTC = 02:00 IST) to refresh recurring payments and prune undo history older than 180 days. Preview has no trigger, to stay inside Free's 5 triggers per account. Locally: `pnpm --filter @kharcha/api exec wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled?cron=30+20+*+*+*"`.

## 8. Migrations and rollback

- Migrations are forward-only and run **before** the new code deploys, so each one must work with the currently deployed Worker (expand/contract, DATA_MODEL §7).
- Code rollback: `pnpm --filter @kharcha/api exec wrangler rollback --env production`. A schema rollback is a new forward migration.
- D1 Time Travel (point-in-time restore, last 7 days on Free) is the disaster-recovery path: `wrangler d1 time-travel restore kharcha-prod --timestamp <ISO>`.

## 9. Adding a custom domain later

Add `routes = [{ pattern = "kharcha.<yourdomain>", custom_domain = true }]` under `[env.production]`, protect that hostname with an Access app (new AUD → `ACCESS_AUD`), then optionally set `workers_dev = false`. No code changes needed.

## 10. Local development

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm db:migrate:local
pnpm dev            # Vite on :5173 (proxies /api) + wrangler dev on :8787
```

Demo data: open the app once (so the dev user exists), then `pnpm seed:demo` (12 months, about 570 transactions) or `pnpm seed:demo --months 24 --scale 5` for performance work. It's idempotent (fixed ids). Demo accounts have no last-4 digits, so they never trigger transfer hints in imports.

Local auth uses the dev bypass (`AUTH_MODE=dev`, localhost only) as `dev@kharcha.local`.

## 11. Optional: alert e-mails and Workers AI (Phase 5)

- **E-mail alerts**: needs a zone on Cloudflare with Email Routing. Route an address (e.g. `txn@yourdomain`) to the `kharcha` Worker. Then run `wrangler secret put ALERT_SENDERS --env production` (comma-separated: your own address(es) that forward the alerts). Transactions go to the first `ALLOWED_EMAILS` user as "Needs review". Alerts whose last digits match no account are dropped (counted in logs as `unmatched`), so set last-4 on your accounts. Envelope senders can in principle be spoofed; at worst a forged mail adds review items.
- **Workers AI**: add `[env.production.ai] binding = "AI"` and set `AI_ENABLED = "true"`. Optional `AI_MODEL` (default `@cf/meta/llama-3.1-8b-instruct`). The narration, payee, UPI handle and rounded amount of the selected transactions are sent to Workers AI (Cloudflare, same account). The free tier is 10k neurons/day; it is rate-limited per user.
