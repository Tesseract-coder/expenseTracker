import { beforeAll, describe, expect, it } from 'vitest';
import { meResponseSchema } from '@kharcha/shared';
import { createApp } from '../src/app';
import { accessEnv, appWith, devEnv, makeKeys, signToken } from './helpers';

let keys: Awaited<ReturnType<typeof makeKeys>>;
let otherKeys: Awaited<ReturnType<typeof makeKeys>>;

beforeAll(async () => {
  keys = await makeKeys();
  otherKeys = await makeKeys();
});

const PROD_URL = 'https://kharcha.kunalnevrekar.workers.dev';

describe('Access JWT verification', () => {
  it('rejects requests without a token (401)', async () => {
    const res = await appWith(keys.jwks).request(`${PROD_URL}/api/me`, {}, accessEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it.each([
    ['garbage token', async () => 'not.a.jwt'],
    ['wrong signing key', async () => signToken(keys.privateKey, { key: otherKeys.privateKey })],
    ['wrong audience', async () => signToken(keys.privateKey, { aud: 'someone-else' })],
    [
      'wrong issuer',
      async () => signToken(keys.privateKey, { iss: 'https://evil.cloudflareaccess.com' }),
    ],
    [
      'expired',
      async () => signToken(keys.privateKey, { expiresIn: Math.floor(Date.now() / 1000) - 60 }),
    ],
  ])('rejects %s (401)', async (_name, makeToken) => {
    const res = await appWith(keys.jwks).request(
      `${PROD_URL}/api/me`,
      { headers: { 'cf-access-jwt-assertion': await makeToken() } },
      accessEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('rejects valid tokens for emails not on the allow-list (403)', async () => {
    const token = await signToken(keys.privateKey, { email: 'intruder@example.com' });
    const res = await appWith(keys.jwks).request(
      `${PROD_URL}/api/me`,
      { headers: { 'cf-access-jwt-assertion': token } },
      accessEnv(),
    );
    expect(res.status).toBe(403);
  });

  it('accepts a valid token via header and provisions the user', async () => {
    const token = await signToken(keys.privateKey, { email: 'Me@Example.com' });
    const res = await appWith(keys.jwks).request(
      `${PROD_URL}/api/me`,
      { headers: { 'cf-access-jwt-assertion': token } },
      accessEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: 'me@example.com' });
  });

  it('accepts a valid token via CF_Authorization cookie', async () => {
    const token = await signToken(keys.privateKey);
    const res = await appWith(keys.jwks).request(
      `${PROD_URL}/api/me`,
      { headers: { cookie: `foo=bar; CF_Authorization=${token}` } },
      accessEnv(),
    );
    expect(res.status).toBe(200);
  });

  it('lets service tokens (no email) reach only /api/health', async () => {
    const token = await signToken(keys.privateKey, { email: null });
    const headers = { 'cf-access-jwt-assertion': token };
    const app = appWith(keys.jwks);
    expect((await app.request(`${PROD_URL}/api/health`, { headers }, accessEnv())).status).toBe(
      200,
    );
    expect((await app.request(`${PROD_URL}/api/me`, { headers }, accessEnv())).status).toBe(403);
  });

  it('fails closed when Access config is missing (500)', async () => {
    const token = await signToken(keys.privateKey);
    const res = await appWith(keys.jwks).request(
      `${PROD_URL}/api/me`,
      { headers: { 'cf-access-jwt-assertion': token } },
      accessEnv({ ACCESS_AUD: '' }),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: 'auth_misconfigured' } });
  });
});

describe('dev auth bypass', () => {
  it('works on localhost', async () => {
    const res = await createApp().request('http://localhost:8787/api/me', {}, devEnv());
    expect(res.status).toBe(200);
    // Must satisfy the shared response schema the web client validates with.
    expect(meResponseSchema.parse(await res.json())).toMatchObject({ email: 'dev@kharcha.local' });
  });

  it('refuses on a non-local host', async () => {
    const res = await createApp().request(`${PROD_URL}/api/me`, {}, devEnv());
    expect(res.status).toBe(500);
  });

  it('refuses when APP_ENV is production even on localhost', async () => {
    const res = await createApp().request(
      'http://localhost/api/me',
      {},
      devEnv({ APP_ENV: 'production' }),
    );
    expect(res.status).toBe(500);
  });
});
