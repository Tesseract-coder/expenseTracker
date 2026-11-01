import { Hono } from 'hono';
import { accountCreateSchema, accountUpdateSchema } from '@kharcha/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { zv } from '../lib/validate';
import {
  createAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from '../services/accounts';

export const accountRoutes = new Hono<AppEnv>()
  .get('/', async (c) =>
    c.json({ accounts: await listAccounts(getDb(c.env.DB), c.get('user').id) }),
  )
  .post('/', zv('json', accountCreateSchema), async (c) => {
    const account = await createAccount(getDb(c.env.DB), c.get('user').id, c.req.valid('json'));
    return c.json({ account }, 201);
  })
  .get('/:id', async (c) =>
    c.json({ account: await getAccount(getDb(c.env.DB), c.get('user').id, c.req.param('id')) }),
  )
  .patch('/:id', zv('json', accountUpdateSchema), async (c) => {
    const account = await updateAccount(
      getDb(c.env.DB),
      c.get('user').id,
      c.req.param('id'),
      c.req.valid('json'),
    );
    return c.json({ account });
  })
  .delete('/:id', async (c) => {
    await deleteAccount(getDb(c.env.DB), c.get('user').id, c.req.param('id'));
    return c.body(null, 204);
  });
