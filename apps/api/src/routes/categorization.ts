import { Hono } from 'hono';
import {
  aiSuggestRequestSchema,
  categorizationRunRequestSchema,
  inboxQuerySchema,
  learnedLabelUpdateSchema,
  ruleApplyRequestSchema,
  ruleCreateSchema,
  ruleReorderSchema,
  ruleTestRequestSchema,
  ruleUpdateSchema,
} from '@kharcha/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { zv } from '../lib/validate';
import { isContinuation, rateLimit } from '../middleware/rateLimit';
import { suggestCategories } from '../services/ai';
import { runCategorizationChunk } from '../services/categorization';
import { reviewCount } from '../services/transactions';
import { getInbox, inboxCount } from '../services/labels';
import {
  deleteLearnedLabel,
  listLearnedLabels,
  updateLearnedLabel,
} from '../services/learnedLabels';
import {
  applyRule,
  createRule,
  deleteRule,
  getRule,
  listRules,
  reorderRules,
  testRule,
  updateRule,
} from '../services/rules';

export const inboxRoutes = new Hono<AppEnv>()
  .get('/', zv('query', inboxQuerySchema), async (c) =>
    c.json(await getInbox(getDb(c.env.DB), c.get('user').id, c.req.query())),
  )
  .get('/count', async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get('user').id;
    const [count, review] = await Promise.all([inboxCount(db, userId), reviewCount(db, userId)]);
    return c.json({ count, review });
  });

export const categorizationRoutes = new Hono<AppEnv>()
  .post('/ai-suggest', rateLimit('ai'), zv('json', aiSuggestRequestSchema), async (c) =>
    c.json(await suggestCategories(c.env, c.get('user').id, c.req.valid('json').transactionIds)),
  )
  .post(
    '/run',
    rateLimit('bulk', { skip: isContinuation }),
    zv('json', categorizationRunRequestSchema),
    async (c) => {
      const body = c.req.valid('json');
      return c.json(
        await runCategorizationChunk(
          getDb(c.env.DB),
          c.env.DB,
          c.get('user').id,
          { kind: body.scope },
          body,
        ),
      );
    },
  );

export const ruleRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ rules: await listRules(getDb(c.env.DB), c.get('user').id) }))
  .post('/', zv('json', ruleCreateSchema), async (c) =>
    c.json({ rule: await createRule(getDb(c.env.DB), c.get('user').id, c.req.valid('json')) }, 201),
  )
  .post('/reorder', zv('json', ruleReorderSchema), async (c) =>
    c.json({
      rules: await reorderRules(
        c.env.DB,
        getDb(c.env.DB),
        c.get('user').id,
        c.req.valid('json').ids,
      ),
    }),
  )
  .post('/test', rateLimit('bulk'), zv('json', ruleTestRequestSchema), async (c) =>
    c.json(await testRule(c.env.DB, c.get('user').id, c.req.valid('json').conditions)),
  )
  .get('/:id', async (c) =>
    c.json({ rule: await getRule(getDb(c.env.DB), c.get('user').id, c.req.param('id')) }),
  )
  .patch('/:id', zv('json', ruleUpdateSchema), async (c) =>
    c.json({
      rule: await updateRule(
        getDb(c.env.DB),
        c.get('user').id,
        c.req.param('id'),
        c.req.valid('json'),
      ),
    }),
  )
  .delete('/:id', async (c) => {
    await deleteRule(getDb(c.env.DB), c.get('user').id, c.req.param('id'));
    return c.body(null, 204);
  })
  .post(
    '/:id/apply',
    rateLimit('bulk', { skip: isContinuation }),
    zv('json', ruleApplyRequestSchema),
    async (c) =>
      c.json(
        await applyRule(
          getDb(c.env.DB),
          c.env.DB,
          c.get('user').id,
          c.req.param('id'),
          c.req.valid('json'),
        ),
      ),
  );

export const learnedLabelRoutes = new Hono<AppEnv>()
  .get('/', async (c) =>
    c.json({ labels: await listLearnedLabels(getDb(c.env.DB), c.get('user').id) }),
  )
  .patch('/:id', zv('json', learnedLabelUpdateSchema), async (c) =>
    c.json({
      label: await updateLearnedLabel(
        getDb(c.env.DB),
        c.get('user').id,
        c.req.param('id'),
        c.req.valid('json'),
      ),
    }),
  )
  .delete('/:id', async (c) => {
    await deleteLearnedLabel(getDb(c.env.DB), c.get('user').id, c.req.param('id'));
    return c.body(null, 204);
  });
