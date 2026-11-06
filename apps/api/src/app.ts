import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import { notFound } from './lib/errors';
import { accessAuth, type JwksProvider } from './middleware/accessAuth';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { sameOrigin } from './middleware/sameOrigin';
import { accountRoutes } from './routes/accounts';
import { alertRoutes } from './routes/alerts';
import { backupRoutes } from './routes/backup';
import { categoryRoutes } from './routes/categories';
import {
  categorizationRoutes,
  inboxRoutes,
  learnedLabelRoutes,
  ruleRoutes,
} from './routes/categorization';
import { healthRoutes } from './routes/health';
import { importRoutes, parserProfileRoutes } from './routes/imports';
import { meRoutes } from './routes/me';
import {
  budgetRoutes,
  exportRoutes,
  recurringRoutes,
  reportRoutes,
  settingsRoutes,
} from './routes/reports';
import {
  counterpartyRoutes,
  tagRoutes,
  transactionRoutes,
  undoRoutes,
} from './routes/transactions';

export interface AppDeps {
  jwksProvider?: JwksProvider;
}

export function createApp(deps: AppDeps = {}) {
  const api = new Hono<AppEnv>()
    .use(requestLogger)
    .use(
      secureHeaders({
        // API responses are JSON only; static assets get their headers from apps/web/public/_headers.
        contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
        strictTransportSecurity: 'max-age=63072000; includeSubDomains',
        referrerPolicy: 'no-referrer',
        crossOriginResourcePolicy: 'same-origin',
      }),
    )
    .use(async (c, next) => {
      await next();
      c.header('cache-control', 'no-store');
    })
    .use(sameOrigin)
    .use(accessAuth(deps.jwksProvider))
    .route('/health', healthRoutes)
    .route('/me', meRoutes)
    .route('/accounts', accountRoutes)
    .route('/categories', categoryRoutes)
    .route('/transactions', transactionRoutes)
    .route('/tags', tagRoutes)
    .route('/counterparties', counterpartyRoutes)
    .route('/undo', undoRoutes)
    .route('/imports', importRoutes)
    .route('/parser-profiles', parserProfileRoutes)
    .route('/alerts', alertRoutes)
    .route('/inbox', inboxRoutes)
    .route('/categorization', categorizationRoutes)
    .route('/rules', ruleRoutes)
    .route('/learned-labels', learnedLabelRoutes)
    .route('/reports', reportRoutes)
    .route('/budgets', budgetRoutes)
    .route('/recurring', recurringRoutes)
    .route('/settings', settingsRoutes)
    .route('/export', exportRoutes)
    .route('/backup', backupRoutes);

  api.onError(errorHandler);

  const app = new Hono<AppEnv>().route('/api', api);
  app.notFound((c) => errorHandler(notFound('No such route'), c));
  app.onError(errorHandler);
  return app;
}

export type ApiRoutes = ReturnType<typeof createApp>;
