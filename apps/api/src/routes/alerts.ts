import { Hono } from 'hono';
import { alertsCommitRequestSchema, alertsPreviewRequestSchema } from '@kharcha/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { zv } from '../lib/validate';
import { rateLimit } from '../middleware/rateLimit';
import { commitAlerts, previewAlerts } from '../services/alerts';

/** Pasted SMS alerts: parsed in the browser, checked and committed here (one import per account). */
export const alertRoutes = new Hono<AppEnv>()
  .post('/preview', rateLimit('import'), zv('json', alertsPreviewRequestSchema), async (c) =>
    c.json(await previewAlerts(getDb(c.env.DB), c.env, c.get('user').id, c.req.valid('json'))),
  )
  .post('/commit', rateLimit('import'), zv('json', alertsCommitRequestSchema), async (c) =>
    c.json(await commitAlerts(getDb(c.env.DB), c.env, c.get('user').id, c.req.valid('json'))),
  );
