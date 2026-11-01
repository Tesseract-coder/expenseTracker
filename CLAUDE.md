# CLAUDE.md — Kharcha

Single-user personal finance PWA on Cloudflare (Workers + Static Assets, D1, R2). Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` and `docs/DEPLOYMENT.md` before non-trivial changes, and keep them updated.

## Working agreement

- Build in the phases from the master spec. After each phase: all checks green → conventional commit → stop with a summary and a "how to verify" list. Add an entry to `docs/CHANGELOG.md`.
- If the spec is ambiguous or wrong, say so and propose a fix. Record decisions in the docs' decision logs.
- Never commit secrets. Never log narrations, amounts, VPAs or emails. Use `lib/logger.ts` (allow-listed fields only).

## Commands (Node 22 via `nvm use`, pnpm)

| Task                            | Command                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| Dev (Vite :5173 + Worker :8787) | `pnpm dev` (first: `pnpm db:migrate:local`)                     |
| All checks                      | `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` |
| Build web + Worker dry-run      | `pnpm build`                                                    |
| E2E (needs `pnpm build`)        | `pnpm test:e2e`                                                 |
| Coverage                        | `pnpm test:coverage` (shared enforces ≥90%)                     |
| New migration                   | edit `apps/api/src/db/schema.ts` → `pnpm db:generate`           |
| Apply migrations locally        | `pnpm db:migrate:local`                                         |

## Layout and boundaries

- `packages/shared`: pure TS domain logic and Zod schemas. **No React/Hono/Drizzle imports** (enforced by ESLint). Consumed as source (`exports: ./src/index.ts`), no build step.
- `apps/api`: Hono Worker. `routes/` (HTTP + Zod) → `services/` (orchestration) → Drizzle. App factory `createApp(deps)` in `src/app.ts`, entry in `src/index.ts`.
- `apps/web`: React 19 + Vite 8 + Tailwind v4 + shadcn-style components in `components/ui`. Features in `src/features/<name>`. Server state via TanStack Query (`app/queries.ts`), API calls via `lib/api.ts` (responses validated with shared schemas).
- `migrations/`: drizzle-kit output + hand-written custom migrations, applied by wrangler.

## Conventions

- **Money**: integer paise only (`amount_paise > 0` + `direction in|out`). Format with `formatINR` / `<Money>`; parse with `parseRupeesToPaise`. Never use floats for money.
- **Dates**: business dates are `YYYY-MM-DD` in IST (`toIstDate`, `weekStart`, `periodRange` in shared); timestamps are epoch ms UTC. Weeks start Monday; FY = Apr–Mar.
- **Enums**: define once in `packages/shared/src/schemas/enums.ts`; Drizzle CHECKs and Zod derive from them.
- **Ownership**: every owned table has `user_id`, and every query filters by `c.get('user').id`.
- **D1**: no interactive transactions. Use `db.batch([...])` for atomic multi-statement writes; keep ≤100 bound params per statement (chunk bulk inserts).
- **Drizzle-kit quirks**: expression indexes (`ifnull(...)`) go in hand-written `--custom` migrations; partial-index `WHERE` uses `sql.raw` with unqualified column names. CI fails on schema drift.
- **Migrations**: forward-only and backward-compatible with the previously deployed Worker (expand/contract).
- **ID lists in SQL**: use `inJson(column, ids)` from `db/batch.ts` (one JSON param) instead of `inArray` to avoid D1's 100-param limit. Inside `db.batch`, use query builders only (`db.run(sql)` is not batchable on D1).
- **Bulk writes (D1 Free limits)**: never one statement per row. Use raw `env.DB.prepare(...).bind(JSON.stringify(rows))` with `INSERT … SELECT … FROM json_each(?)` in a single `env.DB.batch([...])` (see `services/imports.ts#commitImport`). Claim state transitions with conditional `UPDATE … WHERE status = ?` and check `meta.changes`.
- **Statement parsing** lives in `packages/shared/src/import` (pure, client + server). Add a bank: new `BankProfile` in `profiles.ts` + redacted fixture in `fixtures/<bank>/` + case in `golden.test.ts`, then `UPDATE_GOLDEN=1 pnpm --filter @kharcha/shared test golden` and review the JSON. XLSX fixtures come from `packages/shared/scripts/generate-fixtures.ts` (deterministic). `@kharcha/shared/spreadsheet` (SheetJS/PapaParse) must only be imported lazily by the web app, never by the Worker.
- **Hot paths in the Worker** (Free plan, 10 ms CPU): avoid per-row async/WebCrypto and all-pairs loops; bucket by key first. Benchmark changes with a temporary warm-median Vitest bench before claiming a speed-up.
- **Undo**: destructive or bulk operations write `audit_log` rows sharing a `batch_id`; `POST /api/undo/:batchId` replays them (`services/transactions.ts#undoBatch`).
- **Category identity**: seeded categories are referenced by `slug` (stable), never by ID or name.
- **Auth**: every `/api/*` request goes through `accessAuth` (Access JWT: JWKS signature, iss, aud, exp + `ALLOWED_EMAILS`). Dev bypass only when `AUTH_MODE=dev` + localhost + non-production. Errors: `{ error: { code, message, requestId } }` via `ApiException`.
- **Security headers**: API via `secureHeaders` middleware; static assets via `apps/web/public/_headers`.
- **UI**: mobile-first (360×800, 390×844), tap targets ≥44px (`min-h-11`), amounts through `<Money>` so privacy blur works, empty/loading states for every view. Every `flex-1` row that holds user text needs `min-w-0` + `truncate` (overflow makes phones zoom out). Sheets (`components/ui/sheet.tsx`, vaul) keep primary actions in a sticky bottom bar. List filters live in URL search params.
- **Tests**: shared = table-driven Vitest, ≥90% coverage. API = `@cloudflare/vitest-plugin` against real local D1 with migrations applied; `test/setup.ts` wipes all tables before each test (storage is shared within a file). Use `test/helpers.ts` (`postJson`, `categoryIdBySlug`, …). E2E tests share one dev user, so give created data unique names via `uid(testInfo)`. Web = Vitest + Testing Library. E2E = Playwright on mobile viewports against `wrangler dev`.
- Commits: Conventional Commits (`feat(api): …`, `fix(web): …`, `chore: …`).

## Pinned toolchain notes

- TypeScript 6.0.x (typescript-eslint doesn't support TS 7 yet).
- `@cloudflare/vitest-plugin` replaces the deprecated `@cloudflare/vitest-pool-workers`.
- pnpm `allowBuilds` in `pnpm-workspace.yaml` whitelists native install scripts (esbuild, workerd, sharp).
