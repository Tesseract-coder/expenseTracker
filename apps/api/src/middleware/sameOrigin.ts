import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../env';
import { ApiException } from '../lib/errors';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF guard. The API also accepts the Access cookie (CF_Authorization), and multipart uploads
 * are "simple" requests a hostile page could submit cross-site. Browsers label every request
 * with Sec-Fetch-Site and, on writes, Origin: anything that isn't this origin is refused.
 * Requests without these headers (curl, service tokens, tests) carry no ambient cookie risk.
 */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (UNSAFE.has(c.req.method)) {
    const site = c.req.header('sec-fetch-site');
    const origin = c.req.header('origin');
    const url = new URL(c.req.url);
    const host = c.req.header('host') ?? url.host;
    const crossSite = site !== undefined && site !== 'same-origin' && site !== 'none';
    let foreignOrigin = false;
    if (origin !== undefined) {
      try {
        foreignOrigin = new URL(origin).host !== host;
      } catch {
        foreignOrigin = true; // "null" or garbage
      }
    }
    if (crossSite || foreignOrigin)
      throw new ApiException(403, 'cross_site', 'Cross-site requests are not allowed');
  }
  await next();
});
