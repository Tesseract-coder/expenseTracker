# Changelog

## Phase 0 — Foundation (2026-11-01)

- pnpm monorepo (`apps/web`, `apps/api`, `packages/shared`) with strict TypeScript, ESLint (flat), Prettier, Husky + lint-staged.
- `packages/shared`: INR money helpers (Indian grouping, paise parsing), IST date/week/FY helpers, versioned category seed (69 categories incl. system), shared enums and Zod API schemas. 100% coverage.
- D1 schema for all 16 tables via Drizzle, with CHECK constraints, report indexes and partial indexes; migrations `0000_init` and `0001_expression_indexes`.
- Hono Worker: Access JWT middleware (JWKS, iss/aud/exp, email allow-list, service-token health access, fail-closed dev bypass), secure headers, structured PII-free logging, JSON errors, `GET /api/health`, `/api/me`, `/api/categories`. Idempotent, concurrency-safe per-user seeding on first login.
- React 19 PWA shell: bottom nav (Home · Transactions · Add · Reports · More), dark/light/system theme, privacy blur, installable manifest + generated icons, offline app shell (API responses are never cached by the SW), update prompt.
- `wrangler.toml` with dev / preview / production environments on `*.kunalnevrekar.workers.dev`.
- CI (format, lint, typecheck, schema drift, build, coverage, Playwright E2E), opt-in preview/production deploy workflows, Dependabot, `scripts/bootstrap-cloudflare.sh`, `docs/DEPLOYMENT.md`.
