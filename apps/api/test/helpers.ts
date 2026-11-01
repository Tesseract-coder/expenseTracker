import { env } from 'cloudflare:workers';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { createApp } from '../src/app';
import type { Env } from '../src/env';

export const TEAM = 'kharcha-test.cloudflareaccess.com';
export const AUD = 'test-aud-123';

export async function makeKeys() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

export interface TokenOpts {
  email?: string | null;
  aud?: string;
  iss?: string;
  expiresIn?: string | number;
  key?: CryptoKey;
}

export async function signToken(privateKey: CryptoKey, opts: TokenOpts = {}) {
  const payload: Record<string, unknown> = {};
  if (opts.email !== null) payload.email = opts.email ?? 'me@example.com';
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '5m')
    .sign(opts.key ?? privateKey);
}

export function accessEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...env,
    AUTH_MODE: 'access',
    APP_ENV: 'test',
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ...overrides,
  };
}

export function devEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, AUTH_MODE: 'dev', APP_ENV: 'dev', ...overrides };
}

export function appWith(jwks: Awaited<ReturnType<typeof makeKeys>>['jwks']) {
  return createApp({ jwksProvider: () => jwks });
}

// ---------------------------------------------------------------------------- JSON client (dev auth)

const devApp = createApp();

export interface CallResult {
  status: number;
  body: any;
}

export async function call(method: string, path: string, body?: unknown): Promise<CallResult> {
  const res = await devApp.request(
    `http://localhost${path}`,
    {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    devEnv(),
  );
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

export const getJson = (path: string) => call('GET', path);
export const postJson = (path: string, body: unknown) => call('POST', path, body);
export const patchJson = (path: string, body: unknown) => call('PATCH', path, body);
export const del = (path: string) => call('DELETE', path);

/** Category id by seed slug for the dev user. */
export async function categoryIdBySlug(): Promise<Record<string, string>> {
  const { body } = await getJson('/api/categories');
  return Object.fromEntries(
    body.categories.filter((c: any) => c.slug).map((c: any) => [c.slug, c.id]),
  );
}

export async function cashAccountId(): Promise<string> {
  const { body } = await getJson('/api/accounts');
  return body.accounts.find((a: any) => a.type === 'cash').id;
}
