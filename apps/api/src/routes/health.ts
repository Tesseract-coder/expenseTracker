import { Hono } from 'hono';
import type { HealthResponse } from '@kharcha/shared';
import type { AppEnv } from '../env';

export const healthRoutes = new Hono<AppEnv>().get('/', async (c) => {
  let db: HealthResponse['db'] = 'ok';
  try {
    await c.env.DB.prepare('select 1').first();
  } catch {
    db = 'error';
  }
  const body: HealthResponse = { status: 'ok', version: c.env.APP_VERSION, env: c.env.APP_ENV, db };
  return c.json(body, db === 'ok' ? 200 : 503);
});
