import { eq } from 'drizzle-orm';
import type { AuthUser } from '../env';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { newId } from '../lib/ids';
import { seedUserDefaults } from './seed';

// Per-isolate cache: email -> user. Avoids a DB round trip on every request.
const userCache = new Map<string, AuthUser>();

export function clearUserCache(): void {
  userCache.clear();
}

/** Finds or provisions (and seeds) the user for an already-authorized email. */
export async function resolveUser(d1: D1Database, email: string): Promise<AuthUser> {
  const cached = userCache.get(email);
  if (cached) return cached;

  const db = getDb(d1);
  let user = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (!user) {
    await db.insert(users).values({ id: newId(), email }).onConflictDoNothing();
    user = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .get();
    if (!user) throw new Error('user provisioning failed');
  }
  await seedUserDefaults(db, user.id);
  userCache.set(email, user);
  return user;
}
