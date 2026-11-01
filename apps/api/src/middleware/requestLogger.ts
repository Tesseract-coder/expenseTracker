import { createMiddleware } from 'hono/factory';
import { routePath } from 'hono/route';
import type { AppEnv } from '../env';
import { newId } from '../lib/ids';
import { log } from '../lib/logger';

export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = c.req.header('cf-ray') ?? newId();
  c.set('requestId', requestId);
  const start = Date.now();
  await next();
  c.header('x-request-id', requestId);
  log.info('request', {
    requestId,
    method: c.req.method,
    route: routePath(c), // matched pattern, never the raw URL (no query strings in logs)
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});
