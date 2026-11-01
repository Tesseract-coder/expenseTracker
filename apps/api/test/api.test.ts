import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  categoryListResponseSchema,
  flattenCategorySeed,
  healthResponseSchema,
} from '@kharcha/shared';
import { createApp } from '../src/app';
import { clearUserCache } from '../src/services/users';
import { devEnv } from './helpers';

const app = createApp();
const get = (path: string) => app.request(`http://localhost${path}`, {}, devEnv());

describe('GET /api/health', () => {
  it('reports ok with db status', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('sets security and caching headers', async () => {
    const res = await get('/api/health');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });
});

describe('first-login seeding', () => {
  it('seeds the full category tree with parents linked', async () => {
    const res = await get('/api/categories');
    expect(res.status).toBe(200);
    const { categories } = categoryListResponseSchema.parse(await res.json());
    const seed = flattenCategorySeed();
    expect(categories).toHaveLength(seed.length);

    const bySlug = new Map(categories.map((c) => [c.slug, c]));
    const grocery = bySlug.get('grocery');
    expect(grocery?.parentId).toBe(bySlug.get('household')?.id);
    expect(bySlug.get('atm_cash')).toMatchObject({ type: 'transfer', systemKey: 'atm_cash' });
  });

  it('is idempotent across repeated logins', async () => {
    await get('/api/categories');
    clearUserCache();
    await get('/api/me');
    const { results } = await env.DB.prepare('select count(*) as n from categories').all<{
      n: number;
    }>();
    expect(results[0]?.n).toBe(flattenCategorySeed().length);
    const settings = await env.DB.prepare(
      "select value from settings where key = 'year_mode'",
    ).first<{ value: string }>();
    expect(JSON.parse(settings?.value ?? 'null')).toBe('calendar');
  });

  it('enforces the paise CHECK constraint at the DB level', async () => {
    await get('/api/me');
    const user = await env.DB.prepare('select id from users').first<{ id: string }>();
    const acct = env.DB.prepare(
      "insert into accounts (id, user_id, name, type, opening_balance_date, created_at, updated_at) values ('a1', ?, 'Cash', 'cash', '2026-01-01', 0, 0)",
    ).bind(user?.id);
    await acct.run();
    const bad = env.DB.prepare(
      "insert into transactions (id, user_id, account_id, txn_date, week_start, dow, amount_paise, direction, source, fingerprint, is_split, created_at, updated_at) values ('t1', ?, 'a1', '2026-01-01', '2025-12-29', 4, -5, 'out', 'manual', 'f', 1, 0, 0)",
    ).bind(user?.id);
    await expect(bad.run()).rejects.toThrow(/CHECK constraint/);
  });
});

describe('routing', () => {
  it('returns JSON 404 for unknown API routes', async () => {
    const res = await get('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
