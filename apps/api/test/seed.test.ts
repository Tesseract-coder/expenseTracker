import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { flattenCategorySeed } from '@kharcha/shared';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { seedUserDefaults } from '../src/services/seed';

describe('seedUserDefaults', () => {
  it('survives concurrent first-login seeding without FK errors or duplicates', async () => {
    const db = getDb(env.DB);
    await db.insert(users).values({ id: 'u1', email: 'race@example.com' });

    await Promise.all([
      seedUserDefaults(db, 'u1'),
      seedUserDefaults(db, 'u1'),
      seedUserDefaults(db, 'u1'),
    ]);

    const rows = await env.DB.prepare(
      `select c.slug, p.slug as parent_slug from categories c
       left join categories p on p.id = c.parent_id where c.user_id = 'u1'`,
    ).all<{ slug: string; parent_slug: string | null }>();
    const seed = flattenCategorySeed();
    expect(rows.results).toHaveLength(seed.length);
    const actual = new Map(rows.results.map((r) => [r.slug, r.parent_slug]));
    for (const c of seed) expect(actual.get(c.slug)).toBe(c.parentSlug);
  });

  it('fills in only missing categories on re-seed and keeps user edits', async () => {
    const db = getDb(env.DB);
    await db.insert(users).values({ id: 'u2', email: 'edit@example.com' });
    await seedUserDefaults(db, 'u2');
    await env.DB.batch([
      env.DB.prepare(
        "update categories set name = 'Sabzi & kirana' where user_id = 'u2' and slug = 'grocery'",
      ),
      env.DB.prepare("delete from categories where user_id = 'u2' and slug = 'crypto'"),
      env.DB.prepare("delete from settings where user_id = 'u2' and key = 'category_seed_version'"),
    ]);

    await seedUserDefaults(db, 'u2');

    const grocery = await env.DB.prepare(
      "select name from categories where user_id = 'u2' and slug = 'grocery'",
    ).first<{ name: string }>();
    expect(grocery?.name).toBe('Sabzi & kirana');
    const crypto = await env.DB.prepare(
      "select p.slug as parent from categories c join categories p on p.id = c.parent_id where c.user_id = 'u2' and c.slug = 'crypto'",
    ).first<{ parent: string }>();
    expect(crypto?.parent).toBe('investment');
  });
});
