import { Hono } from 'hono';
import { z } from 'zod';
import {
  budgetUpsertSchema,
  healthScoreQuerySchema,
  monthKeySchema,
  recurringUpdateSchema,
  reportQuerySchema,
  settingsPatchSchema,
  transactionListQuerySchema,
  trendsQuerySchema,
} from '@kharcha/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { zv } from '../lib/validate';
import { rateLimit } from '../middleware/rateLimit';
import { deleteBudget, listBudgets, upsertBudget } from '../services/budgets';
import { exportTransactions } from '../services/export';
import { healthScore } from '../services/health';
import { listRecurring, refreshRecurring, setRecurringDismissed } from '../services/recurring';
import { summary, trends, whenReport, whereReport } from '../services/reports';
import { getSettings, updateSettings } from '../services/settings';

// Query strings are validated by zv and re-parsed (with transforms) inside the services.
const query = <T>(c: { req: { query: () => Record<string, string> } }) => c.req.query() as T;

export const reportRoutes = new Hono<AppEnv>()
  .get('/summary', zv('query', reportQuerySchema), async (c) =>
    c.json(await summary(c.env.DB, c.get('user').id, query(c))),
  )
  .get('/trends', zv('query', trendsQuerySchema), async (c) =>
    c.json(await trends(c.env.DB, c.get('user').id, query(c))),
  )
  .get('/when', zv('query', reportQuerySchema), async (c) =>
    c.json(await whenReport(c.env.DB, c.get('user').id, query(c))),
  )
  .get('/where', zv('query', reportQuerySchema), async (c) =>
    c.json(await whereReport(c.env.DB, c.get('user').id, query(c))),
  )
  .get('/health', zv('query', healthScoreQuerySchema), async (c) =>
    c.json(await healthScore(c.env.DB, c.get('user').id, query(c))),
  );

const budgetListQuery = z.object({
  month: monthKeySchema,
  accountIds: z.string().max(2000).optional(),
});

export const budgetRoutes = new Hono<AppEnv>()
  .get('/', zv('query', budgetListQuery), async (c) => {
    const { month, accountIds } = c.req.valid('query');
    return c.json(
      await listBudgets(c.env.DB, c.get('user').id, month, accountIds?.split(',').filter(Boolean)),
    );
  })
  .put('/', zv('json', budgetUpsertSchema), async (c) =>
    c.json(await upsertBudget(c.env.DB, c.get('user').id, c.req.valid('json'))),
  )
  .delete('/:id', async (c) => {
    await deleteBudget(c.env.DB, c.get('user').id, c.req.param('id'));
    return c.body(null, 204);
  });

export const recurringRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listRecurring(c.env.DB, c.get('user').id)))
  .post('/refresh', rateLimit('bulk'), async (c) => {
    await refreshRecurring(c.env.DB, c.get('user').id);
    return c.json(await listRecurring(c.env.DB, c.get('user').id));
  })
  .patch('/:id', zv('json', recurringUpdateSchema), async (c) => {
    await setRecurringDismissed(
      c.env.DB,
      c.get('user').id,
      c.req.param('id'),
      c.req.valid('json').dismissed,
    );
    return c.json(await listRecurring(c.env.DB, c.get('user').id));
  });

export const settingsRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ settings: await getSettings(c.env.DB, c.get('user').id) }))
  .patch('/', zv('json', settingsPatchSchema), async (c) =>
    c.json({ settings: await updateSettings(c.env.DB, c.get('user').id, c.req.valid('json')) }),
  );

export const exportRoutes = new Hono<AppEnv>().get(
  '/transactions',
  rateLimit('export'),
  zv(
    'query',
    transactionListQuerySchema.extend({ withPayees: z.enum(['true', 'false']).optional() }),
  ),
  async (c) =>
    c.json(await exportTransactions(getDb(c.env.DB), c.env.DB, c.get('user').id, query(c))),
);
