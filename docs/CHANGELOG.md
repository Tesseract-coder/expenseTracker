# Changelog

## Phase 2 — Statement import (2026-11-01)

- **Import flow** (`/import`): choose account and file (CSV/TXT/XLS/XLSX, up to 5 MB / 3,000 rows). The format is auto-detected, then the preview shows new rows, already-imported rows, possible duplicates (opt-in), unreadable rows, transfer suggestions and balance reconciliation. Commit is atomic and protected against double commits.
- **Built-in profiles** for HDFC, ICICI, SBI, Axis and Kotak, each for savings/current and credit cards (10 total). The **mapping wizard** handles anything else with a live parse preview, and mappings can be saved per account so the next import is one tap.
- **Dedup**: per-row fingerprints with occurrence numbering (genuine repeats survive, overlapping re-imports never duplicate), a same-file warning, and near-duplicate detection against manual entries.
- **Transfers**: self-transfer and credit-card bill-payment pairing across accounts, single-leg hints when the other side isn't imported, accepted pairs linked with a shared group and the system category.
- **Import history** (`/more/imports`): counts and status, download the original from R2, revert an import.
- Original statements are stored privately in R2. Upload/preview/commit/revert are rate-limited per user.
- Engine: one pure `parseGrid` for profiles and the wizard. SheetJS 0.20.3 is pinned from the official CDN (npm `xlsx` 0.18.5 has CVEs) and lazy-loaded in its own chunk. PapaParse handles CSV.
- **Performance**: fingerprints moved from WebCrypto SHA-256 to MurmurHash3-128, and matching is bucketed by amount. Preview CPU dropped from ~250 ms to ~37 ms per 3,000 rows (~12 µs/row).
- Tests: 10 golden-file fixtures (+ deterministic XLSX generator), 114 import-engine unit tests (shared ≥ 99% statements), 18 new API integration tests (dedup, near-dups, transfers, reconciliation, double-commit, revert, isolation), 3 new E2E flows × 2 viewports.

## Phase 1 — Core CRUD (2026-11-01)

- **Accounts**: create/edit/archive/delete (delete only when empty), SQL-computed balances, credit cards entered as an "outstanding" amount, seeded Cash account.
- **Categories**: add groups/categories, rename, icon + color, "counts as" type (need/want/investment/…), move between groups, archive (cascades from groups), merge (moves transactions, splits, rules, learned labels, budgets). System categories are protected.
- **Transactions**: one-hand bottom-sheet add/edit with expense/income toggle, category picker, remembered last account, date, payee autocomplete, note, tags, splits with live "₹x left/Balanced", reimbursable flag + link to the reimbursing credit, delete with Undo.
- **Transaction list**: infinite scroll grouped by day with daily in/out totals, debounced search (narration, payee, note, amount), filter chips (expense/income/uncategorized) and a filter sheet (accounts, category or whole group, date presets/range, tag). Filters live in the URL.
- **Home**: net balance, account balances, recent transactions.
- API: 61 integration tests (validation, ownership/tenant isolation, cursor pagination, filters, merge, undo). E2E: add, validate, split + delete/undo, filters/search, category management, no horizontal overflow on every screen at 360/390 px.
- Fixed: long unbreakable names overflowed the layout on small phones, causing mobile zoom-out and mis-taps. Sheet actions are now sticky at the bottom.

## Phase 0 — Foundation (2026-11-01)

- pnpm monorepo (`apps/web`, `apps/api`, `packages/shared`) with strict TypeScript, ESLint (flat), Prettier, Husky + lint-staged.
- `packages/shared`: INR money helpers (Indian grouping, paise parsing), IST date/week/FY helpers, versioned category seed (69 categories incl. system), shared enums and Zod API schemas. 100% coverage.
- D1 schema for all 16 tables via Drizzle, with CHECK constraints, report indexes and partial indexes; migrations `0000_init` and `0001_expression_indexes`.
- Hono Worker: Access JWT middleware (JWKS, iss/aud/exp, email allow-list, service-token health access, fail-closed dev bypass), secure headers, structured PII-free logging, JSON errors, `GET /api/health`, `/api/me`, `/api/categories`. Idempotent, concurrency-safe per-user seeding on first login.
- React 19 PWA shell: bottom nav (Home · Transactions · Add · Reports · More), dark/light/system theme, privacy blur, installable manifest + generated icons, offline app shell (API responses are never cached by the SW), update prompt.
- `wrangler.toml` with dev / preview / production environments on `*.kunalnevrekar.workers.dev`.
- CI (format, lint, typecheck, schema drift, build, coverage, Playwright E2E), opt-in preview/production deploy workflows, Dependabot, `scripts/bootstrap-cloudflare.sh`, `docs/DEPLOYMENT.md`.
