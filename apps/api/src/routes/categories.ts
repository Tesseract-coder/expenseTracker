import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import type { CategoryListResponse } from '@kharcha/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { categories } from '../db/schema';

export const categoryRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const rows = await getDb(c.env.DB)
    .select()
    .from(categories)
    .where(eq(categories.userId, c.get('user').id))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return c.json<CategoryListResponse>({
    categories: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      parentId: r.parentId,
      name: r.name,
      type: r.type,
      systemKey: r.systemKey,
      icon: r.icon,
      color: r.color,
      archived: r.archived === 1,
      sortOrder: r.sortOrder,
    })),
  });
});
