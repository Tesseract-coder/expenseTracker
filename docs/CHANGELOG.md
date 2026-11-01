# Changelog

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
