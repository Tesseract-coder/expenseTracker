# Kharcha — Architecture

Status: **Approved (Phase 0)** · Last updated: 2026-11-01

Kharcha is a single-user, mobile-first PWA for tracking personal expenses and cash flow across Indian bank accounts, credit cards, cash and wallets. It runs entirely on Cloudflare: one Worker, D1, R2, and optionally Queues and Workers AI.

---

## 1. System overview

```
                 ┌──────────────────────────── Cloudflare edge ─────────────────────────────┐
 Phone / Desktop │                                                                           │
 (installed PWA) │  Cloudflare Access ──►  Worker "kharcha" (Hono)                            │
   ───HTTPS────► │  (email OTP / Google)    ├─ Static Assets (built apps/web, SPA fallback)  │
                 │  injects                 ├─ /api/*  ── accessAuth ─ zod ─ routes ─ services│
                 │  Cf-Access-Jwt-Assertion │              │                    │             │
                 │                          │              ▼                    ▼             │
                 │                          │         D1 (SQLite)         R2 (statements)     │
                 │                          ├─ queue() consumer ◄── Queues (optional)         │
                 │                          ├─ email() handler  ◄── Email Routing (Phase 5)   │
                 │                          └─ scheduled() (recurring detection, cleanup)     │
                 │                                       Workers AI (optional, flag-gated)   │
                 └───────────────────────────────────────────────────────────────────────────┘
```

## 2. Key decisions

| #   | Decision                                                                                                                                                                                                                   | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Single Worker with Workers Static Assets** (not Pages)                                                                                                                                                                   | Cloudflare now steers new full-stack projects to Workers; Pages gets no new features. One deployable, one `wrangler.toml`, one set of bindings, and the Worker can also host the `queue()`, `email()` and `scheduled()` handlers, which Pages Functions cannot.                                                                                                                                                                                                                                                                                                                                    |
| D2  | **Hono** API mounted at `/api/*`; everything else falls through to static assets with SPA fallback (`not_found_handling = "single-page-application"`)                                                                      | Static assets are served without invoking the Worker, so they're cheap and fast.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D3  | **`packages/shared` holds all domain logic** as pure TypeScript: Zod schemas, category seed, normalization, categorization pipeline, fingerprinting, transfer/recurring detection, health-score math, bank parser profiles | Fully unit-testable without Workers; runs in the browser (import preview) and in the Worker (authoritative).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D4  | **Statements are parsed in the browser**, not in the Worker (⚠ change from spec, see §9)                                                                                                                                   | SheetJS on a 2–5 MB XLS can exceed Worker CPU limits (10 ms on Free). The client parses with the shared profile code, shows the preview immediately, then uploads the **original file** (to R2) plus **normalized rows** (JSON) to the API. The Worker re-validates every row with Zod, recomputes fingerprints and categories itself, and never trusts client-computed values.                                                                                                                                                                                                                    |
| D5  | **Queues are optional** (`ASYNC_MODE=queue\|inline`)                                                                                                                                                                       | They're used for "apply to past" recategorization over large histories, re-parsing from R2, and recurring detection. In inline mode the same job functions run in `ctx.waitUntil` or synchronously in chunks.                                                                                                                                                                                                                                                                                                                                                                                      |
| D6  | **Drizzle ORM + SQL migrations in `/migrations`**, applied with `wrangler d1 migrations apply`                                                                                                                             | `drizzle-kit generate` writes plain `.sql` files that wrangler applies in order, so there's one migration history for local, preview and production.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D7  | **Atomic writes use `db.batch()`**                                                                                                                                                                                         | D1 doesn't support interactive transactions (`BEGIN`/`COMMIT` across awaits), so Drizzle's `db.transaction()` isn't used. Multi-statement operations (import commit, bulk relabel + audit log) are built as one batch, which D1 runs as a single implicit transaction.                                                                                                                                                                                                                                                                                                                             |
| D8  | **Aggregations in SQL** using a `v_ledger` view (§4)                                                                                                                                                                       | Splits and transfers are handled once, in one place. Every report query reads from the view and filters by `user_id`, a date range and `excluded = 0`.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D9  | **Money as `INTEGER` paise, signed only at the edges**                                                                                                                                                                     | The `amount_paise` column is always positive and `direction` is `in` or `out`. Signed values are derived in SQL (`CASE direction ...`). The UI formats with `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'})`.                                                                                                                                                                                                                                                                                                                                                                      |
| D10 | **Auth = Cloudflare Access + JWT verification in the Worker**                                                                                                                                                              | `jose.createRemoteJWKSet(https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs)` is cached in module scope. The Worker checks `iss`, `aud` (= `ACCESS_AUD`) and `exp`, then maps the JWT `email` claim to a `users` row (auto-created on first login if it's in `ALLOWED_EMAILS`). There's a local bypass only when `AUTH_MODE=dev` **and** the request host is `localhost`/`127.0.0.1` **and** `APP_ENV != production` (user `dev@kharcha.local`), so a misconfigured deployment fails closed with 500 `auth_misconfigured`. Access _service tokens_ (no `email` claim) may reach only `/api/health`. |
| D11 | **TanStack Query + optimistic updates; IndexedDB persistence** of the query cache for the last-viewed dashboard                                                                                                            | Gives an offline read-only shell. Writes require the network (no offline write queue in v1; see §8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 3. Repository layout

```
apps/
  web/            React + Vite + Tailwind + shadcn/ui PWA
    src/
      app/        router, providers, layout (bottom nav)
      features/   accounts, transactions, import, categorize, reports, settings
      components/ ui (shadcn), charts, money, sheets
      lib/        api client (typed from shared schemas), format (INR, dates), query keys
  api/            Hono Worker
    src/
      index.ts    exports { fetch, queue, email, scheduled }
      middleware/ accessAuth, securityHeaders, rateLimit, errorHandler, requestId
      routes/     health, accounts, categories, transactions, imports, rules, reports, budgets, settings, export
      services/   business orchestration (calls shared + repositories)
      db/         drizzle schema, repositories, v_ledger helpers
      jobs/       recategorize, reparseImport, detectRecurring (queue + inline runners)
    test/         @cloudflare/vitest-plugin integration tests (real local D1)
    wrangler.toml
packages/
  shared/
    src/
      schemas/        zod: account, category, transaction, rule, import, report DTOs
      money/          paise helpers, INR formatting, en-IN grouping
      dates/          IST helpers, week (Mon start), FY (Apr–Mar) ranges
      categories/     seed tree (versioned JSON) + types
      normalize/      normalizeCounterparty (channel, VPA, IFSC, ref, key)
      categorize/     pipeline, rule matcher, keyword dictionary (JSON, versioned)
      fingerprint/    dedup fingerprint + near-duplicate scoring
      detect/         self-transfer pairing, CC bill payment, recurring
      parsers/        bank profiles (HDFC, ICICI, SBI, Axis, Kotak × savings/CC), generic mapper
      health/         health score components + suggestions
migrations/        0000_init.sql, ... (drizzle-kit generated, forward-only)
fixtures/          anonymized statements per bank + expected JSON (golden files)
scripts/           bootstrap-cloudflare.sh, seed-demo.ts
e2e/               Playwright specs (mobile viewports)
docs/              ARCHITECTURE.md, DATA_MODEL.md, DEPLOYMENT.md, CHANGELOG.md
.github/workflows/ ci.yml, deploy-preview.yml, deploy-production.yml
```

Package dependency rule: `web → shared`, `api → shared`. `shared` depends on nothing app-specific (only zod, plus xlsx/papaparse in `parsers/`). ESLint `import/no-restricted-paths` enforces this.

## 4. Data flow

### 4.1 Request pipeline (API)

`requestId → securityHeaders → accessAuth (sets c.var.user) → rateLimit (upload/bulk routes) → zValidator → route → service → repository (Drizzle) → JSON`.
Errors map to `{ error: { code, message } }` with stable codes. Logs contain request id, route, status and latency, and **never** narrations, amounts, VPAs or emails.

### 4.2 Statement import (Phase 2, implemented)

1. **Client: read.** `readStatementFile` lazily loads `@kharcha/shared/spreadsheet`, a separate entry point, so neither the Worker nor the main web chunk contains SheetJS. CSV/TXT go through **PapaParse**, which keeps every cell a raw string (no leading-zero loss in refs, no day/month flips). XLS/XLSX go through **SheetJS 0.20.3**, pinned to the official CDN tarball because npm's `xlsx` 0.18.5 has known CVEs. Text/HTML files masquerading as `.xls` are detected by magic bytes.
2. **Client: map.** Mapping is resolved in this order: the account's saved profile, then `detectProfile(grid, {bank, accountType})` over 10 built-in header-alias profiles, then the **mapping wizard** prefilled by `guessGenericMapping`. Every path produces one `ColumnMapping`, applied by the single pure engine `parseGrid`. The engine handles wrapped narrations, repeated page headers, opening-balance and summary rows, footer blocks, Dr/Cr columns or suffixes, and signed amounts. Wizard mappings can be saved per account (`parser_profiles`).
3. **`POST /api/imports`** (multipart): the original file goes to R2 at `u/{userId}/imports/{importId}/{sha256}.{ext}` (private, served back only through the authenticated `/file` route). The import row starts as `uploaded`. If the same file (by SHA-256) was already committed to the account, the API warns.
4. **`POST /api/imports/:id/preview`** with Zod-validated rows (≤ 3,000). The server recomputes everything itself:
   - **fingerprints**, including occurrence numbering
   - **exact duplicates**, in one query with the fingerprints as a single JSON parameter
   - **near-duplicates**, against same-account rows within ±3 days (bucketed by amount)
   - **transfer pairs** against other accounts' unpaired rows, plus single-leg card-payment and self-transfer hints
   - **reconciliation** of the statement's closing balance against the projected balance

   The full preview is stored as `preview.json` in R2 and the import becomes `previewed`. Re-previewing (e.g. after adjusting columns) reuses the uploaded file.

5. **`POST /api/imports/:id/commit`** `{includeNearDuplicates, acceptTransfers}`: an atomic claim (`status previewed → committing`, checking `changes = 1`) prevents double commits. Then a **single `DB.batch`** runs:
   - `INSERT OR IGNORE … SELECT … FROM json_each(?)` in chunks of 500 rows (one bound JSON parameter each)
   - one `UPDATE … FROM json_each` that links transfer counterparts and drops their splits

   On any failure the status reverts to `previewed`. Imported rows are Uncategorized until the Phase 3 engine runs; accepted transfers get the system category and a shared `transfer_group_id`.

6. **`POST /api/imports/:id/revert`** deletes the import's rows and un-links counterparts (back to Uncategorized). The R2 file is kept. **`GET /api/imports/:id/file`** downloads the original.

**Why bulk SQL over JSON parameters:** on Workers Free, D1 allows only a small number of queries per invocation (50 on Free), and every statement is limited to 100 bound parameters. Passing rows as one JSON parameter and expanding with `json_each` keeps a 3,000-row commit to a handful of statements.

**CPU budget (Workers Free = 10 ms):** measured warm in Node at 3,000 rows: JSON + Zod 17.6 ms, fingerprints 13 ms, near-duplicates 4.5 ms, transfers 1.7 ms, **≈ 12 µs/row total**. Monthly statements (50–300 rows ≈ 1–4 ms) are well inside the budget. Files above roughly 800 rows (e.g. a full year in one download) can exceed it and fail with Cloudflare's CPU-limit error. On Free, import monthly or quarterly files; see §9.14 for options.

Upload, preview, commit and revert are rate-limited per user (`UPLOAD_LIMITER`, a Workers Rate Limiting binding, 30/min).

### 4.3 Categorization (runs server-side on create/import/rule change)

`manual override → user rules (priority asc) → learned labels → keyword dictionary → AI suggestion (flag) → Uncategorized`. This is a pure function in `shared`:

```ts
categorize(txn: NormalizedTxn, ctx: { rules, learned, dictionary, ai? }): {
  categoryId, categorizedBy, ruleId?, learnedLabelId?, confidence, reason
}
```

The `reason` string (e.g. `keyword:swiggy → Food delivery`) is stored for "why is this categorized as X?".

### 4.4 Learn-from-label

`PATCH /api/transactions/:id/category { categoryId, scope: 'this'|'future'|'past_and_future', matchDirection, matchAccount }`

- `this`: sets `categorized_by='manual'`.
- `future`: upserts `learned_labels` and sets this txn to manual.
- `past_and_future`: same as `future`, plus `GET .../impact` first returns the count. Apply runs one `UPDATE … WHERE counterparty_id=? AND categorized_by != 'manual'` plus the audit rows, in one batch. Undo replays `audit_log.before`.

### 4.5 API surface

| Method & path                                                                                        | Purpose                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST /api/accounts`, `GET/PATCH/DELETE /api/accounts/:id`                                       | Accounts with SQL-computed balances. DELETE only when an account has no transactions (409 `account_has_transactions`), otherwise archive via `active=false`.                                                               |
| `GET/POST /api/categories`, `PATCH /api/categories/:id`, `POST /api/categories/:id/merge`            | Two-level tree. System categories can be renamed/recolored only. Group type changes and archiving cascade to children. Merge (leaf → leaf) moves every reference in one batch, then archives the source.                   |
| `GET /api/transactions?cursor&limit&accountIds&categoryIds&tagIds&direction&from&to&q&uncategorized` | Keyset pagination on `(txn_date, created_at, id) DESC`. Group ids expand to children and split parts match. `q` searches narration/note/counterparty with `LIKE` (escaped), and numeric `q` also matches the exact amount. |
| `POST /api/transactions`, `GET/PATCH/DELETE /api/transactions/:id`                                   | Manual CRUD with splits (sum enforced), tags (upserted, replaced on PATCH), counterparty (keyed by `counterpartyKey`) and reimbursement link (must be an incoming txn). DELETE returns an `undoToken`.                     |
| `POST /api/undo/:token`                                                                              | Replays the `audit_log` batch. Phase 1 supports `delete_txn`.                                                                                                                                                              |
| `GET /api/tags`, `GET /api/counterparties?q`                                                         | Autocomplete.                                                                                                                                                                                                              |

ID lists are passed to SQL as one JSON parameter (`in (select value from json_each(?))`, `db/batch.ts#inJson`) to stay under D1's 100-bound-parameter limit. Validation errors return `400 validation_error` with `issues[{path, message}]`, which forms map to fields.

## 5. Reports architecture

All reports read from `v_ledger`. There is one row per categorized money movement, with splits exploded and transfers flagged. See DATA_MODEL.md §4.

- Totals by type: `SUM(CASE ...)` grouped by `category_type`.
- Trends: `GROUP BY strftime('%Y-%m', txn_date)` for months. Weeks use a precomputed `week_start` column (Monday, IST), because SQLite's `%W` is Monday-based but its year boundaries are awkward. The FY label is computed in SQL as `CASE WHEN month>=4 THEN year ELSE year-1 END`.
- Heatmap, day-of-week and week-of-month come from columns stored on `transactions` at write time (`dow`, `week_start`), which avoids repeated date math.
- **Recurring detection** runs in `shared` over per-counterparty series (fetched per counterparty with SQL `GROUP BY`). It runs on a daily cron and after each import, and results are cached in `recurring_series`.
- **Health score** is a pure function in `shared` that takes aggregated monthly figures (`MonthlyAggregate[]`, about 12 rows), so it's deterministic and table-tested. The API just fetches the aggregates.

## 6. Environments

| Env           | Worker name       | D1                                   | R2                           | Access                                                                         | Notes                                                                                                                               |
| ------------- | ----------------- | ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `dev` (local) | —                 | local (Miniflare, `.wrangler/state`) | local                        | `AUTH_MODE=dev` bypass                                                         | `pnpm dev` runs Vite with a proxy to `wrangler dev`                                                                                 |
| `preview`     | `kharcha-preview` | `kharcha-preview`                    | `kharcha-statements-preview` | Access app on `kharcha-preview.kunalnevrekar.workers.dev` (+ its preview URLs) | PR builds upload **versions** of this Worker. Each PR gets a preview URL alias (`pr-123-kharcha-preview...`). See §9.2.             |
| `production`  | `kharcha`         | `kharcha-prod`                       | `kharcha-statements`         | Access app on `kharcha.kunalnevrekar.workers.dev`                              | workers.dev only for now; custom domain can be added later as a route without code changes. Version preview URLs disabled for prod. |

## 7. Security

- Access JWT is verified on every `/api/*` request. `/api/health` returns only `{status, version}`, but it's still behind Access. CI smoke tests use an **Access service token** (`CF-Access-Client-Id/Secret`).
- Security headers: Worker middleware for API responses; a `_headers` file in `apps/web/public` for static assets, because static assets bypass the Worker. Strict CSP: `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'` (Recharts/shadcn inline styles); `connect-src 'self'`; `frame-ancestors 'none'`. Plus HSTS, `nosniff`, `Referrer-Policy: no-referrer` and a `Permissions-Policy`.
- R2 bucket is private. Downloads stream through the Worker after the auth check.
- Rate limiting uses the **Workers Rate Limiting binding** on upload/bulk/export routes.
- Every owned table has a `user_id`, and every repository function takes `userId` as its first argument. A test asserts that no query in repositories lacks a `user_id` predicate.
- No analytics. Workers Logs is enabled with sampling, and the logger has an allow-list of fields.

## 8. Explicit non-goals (v1)

- Offline writes and sync (read-only offline shell only).
- Multi-user / sharing (schema is ready, UI is not).
- Multi-currency (INR only; `currency` column reserved).
- Bank Account Aggregator integration (needs an FIU licence).

## 9. Deviations from spec / issues found

**Decisions recorded 2026-11-01:** Workers **Free** plan → client-side parsing (item 1) and `ASYNC_MODE=inline` by default; ATM withdrawal = **transfer to Cash**; refunds = **negative spend** in the original category; **React 19**; hosting on **`*.kunalnevrekar.workers.dev`**.

1. **Parse statements client-side (D4).** The spec implies server-side parsing via Queues. Worker CPU limits (Free: 10 ms; Paid: 30 s default) make server-side SheetJS fragile on Free and wasteful on Paid. The original file still goes to R2, and the server stays authoritative for dedup and categorization. On the Free plan there is no server-side re-parse; "re-parse" downloads the original from R2 to the browser and re-runs the import preview.
2. **Preview deployments vs. preview DB.** Worker _version preview URLs_ share the bindings of the Worker they belong to. Uploading a preview version of the **production** Worker would point it at the **production** D1. Fix: a separate `kharcha-preview` Worker (env `preview`) with its own D1/R2, and PRs upload versions to _that_ Worker. All PRs share one preview D1, so PR migrations land there before merge. That's acceptable for a solo repo, and it's documented that the preview DB can be reset with `scripts/reset-preview.sh`.
3. **Dedup fingerprint collisions on legitimate repeats.** Two identical ₹20 UPI payments to the same VPA on the same day with no ref no produce the same fingerprint, so the second would be dropped. Fix: add `occurrence` (the nth identical tuple within one source file) to the fingerprint. Re-importing the same or an overlapping statement reproduces the same occurrence numbers, so it still dedupes. Cross-source duplicates (SMS vs statement) have different narrations and are caught by the near-duplicate check, not the fingerprint.
4. **Refunds inflate income.** If a Myntra refund is categorized as `Income › Refund`, income and savings rate go up even though spending didn't really go down. Proposal: an inbound transaction may carry an **expense** category, in which case it _reduces_ that category's spend (net spend). The learned-label prompt defaults to "Refund from Amazon → Online shopping (as refund)". `Income › Refund` stays for refunds you can't attribute. Cashback stays income.
5. **React 18 → React 19.** Current shadcn/ui and Tailwind v4 target React 19. I recommend React 19 unless you have a reason to stay on 18.
6. **D1 transactions** (D7): bulk operations use `batch()` and chunking. Very large "apply to past" runs (more than 5k rows) go through Queues/chunked jobs, with the audit-log undo applied per chunk.
7. **CI E2E and Access.** E2E runs against local `wrangler dev` with `AUTH_MODE=dev`. Preview and production smoke tests need an Access **service token** (two extra GitHub secrets: `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`) plus an Access policy allowing that token.
8. **Dependabot/fork PRs** don't get secrets, so `deploy-preview.yml` skips them (`if: github.actor != 'dependabot[bot]' && !github.event.pull_request.head.repo.fork`).
9. **`@cloudflare/vitest-pool-workers` is deprecated** and renamed to `@cloudflare/vitest-plugin` (same runtime, Vitest 4/5). We use the new package.
10. **Deploy workflows are opt-in.** They run only when the repo variable `CLOUDFLARE_DEPLOY_ENABLED=true`, so CI stays green before Cloudflare is bootstrapped.
11. **Node version.** Local Node is 20.20, which is **past EOL (April 2026)**, and pnpm isn't installed. CI and `.nvmrc` will target **Node 22 LTS**. Please install Node 22+ locally and run `corepack enable` to get pnpm. I'll pin `packageManager` in `package.json`.
