import { and, eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { CATEGORY_SEED_VERSION, flattenCategorySeed, toIstDate } from '@kharcha/shared';
import type { Db } from '../db/client';
import { accounts, categories, settings } from '../db/schema';
import { newId } from '../lib/ids';

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  year_mode: 'calendar',
  targets: { savingsRate: 0.2, needs: 0.5, wants: 0.3, savings: 0.2, emergencyMonths: 6 },
  emergency_fund_paise: null,
  privacy_blur_default: false,
  atm_as_spend: false,
  ai_enabled: false,
  my_vpas: [],
};

const SEED_VERSION_KEY = 'category_seed_version';

/**
 * Idempotently seeds default categories and settings for a user. Safe to run repeatedly and
 * concurrently: inserts are INSERT OR IGNORE keyed by (user_id, slug) / (user_id, key), and new
 * seed entries added in later versions are filled in without touching user edits.
 */
export async function seedUserDefaults(db: Db, userId: string): Promise<void> {
  const version = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.userId, userId), eq(settings.key, SEED_VERSION_KEY)))
    .get();
  if (version && Number(JSON.parse(version.value)) >= CATEGORY_SEED_VERSION) return;

  const existing = await db
    .select({ slug: categories.slug })
    .from(categories)
    .where(eq(categories.userId, userId));
  const existingSlugs = new Set(existing.map((c) => c.slug));

  const statements: BatchItem<'sqlite'>[] = [];
  for (const cat of flattenCategorySeed()) {
    if (existingSlugs.has(cat.slug)) continue;
    statements.push(
      db
        .insert(categories)
        .values({
          id: newId(),
          userId,
          // Resolve the parent by slug inside the batch (parents are inserted first), so a
          // concurrent seed that won the parent insert is still referenced correctly.
          parentId: cat.parentSlug
            ? sql`(select id from categories where user_id = ${userId} and slug = ${cat.parentSlug})`
            : null,
          slug: cat.slug,
          name: cat.name,
          type: cat.type,
          systemKey: cat.systemKey,
          icon: cat.icon,
          color: cat.color,
          sortOrder: cat.sortOrder,
        })
        .onConflictDoNothing(),
    );
  }
  if (!version) {
    // First login: every user gets a Cash account (spec: cash is an account; ATM withdrawals transfer into it).
    statements.push(
      db
        .insert(accounts)
        .values({
          id: newId(),
          userId,
          name: 'Cash',
          type: 'cash',
          openingBalanceDate: toIstDate(),
          color: '#16a34a',
        })
        .onConflictDoNothing(),
    );
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    statements.push(
      db
        .insert(settings)
        .values({ userId, key, value: JSON.stringify(value) })
        .onConflictDoNothing(),
    );
  }
  statements.push(
    db
      .insert(settings)
      .values({ userId, key: SEED_VERSION_KEY, value: JSON.stringify(CATEGORY_SEED_VERSION) })
      .onConflictDoUpdate({
        target: [settings.userId, settings.key],
        set: { value: JSON.stringify(CATEGORY_SEED_VERSION), updatedAt: Date.now() },
      }),
  );

  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);
}
