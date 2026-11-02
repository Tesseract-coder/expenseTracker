import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { ApiException } from '../lib/errors';

/**
 * Per-user rate limit for expensive endpoints (uploads, bulk writes) using the Workers Rate
 * Limiting binding. If the binding isn't configured (e.g. a stripped-down env) requests pass.
 */
export const rateLimit = (
  scope: string,
  opts: { skip?: (c: Context<AppEnv>) => Promise<boolean> } = {},
) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const limiter = c.env.UPLOAD_LIMITER;
    if (limiter && !(await opts.skip?.(c))) {
      const { success } = await limiter.limit({ key: `${scope}:${c.get('user').id}` });
      if (!success)
        throw new ApiException(429, 'rate_limited', 'Too many requests. Please wait a minute.');
    }
    await next();
  });

/**
 * Chunked jobs (re-run categorization, apply rule) are limited once per run: continuation
 * requests carry the cursor returned by the previous chunk and are not counted again.
 */
export const isContinuation = async (c: Context<AppEnv>): Promise<boolean> => {
  try {
    const body: unknown = await c.req.json();
    return (
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { cursor?: unknown }).cursor === 'string'
    );
  } catch {
    return false;
  }
};
