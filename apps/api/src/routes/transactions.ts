import { Hono } from 'hono';
import { z } from 'zod';
import {
  transactionCreateSchema,
  transactionListQuerySchema,
  transactionUpdateSchema,
} from '@kharcha/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { zv } from '../lib/validate';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTags,
  listTransactions,
  searchCounterparties,
  undoBatch,
  updateTransaction,
} from '../services/transactions';

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
  });

export const undoRoutes = new Hono<AppEnv>().post('/:token', async (c) => {
  const restored = await undoBatch(getDb(c.env.DB), c.get('user').id, c.req.param('token'));
  return c.json({ restored });
});

export const tagRoutes = new Hono<AppEnv>().get('/', async (c) =>
  c.json({ tags: await listTags(getDb(c.env.DB), c.get('user').id) }),
);

export const counterpartyRoutes = new Hono<AppEnv>().get(
  '/',
  zv('query', z.object({ q: z.string().trim().max(80).optional() })),
  async (c) =>
    c.json({
      counterparties: await searchCounterparties(
        getDb(c.env.DB),
        c.get('user').id,
        c.req.valid('query').q,
      ),
    }),
);
