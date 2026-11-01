# Kharcha — Data Model

Status: **Approved (Phase 0)** · Last updated: 2026-11-01 · Engine: Cloudflare D1 (SQLite) via Drizzle ORM

## 1. Conventions

| Concern        | Rule                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDs            | `TEXT` ULIDs (sortable, generated in the Worker). Seeded categories also carry a stable `slug` (e.g. `food_delivery`) that the keyword dictionary and code reference, so IDs stay globally unique per user. |
| Money          | `INTEGER` paise, always ≥ 0. Sign comes from `direction` (`in` / `out`). Never REAL.                                                                                                                        |
| Business dates | `TEXT 'YYYY-MM-DD'` in **Asia/Kolkata** (`txn_date`, `posted_date`, budget months as `'YYYY-MM'`).                                                                                                          |
| Timestamps     | `INTEGER` Unix epoch **milliseconds, UTC** (`created_at`, `updated_at`).                                                                                                                                    |
| Booleans       | `INTEGER` 0/1 with `CHECK (x IN (0,1))`.                                                                                                                                                                    |
| Enums          | `TEXT` + `CHECK (... IN (...))`, mirrored by Zod enums in `packages/shared`.                                                                                                                                |
| JSON           | `TEXT` holding JSON, validated by Zod on read and write (`rules.conditions`, `parser_profiles.mapping`, `audit_log.before/after`).                                                                          |
| Ownership      | Every owned table has `user_id TEXT NOT NULL REFERENCES users(id)`. Every query filters on it.                                                                                                              |
| Soft delete    | `archived`/`active` flags for accounts and categories. Transactions are hard-deleted, but the deletion goes to `audit_log` so undo works.                                                                   |
| FKs            | `PRAGMA foreign_keys` is on by default in D1. `ON DELETE` behaviour is listed per table.                                                                                                                    |

## 2. Entity overview

```
users ─┬─< accounts ─┬─< transactions >─┬── categories (self-ref parent_id)
       │             │       │  │  │    ├── counterparties
       │             │       │  │  │    ├── rules / learned_labels (provenance)
       │             │       │  │  │    └── imports ──< (file in R2)
       │             │       │  │  └─< transaction_splits >── categories
       │             │       │  └─< transaction_tags >── tags
       │             │       └── transfer_group_id (pairs self-transfers / CC payments)
       │             └── parser_profiles
       ├─< rules, learned_labels, budgets, recurring_series, settings, audit_log
```

## 3. Tables

### users

| col        | type                 | notes                             |
| ---------- | -------------------- | --------------------------------- |
| id         | TEXT PK              |                                   |
| email      | TEXT UNIQUE NOT NULL | from the Access JWT `email` claim |
| created_at | INTEGER              |                                   |

### accounts

| col                    | type                         | notes                                                                                                       |
| ---------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| id, user_id            | TEXT                         |                                                                                                             |
| name                   | TEXT NOT NULL                | "HDFC Salary"                                                                                               |
| bank                   | TEXT                         | `hdfc\|icici\|sbi\|axis\|kotak\|other\|null`                                                                |
| type                   | TEXT CHECK                   | `savings\|current\|credit_card\|cash\|wallet\|investment`                                                   |
| last4                  | TEXT CHECK(length=4) NULL    | display only, also used by the SMS parser to match accounts                                                 |
| opening_balance_paise  | INTEGER NOT NULL DEFAULT 0   | **signed**: credit cards may open with outstanding (negative) balance. This is the one signed money column. |
| opening_balance_date   | TEXT NOT NULL                |                                                                                                             |
| color                  | TEXT                         | hex                                                                                                         |
| parser_profile_id      | TEXT NULL FK parser_profiles | last used / saved profile                                                                                   |
| active                 | INTEGER DEFAULT 1            |                                                                                                             |
| sort_order             | INTEGER                      |                                                                                                             |
| created_at, updated_at | INTEGER                      |                                                                                                             |

Unique: `(user_id, name)`. Balance = `opening_balance_paise + Σ signed(amount)` over txns with `txn_date >= opening_balance_date`, computed in SQL.

### categories

| col                    | type                                       | notes                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id, user_id            | TEXT                                       |                                                                                                                                                                                                           |
| parent_id              | TEXT NULL FK categories ON DELETE RESTRICT | NULL means group                                                                                                                                                                                          |
| slug                   | TEXT NULL                                  | stable seed identity (`grocery`, `atm_cash`); NULL for user-created categories. Never changes once released.                                                                                              |
| name                   | TEXT NOT NULL                              |                                                                                                                                                                                                           |
| type                   | TEXT CHECK                                 | `income\|expense_need\|expense_want\|investment\|transfer`. A child inherits the parent's type by default but may override it (e.g. _Insurance premium_ under Household could be `investment` for ULIPs). |
| system_key             | TEXT NULL                                  | `self_transfer\|cc_bill_payment\|opening_adjustment\|uncategorized\|atm_cash`. Code depends on these, so they can't be deleted or retyped.                                                                |
| icon                   | TEXT                                       | lucide icon name                                                                                                                                                                                          |
| color                  | TEXT                                       |                                                                                                                                                                                                           |
| archived               | INTEGER DEFAULT 0                          |                                                                                                                                                                                                           |
| sort_order             | INTEGER                                    |                                                                                                                                                                                                           |
| created_at, updated_at | INTEGER                                    |                                                                                                                                                                                                           |

Unique: `(user_id, ifnull(parent_id,''), name)`, `(user_id, slug)` and `(user_id, system_key)`. Two levels are enforced in the service layer (a parent must have `parent_id IS NULL`). **Merge** = reassign txns/splits/rules/learned/budgets in one batch, then archive the source.

Group `type` (for seeding): Income→`income`, Investment→`investment`, Household/Essentials→`expense_need`, Lifestyle→`expense_want`, Travel & Transport→`expense_need` (Hotels/Flights could be retyped to want), Other/Misc→`expense_need`, System→`transfer`.
_Cash withdrawal (ATM)_ is special: it's typed `transfer` (money moves bank→cash account). Spend is recorded when you log cash spends against the Cash account. (Decided.) A setting `atm_as_spend` can flip it later if you stop tracking cash.

### counterparties

| col                    | type                        | notes                                                                                   |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| id, user_id            | TEXT                        |                                                                                         |
| key                    | TEXT NOT NULL               | canonical key: VPA if present (`swiggy.instamart@ybl`), else normalized name (`swiggy`) |
| display_name           | TEXT                        | editable                                                                                |
| vpa                    | TEXT NULL                   |                                                                                         |
| default_category_id    | TEXT NULL                   | denormalized convenience from learned labels                                            |
| merged_into_id         | TEXT NULL FK counterparties | merge keeps the old key resolvable                                                      |
| txn_count              | INTEGER DEFAULT 0           | maintained on write                                                                     |
| last_seen_date         | TEXT                        |                                                                                         |
| created_at, updated_at | INTEGER                     |                                                                                         |

Unique: `(user_id, key)`.

### transactions

| col                      | type                                           | notes                                                                                   |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| id, user_id              | TEXT                                           |                                                                                         |
| account_id               | TEXT NOT NULL FK accounts ON DELETE RESTRICT   |                                                                                         |
| txn_date                 | TEXT NOT NULL                                  | value date (IST)                                                                        |
| posted_date              | TEXT NULL                                      |                                                                                         |
| week_start               | TEXT NOT NULL                                  | Monday of `txn_date`'s week, precomputed                                                |
| dow                      | INTEGER NOT NULL                               | 1 = Mon … 7 = Sun                                                                       |
| amount_paise             | INTEGER NOT NULL CHECK(> 0)                    |                                                                                         |
| direction                | TEXT CHECK                                     | `in\|out`                                                                               |
| raw_narration            | TEXT                                           | as received                                                                             |
| channel                  | TEXT NULL                                      | `upi\|neft\|imps\|rtgs\|pos\|atm\|ach\|nach\|ecs\|card\|interest\|charges\|cash\|other` |
| counterparty_id          | TEXT NULL FK counterparties ON DELETE SET NULL |                                                                                         |
| vpa                      | TEXT NULL                                      |                                                                                         |
| ifsc_prefix              | TEXT NULL                                      |                                                                                         |
| ref_no                   | TEXT NULL                                      |                                                                                         |
| category_id              | TEXT NULL FK categories                        | NULL only when `is_split=1`                                                             |
| categorized_by           | TEXT CHECK                                     | `manual\|rule\|learned\|keyword\|ai\|none`                                              |
| rule_id                  | TEXT NULL FK rules ON DELETE SET NULL          |                                                                                         |
| learned_label_id         | TEXT NULL FK learned_labels ON DELETE SET NULL |                                                                                         |
| confidence               | REAL NULL                                      | 0–1; display only, never money                                                          |
| categorization_reason    | TEXT NULL                                      | e.g. `keyword:swiggy`                                                                   |
| ai_suggested_category_id | TEXT NULL                                      | suggestion only, not applied                                                            |
| is_split                 | INTEGER DEFAULT 0                              |                                                                                         |
| note                     | TEXT NULL                                      |                                                                                         |
| status                   | TEXT CHECK                                     | `confirmed\|needs_review`                                                               |
| source                   | TEXT CHECK                                     | `manual\|import\|sms\|email\|restore`                                                   |
| fingerprint              | TEXT NOT NULL                                  | see §5                                                                                  |
| import_id                | TEXT NULL FK imports ON DELETE SET NULL        |                                                                                         |
| transfer_group_id        | TEXT NULL                                      | shared by both legs of a self-transfer / CC bill payment                                |
| is_reimbursable          | INTEGER DEFAULT 0                              |                                                                                         |
| reimbursed_by_txn_id     | TEXT NULL FK transactions ON DELETE SET NULL   | links to the reimbursement credit                                                       |
| balance_after_paise      | INTEGER NULL                                   | from the statement, if present; signed; used for reconciliation hints                   |
| created_at, updated_at   | INTEGER                                        |                                                                                         |

**Indexes**

- `UNIQUE (user_id, fingerprint)`
- `(user_id, account_id, txn_date)`
- `(user_id, category_id, txn_date)`
- `(user_id, txn_date)`: dashboard/heatmap
- `(user_id, counterparty_id, txn_date)`: learned relabel, recurring detection
- `(user_id, status) WHERE status='needs_review'` and `(user_id, categorized_by) WHERE categorized_by='none'`: inbox (partial indexes)
- `(user_id, transfer_group_id) WHERE transfer_group_id IS NOT NULL`

**Search**: Phase 1 uses escaped `LIKE` over narration, note and counterparty name (see ARCHITECTURE §9.12). Possible later upgrade: an FTS5 virtual table `transactions_fts(raw_narration, note, counterparty_name)` with `content='transactions'` (D1 supports FTS5), kept in sync by triggers. Amount search is an exact match on the paise conversion.

### transaction_splits

| col            | type                                   | notes |
| -------------- | -------------------------------------- | ----- |
| id, user_id    | TEXT                                   |       |
| transaction_id | TEXT FK transactions ON DELETE CASCADE |       |
| category_id    | TEXT NOT NULL FK categories            |       |
| amount_paise   | INTEGER NOT NULL CHECK(> 0)            |       |
| note           | TEXT NULL                              |       |

Invariant (service layer + test): `Σ splits.amount_paise = transactions.amount_paise` when `is_split=1`.

### tags / transaction_tags

`tags(id, user_id, name UNIQUE per user, color)` · `transaction_tags(transaction_id FK CASCADE, tag_id FK CASCADE, PK(transaction_id, tag_id))`.

### rules

| col                    | type               | notes                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id, user_id            | TEXT               |                                                                                                                                                                                                                                                                                                      |
| name                   | TEXT               |                                                                                                                                                                                                                                                                                                      |
| priority               | INTEGER NOT NULL   | lower runs first; reorder rewrites the column in one batch                                                                                                                                                                                                                                           |
| enabled                | INTEGER DEFAULT 1  |                                                                                                                                                                                                                                                                                                      |
| conditions             | TEXT JSON          | `{ all: Condition[] }` where Condition = `{field: 'counterparty_key'\|'vpa'\|'narration'\|'amount'\|'direction'\|'account_id'\|'channel', op: 'eq'\|'contains'\|'regex'\|'between'\|'gte'\|'lte'\|'in', value}`. Regexes are validated (length cap, no catastrophic patterns via a safe-regex check) |
| category_id            | TEXT FK categories |                                                                                                                                                                                                                                                                                                      |
| set_tags               | TEXT JSON NULL     | tag ids                                                                                                                                                                                                                                                                                              |
| set_note               | TEXT NULL          |                                                                                                                                                                                                                                                                                                      |
| hit_count              | INTEGER DEFAULT 0  |                                                                                                                                                                                                                                                                                                      |
| last_hit_at            | INTEGER NULL       |                                                                                                                                                                                                                                                                                                      |
| created_at, updated_at | INTEGER            |                                                                                                                                                                                                                                                                                                      |

### learned_labels

| col                    | type                                     | notes                          |
| ---------------------- | ---------------------------------------- | ------------------------------ |
| id, user_id            | TEXT                                     |                                |
| counterparty_id        | TEXT FK counterparties ON DELETE CASCADE | key resolves through VPA first |
| direction              | TEXT NULL                                | `in\|out\|NULL` (NULL = both)  |
| account_id             | TEXT NULL FK accounts ON DELETE CASCADE  | NULL = any                     |
| category_id            | TEXT FK categories                       |                                |
| enabled                | INTEGER DEFAULT 1                        |                                |
| hit_count, last_hit_at | INTEGER                                  |                                |
| created_at, updated_at | INTEGER                                  |                                |

Unique: `(user_id, counterparty_id, IFNULL(direction,'*'), IFNULL(account_id,'*'))` (expression index). Most-specific match wins (account+direction, then direction, then any).

### imports

| col                                                                     | type                                      | notes                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| id, user_id                                                             | TEXT                                      |                                                                |
| account_id                                                              | TEXT FK accounts                          |                                                                |
| source                                                                  | TEXT                                      | `file\|sms\|email`                                             |
| r2_key                                                                  | TEXT NULL                                 |                                                                |
| file_name                                                               | TEXT, file_sha256 TEXT, file_size INTEGER |                                                                |
| parser_profile_id                                                       | TEXT NULL                                 | built-in key or user profile id                                |
| status                                                                  | TEXT CHECK                                | `uploaded\|previewed\|committing\|committed\|failed\|reverted` |
| rows_parsed, rows_new, rows_duplicate, rows_near_duplicate, rows_failed | INTEGER                                   |                                                                |
| statement_from, statement_to                                            | TEXT NULL                                 |                                                                |
| statement_closing_balance_paise                                         | INTEGER NULL                              | for reconciliation                                             |
| error                                                                   | TEXT NULL                                 | sanitized message, no row content                              |
| created_at, committed_at                                                | INTEGER                                   |                                                                |

"Revert import" deletes its transactions (with audit), keeping the file.

### parser_profiles

| col                    | type      | notes                                                                                                                                                                                              |
| ---------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id, user_id            | TEXT      |                                                                                                                                                                                                    |
| name                   | TEXT      |                                                                                                                                                                                                    |
| builtin_key            | TEXT NULL | e.g. `hdfc_savings_v1`. Built-ins live in code, and a row exists only if the user forks one.                                                                                                       |
| mapping                | TEXT JSON | `{ headerMatch: string[], skipRowsUntilHeader, dateColumn, dateFormat, narrationColumns[], refColumn, debitColumn, creditColumn \| amountColumn+drCrColumn, balanceColumn, footerStopPatterns[] }` |
| created_at, updated_at | INTEGER   |                                                                                                                                                                                                    |

### budgets

| col          | type               | notes                                               |
| ------------ | ------------------ | --------------------------------------------------- |
| id, user_id  | TEXT               |                                                     |
| category_id  | TEXT FK categories | group or leaf                                       |
| month        | TEXT NULL          | `'YYYY-MM'`; NULL means the default for every month |
| amount_paise | INTEGER NOT NULL   |                                                     |

Unique: `(user_id, category_id, IFNULL(month,'*'))`. A month-specific row overrides the default.

### recurring_series (cache, rebuilt by job)

`id, user_id, counterparty_id, category_id, cadence ('weekly'|'monthly'|'quarterly'|'yearly'), typical_amount_paise, amount_tolerance_pct, last_date, next_expected_date, occurrences, status ('active'|'new'|'price_changed'|'stopped'), dismissed INTEGER, updated_at`.

### settings

`user_id, key, value(JSON), PK(user_id, key)`. Keys: `year_mode ('calendar'|'fy')`, `targets {savingsRate, needs, wants, savings, emergencyMonths}`, `emergency_fund_paise`, `privacy_blur_default`, `atm_as_spend`, `ai_enabled`, `last_account_id`, `theme`.

### audit_log

| col         | type                       | notes                                                                                                                |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| id, user_id | TEXT                       |                                                                                                                      |
| batch_id    | TEXT                       | groups one user action (undo unit)                                                                                   |
| action      | TEXT                       | `recategorize\|bulk_recategorize\|apply_learned\|delete_txn\|merge_category\|merge_counterparty\|revert_import\|...` |
| entity      | TEXT, entity_id TEXT       |                                                                                                                      |
| before      | TEXT JSON, after TEXT JSON |                                                                                                                      |
| undone_at   | INTEGER NULL               |                                                                                                                      |
| created_at  | INTEGER                    |                                                                                                                      |

Index `(user_id, batch_id)` and `(user_id, created_at)`. Entries older than 180 days are pruned by cron.

## 4. Reporting view: `v_ledger` (added in Phase 4)

One row per categorized amount. Splits are exploded, and transfers are kept but flagged.

```sql
CREATE VIEW v_ledger AS
SELECT t.user_id, t.id AS txn_id, t.account_id, t.txn_date, t.week_start, t.dow,
       t.direction, t.counterparty_id,
       COALESCE(s.category_id, t.category_id)       AS category_id,
       COALESCE(s.amount_paise, t.amount_paise)     AS amount_paise,
       c.type                                       AS category_type,
       COALESCE(c.parent_id, c.id)                  AS group_id,
       CASE WHEN c.type = 'transfer' THEN 1 ELSE 0 END AS excluded,
       -- signed contribution to "spend" for expense categories (refunds reduce spend)
       CASE WHEN c.type IN ('expense_need','expense_want')
            THEN CASE t.direction WHEN 'out' THEN 1 ELSE -1 END * COALESCE(s.amount_paise, t.amount_paise)
            ELSE 0 END                              AS spend_paise
FROM transactions t
LEFT JOIN transaction_splits s ON s.transaction_id = t.id AND t.is_split = 1
JOIN categories c ON c.id = COALESCE(s.category_id, t.category_id);
```

Report formulas (period P):

- **Income** = Σ amount where `category_type='income' AND direction='in'`
- **Spend** = Σ `spend_paise` (needs + wants, net of refunds)
- **Invested** = Σ out − Σ in where `category_type='investment'` (redemptions net off)
- **Net savings** = Income − Spend. **Savings rate** = Net savings / Income (it includes invested money, consistent with the spec's (income − needs − wants)/income).

## 5. Dedup fingerprint

```
fingerprint = sha256_hex(
  account_id | txn_date | amount_paise | direction |
  normalize_for_fp(raw_narration) | (ref_no ?? '') | occurrence
)
```

- `normalize_for_fp`: uppercase, collapse whitespace, strip trailing balances/footnote markers. **Not** the counterparty key, so normalizer upgrades don't change fingerprints.
- `occurrence`: 0 for the first row with an identical tuple within a source batch, 1 for the second, and so on (see ARCHITECTURE §9.3).
- **Near-duplicate**: same account, same amount and direction, `|Δdate| ≤ 2 days`, and narration token-Jaccard ≥ 0.5 or the same ref_no or the same counterparty, against existing rows not in the same import. Shown for review, never auto-skipped.
- Manual entries get `fingerprint = sha256('manual'|id)`, so they never collide, but they still take part in near-duplicate checks when a statement is later imported (e.g. a manual cash entry vs. an imported ATM withdrawal).

## 6. Transfer detection

- **Self-transfer**: out on account A and in on account B (A ≠ B, both mine), same amount, `|Δdate| ≤ 2`. Alternatively, the narration contains one of my account last-4s, my VPAs (setting `my_vpas`) or my name. Candidates are suggested; confirming assigns the same `transfer_group_id` and the System › Self transfer category to both legs.
- **CC bill payment**: out from savings/current with narration matching CC payment patterns (`CC PAYMENT`, `CREDIT CARD`, `BILLDESK.*CARD`, card last-4), paired with an in on a `credit_card` account with the same amount within ±3 days. Both legs become System › Credit card bill payment.

## 7. Migration policy

- Forward-only, generated by `drizzle-kit generate` into `/migrations`, applied by `wrangler d1 migrations apply`.
- **Expand/contract**: each migration must work with the _previously deployed_ Worker (add nullable columns or new tables; never rename/drop in the same release that stops using them). Destructive cleanup ships one release later.
- **Expression indexes** (`ifnull(...)` uniqueness on categories, learned_labels, budgets) are hand-written in `migrations/0001_expression_indexes.sql`, because drizzle-kit renders them incorrectly for SQLite. Partial indexes use `sql.raw` with unqualified column names for the same reason. Any new expression index must go into a `drizzle-kit generate --custom` migration.
- CI fails if `drizzle-kit generate` produces a diff (schema drift guard).
- The seed (categories, settings defaults) runs idempotently on first login per user, not as a migration, so migrations stay schema-only. Categories are `INSERT … ON CONFLICT DO NOTHING` keyed by `(user_id, slug)`, and children resolve `parent_id` by slug at insert time. A `category_seed_version` setting lets later releases add new seed categories without touching user edits.

## 8. Decisions log

- 2026-11-01: ATM = transfer to Cash; refunds = negative spend; Workers Free plan; React 19.
- 2026-11-01 (Phase 0): added `categories.slug`; FTS5 and `v_ledger` deferred to the phases that use them.
- 2026-11-01 (Phase 1): every user gets a seeded **Cash** account on first login. Manual transactions have `channel = NULL`, `source = 'manual'`, `categorized_by = 'manual'` (or `'none'` → Uncategorized). Balances count only transactions dated on/after `opening_balance_date`. Category merge drops source budgets that collide with a target budget for the same month. Recategorizations write `audit_log` rows (`recategorize`); deletes write full snapshots (`delete_txn`) for undo.
