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
      features/   accounts, transactions, import, categorize (inbox, label sheet, rules, payees), reports, more
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
      categories/     seed tree (versioned) + types
      categorize/     normalizeNarration (channel, VPA, IFSC, ref, payee, key), rules (schema,
                      regex safety, matcher), dictionary.json (versioned) + matcher, engine, API schemas
      import/         bank profiles, parseGrid, fingerprints, near-duplicates, transfer pairing
      spreadsheet/    SheetJS/PapaParse entry (web only, lazy)
      text/ crypto/   counterpartyKey; sha256, MurmurHash3
      health/         (Phase 4) health score components + suggestions
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

   On any failure the status reverts to `previewed`. Rows get the engine's category (§4.3), and accepted transfers get the system category and a shared `transfer_group_id`.

6. **`POST /api/imports/:id/revert`** deletes the import's rows and un-links counterparts (back to Uncategorized). The R2 file is kept. **`GET /api/imports/:id/file`** downloads the original.

**Why bulk SQL over JSON parameters:** on Workers Free, D1 allows only a small number of queries per invocation (50 on Free), and every statement is limited to 100 bound parameters. Passing rows as one JSON parameter and expanding with `json_each` keeps a 3,000-row commit to a handful of statements.

**CPU budget (Workers Free = 10 ms):** measured warm in Node at 3,000 rows: JSON + Zod 17.6 ms, fingerprints 13 ms, near-duplicates 4.5 ms, transfers 1.7 ms, **≈ 12 µs/row total**. Monthly statements (50–300 rows ≈ 1–4 ms) are well inside the budget. Files above roughly 800 rows (e.g. a full year in one download) can exceed it and fail with Cloudflare's CPU-limit error. On Free, import monthly or quarterly files; see §9.14 for options.

Upload, preview, commit and revert are rate-limited per user (`UPLOAD_LIMITER`, a Workers Rate Limiting binding, 30/min).

### 4.3 Categorization (Phase 3, implemented)

Pure engine in `packages/shared/src/categorize`, run by the Worker on import preview, manual create, rule apply and re-runs:

```
manual override (never touched) → user rules (priority asc) → learned labels → keyword dictionary → (AI, Phase 5) → Uncategorized
```

- **Normalization** (`normalizeNarration`): channel (UPI/NEFT/IMPS/RTGS/ACH/NACH/ECS/POS/card/ATM/interest/charges), VPA, IFSC prefix or UPI bank code, RRN/UTR, payee display name and remark, plus a **counterparty key**. The key is the VPA when present (except shared gateway VPAs such as `razorpay@…`), otherwise the cleaned payee name. It handles slash and dash UPI formats, NEFT/IMPS segments, mandate prefixes, masked card numbers, trailing city/country on card descriptors, and truncated `PVT/LTD`.
- **Rules**: `{all: Condition[]}` over `narration` (or the note for manual entries), `counterparty_key`, `vpa`, `amount`, `direction`, `account_id` and `channel`, with ops `contains`/`eq`/`regex`/`gte`/`lte`/`between`/`in`. Regexes pass a linear static check (no nested quantifiers, backreferences or lookbehind; ≤ 200 chars) and only ever see the first 500 characters.
- **Learned labels**: keyed by counterparty, optionally scoped by direction and/or account. The most specific match wins: account + direction, then account, then direction, then any.
- **Keyword dictionary**: `dictionary.json`, versioned data validated by Zod in tests; every slug must exist in the seed. It's indexed by first word, so a row costs O(words). The longest keyword wins, and entries without a direction also match inbound rows, so a merchant refund nets off that merchant's category. Channel-only fallbacks cover ATM → `atm_cash`, interest and charges.
- Each result stores `categorized_by`, `rule_id` / `learned_label_id`, `confidence` and `categorization_reason` (`rule:<name>`, `learned:<key>`, `keyword:<kw>`, `keyword:channel:atm`). The UI turns the reason into "Why: …".

**Where it runs**

- **Import preview** normalizes and categorizes every new row. The preview shows payee and proposed category, and `preview.json` (v2) keeps the normalized fields and results. **Commit** upserts counterparties (`INSERT OR IGNORE … FROM json_each`), resolves `counterparty_id` by key inside the insert (following merges), applies rule tags and notes, refreshes counterparty counts and bumps rule and label hit counts, all in the same single `DB.batch`.
- **ATM withdrawals** (decision: transfer to Cash) are proposed as an `atm_cash` transfer, ticked by default. Commit inserts a matching **Cash `in` leg** (fingerprint `atm:<bank fp>`, shared `transfer_group_id`, same `import_id`, so revert removes both).
- **Manual create** without a category runs the engine on payee + note.
- **Re-run** (`POST /api/categorization/run`) and **apply rule** (`POST /api/rules/:id/apply`) process 250 rows per request and loop on `nextCursor`. All chunks share one `batchId` (one undo). The re-run also back-fills channel, VPA and counterparty for rows imported before Phase 3. Writes use `UPDATE … FROM json_each` and `INSERT INTO audit_log … SELECT`, guarded by `categorized_by != 'manual'`.

**CPU** (warm, Node): normalize ≈ 3.9 µs/row, categorize ≈ 1.8 µs/row with 20 rules. Preview becomes ≈ 18 µs/row in total, so a 300-row monthly statement takes ≈ 5 ms.

### 4.4 Learn-from-label

`PATCH /api/transactions/:id/category { categoryId, scope: 'this'|'future'|'past_and_future', matchDirection = true, matchAccount = false }`, one atomic batch with one undo token:

- `this`: sets the transaction to `manual` (audit `recategorize`).
- `future`: additionally upserts the learned label for the scope (audit `learn_label` keeps the previous label state, so undo restores or deletes it).
- `past_and_future`: additionally runs `INSERT INTO audit_log … SELECT` and `UPDATE` over past rows of that counterparty within scope. It skips rows that are manual, **set by a rule** (rules outrank learned labels), split, transfer legs or governed by a more specific learned label. `GET …/category/impact` returns that count before applying.
- Errors: `no_counterparty` (nothing to learn from), `split_transaction`.

**Undo** (`POST /api/undo/:batchId`) replays an audit batch in **one** D1 batch:

- Plain category changes are restored with a single `UPDATE … FROM audit_log`. A row is restored only while it still holds the category the batch gave it, so later edits win. Deleted rules or labels are restored as null.
- Split changes and learned labels are restored individually.
- Undoable actions: `delete_txn`, `recategorize`, `bulk_recategorize`, `apply_learned`, `apply_rule`, `auto_categorize`, `learn_label`, `ai_categorize`.

### 4.5 API surface

| Method & path                                                                                        | Purpose                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET/POST /api/accounts`, `GET/PATCH/DELETE /api/accounts/:id`                                       | Accounts with SQL-computed balances. DELETE only when an account has no transactions (409 `account_has_transactions`), otherwise archive via `active=false`.                                                                                      |
| `GET/POST /api/categories`, `PATCH /api/categories/:id`, `POST /api/categories/:id/merge`            | Two-level tree. System categories can be renamed/recolored only. Group type changes and archiving cascade to children. Merge (leaf → leaf) moves every reference in one batch, then archives the source.                                          |
| `GET /api/transactions?cursor&limit&accountIds&categoryIds&tagIds&direction&from&to&q&uncategorized` | Keyset pagination on `(txn_date, created_at, id) DESC`. Group ids expand to children and split parts match. `q` searches narration/note/counterparty with `LIKE` (escaped), and numeric `q` also matches the exact amount.                        |
| `POST /api/transactions`, `GET/PATCH/DELETE /api/transactions/:id`                                   | Manual CRUD with splits (sum enforced), tags (upserted, replaced on PATCH), counterparty (keyed by `counterpartyKey`) and reimbursement link (must be an incoming txn). DELETE returns an `undoToken`. Create without a category runs the engine. |
| `PATCH /api/transactions/:id/category`, `GET …/category/impact`                                      | Learn-from-label (§4.4).                                                                                                                                                                                                                          |
| `POST /api/transactions/bulk-category` `{ids ≤ 500, categoryId}`                                     | Bulk manual relabel (splits skipped); returns `undoToken`. Rate-limited.                                                                                                                                                                          |
| `POST /api/undo/:token`                                                                              | Replays an `audit_log` batch (§4.4).                                                                                                                                                                                                              |
| `GET /api/inbox?cursor&limit`, `GET /api/inbox/count`                                                | "Needs labelling": Uncategorized rows plus up to 4 suggestions each (this payee's history, then your usual categories by direction, then defaults).                                                                                               |
| `POST /api/categorization/run` `{scope: uncategorized\|all, cursor?, batchId?}`                      | Chunked re-run (250 rows/request). Rate-limited once per run (continuations with a cursor aren't counted).                                                                                                                                        |
| `GET/POST /api/rules`, `GET/PATCH/DELETE /api/rules/:id`, `POST /api/rules/reorder`                  | Rules CRUD; new rules go last; reorder writes `priority` in one `UPDATE … FROM json_each`.                                                                                                                                                        |
| `POST /api/rules/test`, `POST /api/rules/:id/apply`                                                  | Test against history (SQL prefilter, then the same JS predicate; most recent 5,000 scanned); apply = chunked re-run of matching non-manual rows.                                                                                                  |
| `GET /api/learned-labels`, `PATCH/DELETE /api/learned-labels/:id`                                    | List with hit counts, change category, enable/disable, forget.                                                                                                                                                                                    |
| `GET /api/counterparties?q&limit`, `PATCH /api/counterparties/:id`, `POST …/:id/merge`               | Payees: search (name or key), rename, merge (moves transactions and labels; the old key keeps resolving to the target).                                                                                                                           |
| `GET /api/tags`                                                                                      | Autocomplete.                                                                                                                                                                                                                                     |
| `POST /api/alerts/preview`, `POST /api/alerts/commit`                                                | Pasted bank SMS (§4.6): parsed rows + chosen account per row → one `imports` row per account (source `sms`), then the normal preview/commit. Rate-limited (`import`).                                                                             |
| `POST /api/transactions/confirm` `{ids ≤ 100}`                                                       | Marks `needs_review` rows (e-mail alerts) as confirmed. `GET /api/transactions?status=needs_review` lists them. Rate-limited (`bulk`).                                                                                                            |
| `POST /api/categorization/ai-suggest` `{transactionIds ≤ 20}`                                        | Workers AI suggestions (§4.6); 403 `ai_disabled` when off, 502 `ai_unavailable` on model errors. Rate-limited (`ai`).                                                                                                                             |
| `GET /api/me`                                                                                        | User plus `features {ai, emailAlerts}` so the UI hides what isn't configured.                                                                                                                                                                     |

ID lists are passed to SQL as one JSON parameter (`in (select value from json_each(?))`, `db/batch.ts#inJson`) to stay under D1's 100-bound-parameter limit. Validation errors return `400 validation_error` with `issues[{path, message}]`, which forms map to fields.

### 4.6 Bank alerts and AI suggestions (Phase 5, implemented)

Alerts reuse the statement pipeline instead of a second write path, so dedup, transfers, categorization, history and revert behave the same.

- **SMS paste** (`/import/sms`): `parseAlerts` (`packages/shared/src/alerts`) runs **in the browser**. It splits the paste into messages and skips OTPs, collect requests, reminders, failed payments and offers. For each message it extracts amount, direction, date, masked digits, bank, channel, ref and payee. Narrations are rebuilt in bank-statement shape (`UPI/DR/<ref>/<payee>/<vpa>`, `POS <merchant>`, `ATM WDL`, `NEFT CR-…`), so the normalizer, learned labels and rules work unchanged. `matchAlertAccount` picks the account by last 3–4 digits, narrowed by bank and card hint, and returns null when ambiguous; the user fixes those rows. `POST /api/alerts/preview` creates one `imports` row per account (source `sms`, no R2 file) and runs `previewImport`; commit loops `commitImport`. Abandoned SMS previews are hidden from import history.
- **E-mail alerts** (optional, `email` handler in `src/index.ts` → `src/email.ts`): only envelope senders in `ALERT_SENDERS`, ≤ 256 KB. `postal-mime` parses the MIME; `emailToText` strips HTML, forward headers and quotes; the same parser and matcher run in the Worker. The owner is the first `ALLOWED_EMAILS` user. Unmatched alerts are dropped and counted. Rows are inserted as `status = needs_review`, `source = email`.
- **Statement after an alert:** near-duplicate matching treats alert rows as having no narration and is **exclusive** (each existing row absorbs at most one incoming row). When a statement row matches an `sms`/`email` row, commit **enriches** that row (bank narration, ref, balance, channel, VPA) and confirms it instead of inserting (`ENRICH_ALERTS_SQL`, counted as `alertsConfirmed`).
- **Needs review** rows count in totals and balances immediately. They're listed under Transactions → Needs review and confirmed in bulk or by saving one.
- **Workers AI** (flag `AI_ENABLED=true` + `AI` binding): the inbox's "Ask AI" sends ≤ 20 uncategorized rows. The prompt lists your categories by number, so the model can't invent one; JSON mode plus `parseAiResponse` validates every answer (known numbers only, no income category for money out, confidence clamped, < 0.4 dropped). Suggestions are stored in `ai_suggested_category_id` / `ai_confidence` and shown as chips. With the `aiAutoApply` setting (off by default), suggestions ≥ 0.9 are applied as `categorized_by = 'ai'` with an `ai_categorize` audit batch (undoable). A categorization re-run keeps AI categories when the engine finds nothing. Sent to the model: narration, payee, VPA, rounded amount, direction, channel; logs record only counts.

## 5. Reports architecture (Phase 4, implemented)

All reports read the **`v_ledger`** view (`migrations/0003_v_ledger.sql`, DATA_MODEL §4). It has one row per categorized amount, with split parts exploded and `kind` set to income, need, want, investment, transfer or uncategorized. Every aggregation runs in SQL with `GROUP BY`; the Worker only shapes results.

- **Totals:**
  - Income = Σ `signed_paise` of income rows.
  - Spend = needs + wants + uncategorized outflow, net of refunds.
  - Invested = −Σ `signed_paise` of investment rows, so redemptions net off.
  - Net savings = income − spend; savings rate = net savings ÷ income.
  - Transfers (self, card bill, ATM → Cash) are always excluded.
  - Uncategorized _inflow_ is reported separately and not counted as income until labelled.
- **Buckets:** day = `txn_date`; week = the stored `week_start` (Monday, IST); month = `substr(txn_date, 1, 7)`; year = calendar or FY (computed in SQL, labelled `FY 2026-27`). The API gap-fills empty buckets with zeros so charts never skip periods.
- **When:** daily spend (heatmap), weekday averages (total ÷ number of that weekday in the range), week of month = `(day + 6) / 7`, top days with their biggest transactions, top weeks and months.
- **Where:** top categories, payees and single spends, plus category changes vs the comparison period (`shareChanges`; noise under ₹500 is dropped).
- **Recurring detection** is pure (`detectRecurring` in shared):
  - Payments to one counterparty are merged per day and kept when within 15% of the median amount (the latest payment is always kept, so a price change shows).
  - The median interval is snapped to weekly, monthly, quarterly or yearly with slack; at least 70% of intervals must be regular.
  - Status is active, new, price changed (latest payment more than 10% off), or stopped (overdue by half a cycle plus slack).
  - Results are cached in `recurring_series`. The cache rebuilds on read when any transaction changed since the last build or it's older than 12 h, and also in the **daily cron**. Dismissals survive rebuilds.
- **Budgets:** monthly per category or group. A `month` row overrides the default (`month IS NULL`). Spend comes from one grouped query for any number of months (`budgetsForMonths`). Projection uses the run rate (spent ÷ elapsed days × days in month). States: ok, warning at ≥80%, over at ≥100%. Only spending categories can have budgets.
- **Health score:** pure `computeHealth` over ≤12 `MonthlyAggregate` rows (leading empty months trimmed). It's deterministic and table-tested; see §9.31 for the weights.
- **Exports** are built **in the browser**: the API returns JSON rows (split parts as separate rows, ≤20,000) and the lazily loaded SheetJS entry writes the XLSX. Every text cell is guarded against formula injection. The report workbook has the sheets Summary, By category, By counterparty and Transactions. CSV is RFC 4180 with a BOM. Printing uses print CSS (navigation hidden, privacy blur off).
- **Cron:** `scheduled` runs `runDailyJobs` at 02:00 IST (`30 20 * * *` UTC) to rebuild recurring caches and prune `audit_log` rows older than 180 days. Production only; preview has no trigger.

**Charts** follow the dataviz method:

- A validated categorical palette (slots 1–6, light and dark steps each validated against the card surface), one sequential blue ramp for the heatmap, and reserved status colors that always ship with an icon and label.
- Bars ≤ 24px with 4px rounded data ends, 2px lines, hairline solid grids.
- A tooltip on every plot, a legend for two or more series, and a table view on every chart.
- Text in text tokens, never series colors.
- Group colors follow the group (sort order), never its rank.
- Spend share uses a tall segmented bar plus a ranked list instead of a donut (§9.24).
- Recharts and SheetJS are lazy chunks: Reports, the dashboard trend chart and exports load them on demand.

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
12. **Search uses escaped `LIKE`** (Phase 1) over narration, note and payee name. It's adequate for a single user's few thousand rows. FTS5 is the upgrade path (DATA_MODEL §3).
13. **Bulk writes go through JSON parameters.** D1 on Free allows about 50 queries per invocation and 100 bound parameters per statement. Bulk inserts and updates bind one JSON array and expand it with `json_each` (`INSERT … SELECT`, `UPDATE … FROM`), so a 3,000-row import or a 500-row bulk relabel is a handful of statements.
14. **Large statements on Free (open decision).** About 800 rows fit in the 10 ms CPU budget. Options: (a) import monthly or quarterly files (current); (b) client-side chunked previews split on date boundaries; (c) Workers Paid.
15. **Fingerprints use MurmurHash3-128, not SHA-256.** Per-row WebCrypto calls dominated preview CPU. Murmur (non-cryptographic, collision-resistant enough for dedup within one user) cut preview time by ~7×.
16. **Phase 3: rules outrank learned labels, even for "All past + future".** Applying a learned label to the past skips rows a rule categorized, so the result matches what the pipeline would produce on the next import.
17. **Phase 3: rule tags and notes apply to new transactions only** (import and manual create). "Apply to past" changes categories only, which keeps undo exact; tag removal isn't tracked in the audit log.
18. **Phase 3: ATM → Cash leg is created at import.** ATM rows are suggested as an `atm_cash` transfer (ticked by default) and commit adds the Cash `in` leg. Rows imported before Phase 3 are only categorized as Cash withdrawal by a re-run; no Cash leg is back-filled. If you deleted or archived the Cash account, ATM rows are just categorized.
19. **Phase 3: payee identity.** The VPA is the key when present (spec). The same merchant paid by UPI and by card therefore becomes two payees, and the learned labels of one don't apply to the other. **Payees → Merge** joins them, and future imports of the merged key land on the target.
20. **Phase 3: refunds and direction.** Learned labels default to "only money going out", so a refund from a payee isn't filed as spending at that payee. Merchant keywords match both directions, so an inbound Amazon refund nets off Online shopping (decision 2026-11-01). Generic refunds stay `Income › Refund`.
21. **Phase 3: archived seed categories.** A keyword pointing at an archived (or merged-away) seeded category doesn't match, and the row stays Uncategorized. Categories carry no `merged_into` pointer yet.
22. **Phase 3: regex safety without REGEXP.** D1 has no `REGEXP`, so regex conditions run in the Worker after a SQL prefilter on the other conditions. Patterns pass a conservative static check, and inputs are capped at 500 characters.
23. **Phase 3: rate limits for chunked jobs.** Re-run and apply-rule loop in 250-row requests, which keeps each under the Free CPU budget; only the first request of a run counts against the `bulk` limit. The local dev limiter is set to 1,000/min because every Playwright test shares one dev user; preview and production keep 30/min.
24. **Phase 4: no donut.** The spec asks for a donut of spend by group. Donuts are hard to read for close values, so the dashboard uses a tall segmented bar (≤ 6 parts, shares printed only where they fit) plus a ranked, tappable list that drills into categories and then transactions. Same information, easier to compare.
25. **Phase 4: uncategorized money.** Uncategorized outflow counts as spend (conservative), but in neither needs nor wants. Uncategorized inflow is left out of income and shown as "₹X received is uncategorized — label it", so an unlabelled salary credit can't hide or distort the savings rate.
26. **Phase 4: exports in the browser.** SheetJS never runs in the Worker (Free CPU limit, D4). The Worker returns JSON rows and the browser writes the file. Text cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`, because bank narrations are untrusted input (formula injection). Exports cap at 20,000 rows and say so when truncated.
27. **Phase 4: recurring cache.** Detection over ~13 months of one user's payments is cheap, but caching keeps the list fast and statuses stable. The cache rebuilds when stale (any transaction change, or 12 h old) and nightly. Series ids change on rebuild; the UI always works from the latest list.
28. **Phase 4: investment-rate target.** The spec lists an investment rate without a target. The default target is **15%** of income, editable in Targets with the other targets (savings 20%, 50/30/20 split, 6 months emergency fund).
29. **Phase 4: health score edge cases.**
    - Components without enough data (no income, under 6 months for the trend, under 4 months with income for lifestyle creep, no budgets, no emergency fund) are marked "not enough data" and excluded from the weighted average, so the remaining weights renormalize.
    - An empty history never scores well.
    - Suggestions round to whole rupees.
    - For the period that contains today, only months up to today count; past and future periods use their own months.
30. **Phase 4: cron triggers.** Workers Free allows 5 cron triggers per account. Only production (and local dev) run the daily job; preview doesn't. The job logs only counts.
31. **Phase 4: health weights.** Savings rate 30, investment rate 15, needs/wants/savings split 15, budget adherence 15, spending trend 10, lifestyle creep 10, emergency fund 10. Bands: Excellent ≥ 80, Good ≥ 60, Needs attention ≥ 40, otherwise Off-track. The split scores 100 − 200 × the summed overshoot, i.e. needs over target + wants over target + savings under target.

32. **Phase 5: SMS parsed on the device.** The spec doesn't say where SMS are parsed. Parsing in the browser keeps raw message text off the server (only structured rows are sent) and lets you fix accounts and dates before anything is written.
33. **Phase 5: e-mail owner and unmatched alerts.** Inbound mail has no Access identity, so alerts belong to the first `ALLOWED_EMAILS` user. Alerts that match no account are dropped (counted in logs) rather than guessed. Envelope senders can be spoofed; the sender allow-list plus `needs_review` limit the damage to review items.
34. **Phase 5: needs-review rows count in totals.** Bank alerts are almost always real, so reports don't lag. Change to exclude them if forged mail ever becomes a problem.
35. **Phase 5: exclusive near-duplicate matching.** Previously two same-amount incoming rows could both be flagged as near-duplicates of one existing row. Now each existing row absorbs at most one, which also changes statement-vs-manual matching slightly (more accurate).
36. **Phase 5: AI narrative summary not built.** The spec's optional AI-written health summary is left out; the score and suggestions stay deterministic. AI is off by default and auto-apply is a separate opt-in.
