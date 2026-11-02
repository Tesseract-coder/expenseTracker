import { and, eq, sql } from 'drizzle-orm';
import type { CounterpartyDto } from '@kharcha/shared';
import type { Db } from '../db/client';
import { counterparties } from '../db/schema';
import { ApiException, notFound } from '../lib/errors';
import { newId } from '../lib/ids';

type Row = typeof counterparties.$inferSelect;

const toDto = (r: Row): CounterpartyDto => ({
  id: r.id,
  name: r.displayName,
  key: r.key,
  vpa: r.vpa,
  txnCount: r.txnCount,
  lastSeenDate: r.lastSeenDate,
});

async function getActive(db: Db, userId: string, id: string): Promise<Row> {
  const row = await db
    .select()
    .from(counterparties)
    .where(and(eq(counterparties.userId, userId), eq(counterparties.id, id)))
    .get();
  if (!row || row.mergedIntoId) throw notFound('Payee not found');
  return row;
}

export async function renameCounterparty(
  db: Db,
  userId: string,
  id: string,
  displayName: string,
): Promise<CounterpartyDto> {
  await getActive(db, userId, id);
  await db
    .update(counterparties)
    .set({ displayName })
    .where(and(eq(counterparties.userId, userId), eq(counterparties.id, id)));
  return toDto(await getActive(db, userId, id));
}

/**
 * Merges payee `id` into `targetId`: moves transactions and learned labels (the target's label wins
 * on a scope clash), and keeps the old key resolvable so future imports land on the target.
 */
export async function mergeCounterparty(
  db: Db,
  d1: D1Database,
  userId: string,
  id: string,
  targetId: string,
): Promise<number> {
  if (id === targetId) throw new ApiException(400, 'invalid_merge', 'Choose a different payee');
  const source = await getActive(db, userId, id);
  await getActive(db, userId, targetId);
  const now = Date.now();
  const moved = await db
    .select({ n: sql<number>`count(*)` })
    .from(sql`transactions`)
    .where(sql`user_id = ${userId} and counterparty_id = ${id}`)
    .get();
  await d1.batch([
    d1
      .prepare(
        'update transactions set counterparty_id = ?3, updated_at = ?4 where user_id = ?1 and counterparty_id = ?2',
      )
      .bind(userId, id, targetId, now),
    d1
      .prepare(
        'update or ignore learned_labels set counterparty_id = ?3, updated_at = ?4 where user_id = ?1 and counterparty_id = ?2',
      )
      .bind(userId, id, targetId, now),
    d1
      .prepare('delete from learned_labels where user_id = ?1 and counterparty_id = ?2')
      .bind(userId, id),
    d1
      .prepare('delete from recurring_series where user_id = ?1 and counterparty_id = ?2')
      .bind(userId, id),
    d1
      .prepare(
        `update counterparties set merged_into_id = ?3, txn_count = 0, updated_at = ?4
         where user_id = ?1 and (id = ?2 or merged_into_id = ?2)`,
      )
      .bind(userId, id, targetId, now),
    d1
      .prepare(
        `update counterparties set
           txn_count = (select count(*) from transactions t where t.counterparty_id = counterparties.id),
           last_seen_date = (select max(t.txn_date) from transactions t where t.counterparty_id = counterparties.id),
           vpa = coalesce(vpa, ?3), updated_at = ?4
         where user_id = ?1 and id = ?2`,
      )
      .bind(userId, targetId, source.vpa, now),
    d1
      .prepare(
        `insert into audit_log (id, user_id, batch_id, action, entity, entity_id, before, after, created_at)
         values (?1, ?2, ?3, 'merge_counterparty', 'counterparty', ?4, ?5, ?6, ?7)`,
      )
      .bind(
        newId(),
        userId,
        newId(),
        id,
        JSON.stringify({ key: source.key }),
        JSON.stringify({ targetId }),
        now,
      ),
  ]);
  return Number(moved?.n ?? 0);
}
