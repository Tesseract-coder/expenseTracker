import type { BatchItem } from 'drizzle-orm/batch';
import { sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from './client';

/** Run statements atomically (D1 batches are one implicit transaction). No-op when empty. */
export async function runBatch(db: Db, items: BatchItem<'sqlite'>[]): Promise<void> {
  const [first, ...rest] = items;
  if (first) await db.batch([first, ...rest]);
}

/**
 * `column IN (ids)` using a single JSON parameter, so long id lists never hit D1's
 * 100-bound-parameters-per-statement limit.
 */
export function inJson(column: SQLiteColumn | SQL, ids: readonly string[]): SQL {
  return sql`${column} in (select value from json_each(${JSON.stringify(ids)}))`;
}

/**
 * Converts a Drizzle query builder into a raw D1 statement, so builder queries and raw SQL
 * (e.g. `UPDATE … FROM json_each`) can run together in one atomic `d1.batch`.
 */
export function toD1(d1: D1Database, q: { toSQL(): { sql: string; params: unknown[] } }) {
  const { sql: text, params } = q.toSQL();
  return d1.prepare(text).bind(...params);
}
