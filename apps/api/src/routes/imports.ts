import { Hono } from 'hono';
import {
  importCommitRequestSchema,
  importPreviewRequestSchema,
  parserProfileCreateSchema,
} from '@kharcha/shared';
import type { AppEnv } from '../env';
import { getDb } from '../db/client';
import { ApiException } from '../lib/errors';
import { zv } from '../lib/validate';
import { rateLimit } from '../middleware/rateLimit';
import {
  commitImport,
  getImportFile,
  listImports,
  previewImport,
  revertImport,
  uploadStatement,
} from '../services/imports';
import { createParserProfile, listParserProfiles } from '../services/parserProfiles';

export const importRoutes = new Hono<AppEnv>()
  .get('/', async (c) => c.json({ imports: await listImports(getDb(c.env.DB), c.get('user').id) }))
  .post('/', rateLimit('upload'), async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    const accountId = body.accountId;
    if (!(file instanceof File) || typeof accountId !== 'string' || !accountId) {
      throw new ApiException(400, 'validation_error', 'Choose an account and a statement file');
    }
    const result = await uploadStatement(getDb(c.env.DB), c.env, c.get('user').id, accountId, file);
    return c.json(result, 201);
  })
  .post('/:id/preview', rateLimit('import'), zv('json', importPreviewRequestSchema), async (c) =>
    c.json(
      await previewImport(
        getDb(c.env.DB),
        c.env,
        c.get('user').id,
        c.req.param('id'),
        c.req.valid('json'),
      ),
    ),
  )
  .post('/:id/commit', rateLimit('import'), zv('json', importCommitRequestSchema), async (c) =>
    c.json(
      await commitImport(
        getDb(c.env.DB),
        c.env,
        c.get('user').id,
        c.req.param('id'),
        c.req.valid('json'),
      ),
    ),
  )
  .post('/:id/revert', rateLimit('import'), async (c) =>
    c.json({
      deleted: await revertImport(getDb(c.env.DB), c.env, c.get('user').id, c.req.param('id')),
    }),
  )
  .get('/:id/file', async (c) => {
    const { obj, fileName } = await getImportFile(
      getDb(c.env.DB),
      c.env,
      c.get('user').id,
      c.req.param('id'),
    );
    return new Response(obj.body, {
      headers: {
        'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${fileName.replace(/[^\w.\- ]/g, '_')}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  });

export const parserProfileRoutes = new Hono<AppEnv>()
  .get('/', async (c) =>
    c.json({ profiles: await listParserProfiles(getDb(c.env.DB), c.get('user').id) }),
  )
  .post('/', zv('json', parserProfileCreateSchema), async (c) => {
    const profile = await createParserProfile(
      getDb(c.env.DB),
      c.get('user').id,
      c.req.valid('json'),
    );
    return c.json({ profile }, 201);
  });
