import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AppEnv, Env } from '../env';
import { ApiException, forbidden, unauthorized } from '../lib/errors';
import { log } from '../lib/logger';
import { resolveUser } from '../services/users';

export type JwksProvider = (teamDomain: string) => JWTVerifyGetKey;

// One JWKS fetcher per team domain per isolate; jose caches keys and handles rotation.
const jwksCache = new Map<string, JWTVerifyGetKey>();
export const remoteJwks: JwksProvider = (teamDomain) => {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const DEV_USER_EMAIL = 'dev@kharcha.local';

function allowedEmails(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

function readToken(header: string | undefined, cookie: string | undefined): string | undefined {
  if (header) return header;
  const m = cookie ? /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie) : null;
  return m?.[1];
}

/**
 * Verifies the Cloudflare Access JWT on every request (signature via team JWKS, iss, aud, exp)
 * and resolves the app user. Dev bypass requires AUTH_MODE=dev AND a localhost host AND a
 * non-production APP_ENV, so a misconfigured deployment cannot skip auth.
 */
export function accessAuth(jwksProvider: JwksProvider = remoteJwks) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const env = c.env;

    if (env.AUTH_MODE === 'dev') {
      const host = new URL(c.req.url).hostname;
      if (env.APP_ENV === 'production' || !LOCAL_HOSTS.has(host)) {
        log.error('auth_misconfigured', { requestId: c.get('requestId') });
        throw new ApiException(500, 'auth_misconfigured', 'Server auth is misconfigured');
      }
      c.set('user', await resolveUser(env.DB, DEV_USER_EMAIL));
      return next();
    }

    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
      log.error('auth_misconfigured', { requestId: c.get('requestId') });
      throw new ApiException(500, 'auth_misconfigured', 'Server auth is misconfigured');
    }

    const token = readToken(c.req.header('cf-access-jwt-assertion'), c.req.header('cookie'));
    if (!token) throw unauthorized();

    let email: unknown;
    try {
      const { payload } = await jwtVerify(token, jwksProvider(env.ACCESS_TEAM_DOMAIN), {
        issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
        audience: env.ACCESS_AUD,
        algorithms: ['RS256'],
        requiredClaims: ['exp'],
      });
      email = payload.email;
    } catch {
      throw unauthorized('Invalid or expired access token');
    }

    // Service tokens (CI smoke tests) carry no email; they may only reach /api/health.
    if (typeof email !== 'string' || email === '') {
      if (c.req.path === '/api/health') return next();
      throw forbidden('Token has no user identity');
    }

    const normalized = email.toLowerCase();
    if (!allowedEmails(env).has(normalized)) throw forbidden('User is not allowed');

    c.set('user', await resolveUser(env.DB, normalized));
    return next();
  });
}
