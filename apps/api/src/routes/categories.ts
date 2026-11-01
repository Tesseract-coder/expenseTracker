import { Hono } from 'hono';
import { categoryCreateSchema, categoryMergeSchema, categoryUpdateSchema } from '@kharcha/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { zv } from '../lib/validate';
import {
  createCategory,
  listCategories,
  mergeCategory,
  updateCategory,
} from '../services/categories';

export const categoryRoutes = new Hono<AppEnv>()
  .get('/', async (c) =>
    c.json({ categories: await listCategories(getDb(c.env.DB), c.get('user').id) }),
  )
  .post('/', zv('json', categoryCreateSchema), async (c) => {
    const category = await createCategory(getDb(c.env.DB), c.get('user').id, c.req.valid('json'));
    return c.json({ category }, 201);
  })
  .patch('/:id', zv('json', categoryUpdateSchema), async (c) => {
    const category = await updateCategory(
      getDb(c.env.DB),
      c.get('user').id,
      c.req.param('id'),
      c.req.valid('json'),
    );
    return c.json({ category });
  })
  .post('/:id/merge', zv('json', categoryMergeSchema), async (c) => {
    const result = await mergeCategory(
      getDb(c.env.DB),
      c.get('user').id,
      c.req.param('id'),
      c.req.valid('json').targetId,
    );
    return c.json(result);
  });
