# Kharcha

Personal expense and cash-flow tracker: a mobile-first PWA on Cloudflare Workers, D1 and R2.

```bash
nvm use && corepack enable && pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm db:migrate:local
pnpm dev                     # http://localhost:5173
```

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Data model: [docs/DATA_MODEL.md](docs/DATA_MODEL.md)
- Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Conventions for contributors and agents: [CLAUDE.md](CLAUDE.md)
