import { Hono } from 'hono';
import { z } from 'zod';
import {
  bulkCategoryRequestSchema,
  confirmTransactionsSchema,
  counterpartyMergeSchema,
  counterpartyUpdateSchema,
  labelImpactQuerySchema,
  labelRequestSchema,
  transactionCreateSchema,
  transactionListQuerySchema,
  transactionUpdateSchema,
} from '@kharcha/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { zv } from '../lib/validate';
import { rateLimit } from '../middleware/rateLimit';
import { mergeCounterparty, renameCounterparty } from '../services/counterparties';
import { bulkCategorize, labelImpact, labelTransaction } from '../services/labels';
import {
  confirmTransactions,
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTags,
  listTransactions,
  searchCounterparties,
  updateTransaction,
} from '../services/transactions';
import { undoBatch } from '../services/undo';

export const transactionRoutes = new Hono<AppEnv>()
  .get('/', zv('query', transactionListQuerySchema), async (c) =>
    c.json(await listTransactions(getDb(c.env.DB), c.get('user').id, c.req.query())),
  )
  .post('/', zv('json', transactionCreateSchema), async (c) => {
    const transaction = await createTransaction(
      getDb(c.env.DB),
      c.get('user').id,
      c.req.valid('json'),
    );
    return c.json({ transaction }, 201);
  })
  .get('/:id', async (c) =>
    c.json({
      transaction: await getTransaction(getDb(c.env.DB), c.get('user').id, c.req.param('id')),
    }),
  )
  .patch('/:id', zv('json', transactionUpdateSchema), async (c) => {
    const transaction = await updateTransaction(
      getDb(c.env.DB),
      c.get('user').id,
      c.req.param('id'),
      c.req.valid('json'),
    );
    return c.json({ transaction });
  })
  .delete('/:id', async (c) => {
    const undoToken = await deleteTransaction(getDb(c.env.DB), c.get('user').id, c.req.param('id'));
    return c.json({ undoToken });
  })
  .post('/confirm', rateLimit('bulk'), zv('json', confirmTransactionsSchema), async (c) =>
    c.json({
      confirmed: await confirmTransactions(c.env.DB, c.get('user').id, c.req.valid('json').ids),
    }),
  )
  .post('/bulk-category', rateLimit('bulk'), zv('json', bulkCategoryRequestSchema), async (c) =>
    c.json(await bulkCategorize(getDb(c.env.DB), c.env.DB, c.get('user').id, c.req.valid('json'))),
  )
  .get('/:id/category/impact', zv('query', labelImpactQuerySchema), async (c) =>
    c.json(
      await labelImpact(
        getDb(c.env.DB),
        c.env.DB,
        c.get('user').id,
        c.req.param('id'),
        c.req.query() as never,
      ),
    ),
  )
  .patch('/:id/category', zv('json', labelRequestSchema), async (c) =>
    c.json(
      await labelTransaction(
        getDb(c.env.DB),
        c.env.DB,
        c.get('user').id,
        c.req.param('id'),
        c.req.valid('json'),
      ),
    ),
  );

export const undoRoutes = new Hono<AppEnv>().post('/:token', rateLimit('bulk'), async (c) => {
  const restored = await undoBatch(
    getDb(c.env.DB),
    c.env.DB,
    c.get('user').id,
    c.req.param('token'),
  );
  return c.json({ restored });
});

export const tagRoutes = new Hono<AppEnv>().get('/', async (c) =>
  c.json({ tags: await listTags(getDb(c.env.DB), c.get('user').id) }),
);

export const counterpartyRoutes = new Hono<AppEnv>()
  .get(
    '/',
    zv(
      'query',
      z.object({
        q: z.string().trim().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      }),
    ),
    async (c) => {
      const { q, limit } = c.req.valid('query');
      return c.json({
        counterparties: await searchCounterparties(getDb(c.env.DB), c.get('user').id, q, limit),
      });
    },
  )
  .patch('/:id', zv('json', counterpartyUpdateSchema), async (c) =>
    c.json({
      counterparty: await renameCounterparty(
        getDb(c.env.DB),
        c.get('user').id,
        c.req.param('id'),
        c.req.valid('json').displayName,
      ),
    }),
  )
  .post('/:id/merge', rateLimit('bulk'), zv('json', counterpartyMergeSchema), async (c) =>
    c.json({
      moved: await mergeCounterparty(
        getDb(c.env.DB),
        c.env.DB,
        c.get('user').id,
        c.req.param('id'),
        c.req.valid('json').targetId,
      ),
    }),
  );
