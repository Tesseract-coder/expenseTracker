import { Hono } from 'hono';
import {
  backupPageQuerySchema,
  restoreChunkSchema,
  restoreFinishSchema,
  restoreStartSchema,
} from '@kharcha/shared';
import type { AppEnv } from '../env';
import { zv } from '../lib/validate';
import { rateLimit } from '../middleware/rateLimit';
import {
  backupStatus,
  exportPage,
  finishRestore,
  restoreChunk,
  startRestore,
} from '../services/backup';

/**
 * Backup export pages and the three-step restore. Only the first export page and the restore
 * start count against the rate limit; chunks need the id of a running restore.
 */
export const backupRoutes = new Hono<AppEnv>()
  .get(
    '/',
    rateLimit('backup', {
      skip: async (c) =>
        c.req.query('table') !== 'parser_profiles' || c.req.query('after') !== undefined,
    }),
    zv('query', backupPageQuerySchema),
    async (c) => {
      const { table, after } = c.req.valid('query');
      return c.json(await exportPage(c.env.DB, c.get('user').id, table, after));
    },
  )
  .get('/status', async (c) => c.json(await backupStatus(c.env.DB, c.get('user').id)))
  .post('/restore', rateLimit('backup'), zv('json', restoreStartSchema), async (c) =>
    c.json(await startRestore(c.env.DB, c.get('user').id, c.req.valid('json').counts), 201),
  )
  .post('/restore/chunk', zv('json', restoreChunkSchema), async (c) =>
    c.json(await restoreChunk(c.env.DB, c.get('user').id, c.req.valid('json'))),
  )
  .post('/restore/finish', zv('json', restoreFinishSchema), async (c) =>
    c.json(await finishRestore(c.env.DB, c.get('user').id, c.req.valid('json').restoreId)),
  );
