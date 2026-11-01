import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { ApiException } from '../lib/errors';

/**
 * Per-user rate limit for expensive endpoints (uploads, bulk writes) using the Workers Rate
 * Limiting binding. If the binding isn't configured (e.g. a stripped-down env) requests pass.
 */
export const rateLimit = (scope: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const limiter = c.env.UPLOAD_LIMITER;
    if (limiter) {
      const { success } = await limiter.limit({ key: `${scope}:${c.get('user').id}` });
      if (!success)
        throw new ApiException(429, 'rate_limited', 'Too many requests. Please wait a minute.');
    }
    await next();
  });
