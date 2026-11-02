import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import {
  type ExportResponse,
  MAX_EXPORT_ROWS,
  type TransactionListQuery,
  transactionListQuerySchema,
} from '@kharcha/shared';
import type { Db } from '../db/client';
import {
  accounts,
  categories,
  counterparties,
  transactionSplits,
  transactions,
} from '../db/schema';
import { ledgerWhere } from './reports';
import { transactionFilterConds } from './transactions';

const parent = alias(categories, 'parent');

/**
 * Rows for XLSX/CSV export with the same filters as the transaction list. Split transactions
 * export one row per part, so category sheets add up. The spreadsheet itself is built in the
 * browser (SheetJS is never loaded in the Worker).
 */
export async function exportTransactions(
  db: Db,
  d1: D1Database,
  userId: string,
  rawQuery: TransactionListQuery & { withPayees?: string },
): Promise<ExportResponse> {
  const q = transactionListQuerySchema.parse(rawQuery);
  const conds = await transactionFilterConds(db, userId, q);
  const t = transactions;
  const rows = await db
    .select({
      date: t.txnDate,
      account: accounts.name,
      payee: counterparties.displayName,
      narration: t.rawNarration,
      category: categories.name,
      group: parent.name,
      type: categories.type,
      direction: t.direction,
      amountPaise: sql<number>`coalesce(${transactionSplits.amountPaise}, ${t.amountPaise})`,
      note: sql<string | null>`coalesce(${transactionSplits.note}, ${t.note})`,
      tags: sql<string | null>`(select group_concat(tg.name, ' ') from transaction_tags tt
        join tags tg on tg.id = tt.tag_id where tt.transaction_id = ${t.id})`,
    })
    .from(t)
    .innerJoin(accounts, eq(accounts.id, t.accountId))
    .leftJoin(counterparties, eq(counterparties.id, t.counterpartyId))
    .leftJoin(transactionSplits, and(eq(transactionSplits.transactionId, t.id), eq(t.isSplit, 1)))
    .innerJoin(
      categories,
      sql`${categories.id} = coalesce(${transactionSplits.categoryId}, ${t.categoryId})`,
    )
    .leftJoin(parent, eq(parent.id, categories.parentId))
    .where(and(...conds))
    .orderBy(desc(t.txnDate), desc(t.createdAt))
    .limit(MAX_EXPORT_ROWS + 1);

  let byCounterparty: ExportResponse['byCounterparty'] = [];
  if (rawQuery.withPayees === 'true' && q.from && q.to) {
    const w = ledgerWhere(userId, { from: q.from, to: q.to, accountIds: q.accountIds });
    const { results } = await d1
      .prepare(
        `select coalesce(cp.display_name, '(no payee)') as name, sum(l.spend_paise) as spend,
           count(distinct l.txn_id) as count
         from v_ledger l left join counterparties cp on cp.id = l.counterparty_id
         where ${w.sql} and l.kind in ('need', 'want', 'uncategorized')
         group by l.counterparty_id having sum(l.spend_paise) != 0 order by spend desc`,
      )
      .bind(...w.params)
      .all<{ name: string; spend: number; count: number }>();
    byCounterparty = results;
  }

  return {
    rows: rows
      .slice(0, MAX_EXPORT_ROWS)
      .map((r) => ({ ...r, tags: r.tags ?? '', group: r.group ?? null })),
    truncated: rows.length > MAX_EXPORT_ROWS,
    byCounterparty,
  };
}
