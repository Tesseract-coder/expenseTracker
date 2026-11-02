import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { inJson, toD1 } from '../db/batch';
import {
  auditLog,
  learnedLabels,
  tags,
  transactionSplits,
  transactionTags,
  transactions,
} from '../db/schema';
import { ApiException, notFound } from '../lib/errors';
import { CATEGORY_ACTIONS, type CategoryState } from './categorization';
import { type DeletedSnapshot, refreshCounterparties } from './transactions';

type AuditRow = typeof auditLog.$inferSelect;
type SplitRow = typeof transactionSplits.$inferSelect;

const UNDOABLE = new Set<string>(['delete_txn', 'learn_label', ...CATEGORY_ACTIONS]);

interface CategorySnapshot extends CategoryState {
  splits?: SplitRow[] | null;
}

const parse = <T>(json: string | null): T | null => (json ? (JSON.parse(json) as T) : null);
const isSplitEntry = (e: AuditRow) => {
  const before = parse<CategorySnapshot>(e.before);
  const after = parse<CategorySnapshot>(e.after);
  return (before?.isSplit ?? 0) === 1 || (after?.isSplit ?? 0) === 1;
};

/**
 * Restores non-split category changes of a batch in one statement. A row is only restored while it
 * still holds the category the batch gave it, so later edits are never clobbered. Rules or learned
 * labels deleted since then are restored as null.
 */
const RESTORE_CATEGORIES_SQL = `update transactions set
    category_id = json_extract(a.before, '$.categoryId'),
    categorized_by = json_extract(a.before, '$.categorizedBy'),
    rule_id = (select r.id from rules r where r.id = json_extract(a.before, '$.ruleId')),
    learned_label_id = (select l.id from learned_labels l where l.id = json_extract(a.before, '$.learnedLabelId')),
    confidence = json_extract(a.before, '$.confidence'),
    categorization_reason = json_extract(a.before, '$.reason'),
    updated_at = ?3
  from audit_log a
  where a.user_id = ?1 and a.batch_id = ?2 and a.undone_at is null and a.entity = 'transaction'
    and a.action in (select value from json_each(?4))
    and coalesce(json_extract(a.before, '$.isSplit'), 0) = 0
    and coalesce(json_extract(a.after, '$.isSplit'), 0) = 0
    and transactions.id = a.entity_id and transactions.user_id = ?1 and transactions.is_split = 0
    and transactions.category_id is json_extract(a.after, '$.categoryId')`;

/** Undo a batch from audit_log (one user action). Returns the number of audit entries undone. */
export async function undoBatch(
  db: Db,
  d1: D1Database,
  userId: string,
  batchId: string,
): Promise<number> {
  const entries = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.userId, userId),
        eq(auditLog.batchId, batchId),
        sql`${auditLog.undoneAt} is null`,
      ),
    );
  if (entries.length === 0) throw notFound('Nothing to undo');
  if (entries.some((e) => !UNDOABLE.has(e.action))) {
    throw new ApiException(400, 'undo_unsupported', 'This action cannot be undone');
  }

  type Builder = { toSQL(): { sql: string; params: unknown[] } };
  const items: Builder[] = [];
  const counterpartyIds: (string | null)[] = [];

  // 1. Deleted transactions: re-insert the snapshots.
  for (const e of entries.filter((x) => x.action === 'delete_txn')) {
    const snap = parse<DeletedSnapshot>(e.before) as DeletedSnapshot;
    counterpartyIds.push(snap.transaction.counterpartyId);
    items.push(db.insert(transactions).values(snap.transaction));
    if (snap.splits.length) items.push(db.insert(transactionSplits).values(snap.splits));
    if (snap.tagIds.length) {
      // Re-link only tags that still exist.
      items.push(
        db.insert(transactionTags).select(
          db
            .select({
              transactionId: sql<string>`${snap.transaction.id}`.as('transaction_id'),
              tagId: tags.id,
            })
            .from(tags)
            .where(and(eq(tags.userId, userId), inJson(tags.id, snap.tagIds))),
        ),
      );
    }
  }

  // 2. Category changes that involved splits: restore individually (rare, small).
  const splitEntries = entries.filter(
    (e) => (CATEGORY_ACTIONS as readonly string[]).includes(e.action) && isSplitEntry(e),
  );
  for (const e of splitEntries) {
    const before = parse<CategorySnapshot>(e.before) as CategorySnapshot;
    const after = parse<CategorySnapshot>(e.after) as CategorySnapshot;
    const current = await db
      .select({ categoryId: transactions.categoryId, isSplit: transactions.isSplit })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.id, e.entityId)))
      .get();
    if (
      !current ||
      current.categoryId !== after.categoryId ||
      current.isSplit !== (after.isSplit ?? 0)
    )
      continue;
    items.push(
      db
        .update(transactions)
        .set({
          categoryId: before.categoryId,
          categorizedBy: before.categorizedBy as never,
          isSplit: before.isSplit ?? 0,
          ruleId: null,
          learnedLabelId: null,
          confidence: before.confidence ?? null,
          categorizationReason: before.reason ?? null,
        })
        .where(and(eq(transactions.userId, userId), eq(transactions.id, e.entityId))),
      db.delete(transactionSplits).where(eq(transactionSplits.transactionId, e.entityId)),
    );
    if (before.splits?.length) items.push(db.insert(transactionSplits).values(before.splits));
  }

  // 3. Learned labels created or changed by the batch.
  for (const e of entries.filter((x) => x.action === 'learn_label')) {
    const before = parse<typeof learnedLabels.$inferSelect>(e.before);
    const where = and(eq(learnedLabels.userId, userId), eq(learnedLabels.id, e.entityId));
    if (!before) items.push(db.delete(learnedLabels).where(where));
    else
      items.push(
        db
          .update(learnedLabels)
          .set({ categoryId: before.categoryId, enabled: before.enabled })
          .where(where),
      );
  }

  items.push(
    db
      .update(auditLog)
      .set({ undoneAt: Date.now() })
      .where(and(eq(auditLog.userId, userId), eq(auditLog.batchId, batchId))),
    ...(refreshCounterparties(db, counterpartyIds) as unknown as Builder[]),
  );

  // Plain category changes go first, in the same atomic batch, while learned labels still exist.
  const stmts: D1PreparedStatement[] = [];
  if (entries.some((e) => (CATEGORY_ACTIONS as readonly string[]).includes(e.action))) {
    stmts.push(
      d1
        .prepare(RESTORE_CATEGORIES_SQL)
        .bind(userId, batchId, Date.now(), JSON.stringify(CATEGORY_ACTIONS)),
    );
  }
  stmts.push(...items.map((q) => toD1(d1, q)));
  try {
    await d1.batch(stmts);
  } catch (err) {
    if (err instanceof Error && /constraint/i.test(err.message + String(err.cause))) {
      throw new ApiException(
        409,
        'undo_conflict',
        'Cannot undo: the account or data it belonged to has changed',
      );
    }
    throw err;
  }
  return entries.length;
}
