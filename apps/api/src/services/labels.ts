import { and, desc, eq, sql } from 'drizzle-orm';
import {
  addDays,
  type BulkCategoryRequest,
  type InboxResponse,
  type LabelImpactQuery,
  labelImpactQuerySchema,
  type LabelRequest,
  labelRequestSchema,
  inboxQuerySchema,
  toIstDate,
} from '@kharcha/shared';
import type { Db } from '../db/client';
import { toD1 } from '../db/batch';
import { categories, counterparties, learnedLabels, transactions } from '../db/schema';
import { ApiException } from '../lib/errors';
import { newId } from '../lib/ids';
import { getUncategorizedId } from './categories';
import { CATEGORY_STATE_JSON } from './categorization';
import { assertCategories, getTransaction, listTransactions, loadRow } from './transactions';

const badRequest = (code: string, message: string) => new ApiException(400, code, message);
const LEARNED_CONFIDENCE = 0.95;

interface LabelScopeInfo {
  counterpartyId: string;
  counterpartyKey: string;
  direction: 'in' | 'out' | null;
  accountId: string | null;
  /** 2 × account-scoped + direction-scoped; higher = more specific. */
  specificity: number;
}

/**
 * Past transactions a learned label would recategorize: same counterparty (and scope), not manual,
 * not set by a rule (rules outrank learned labels), not split or a transfer leg, not already in the
 * category, and not governed by a more specific learned label.
 */
function impactWhere(scope: LabelScopeInfo, excludeTxnId: string, labelId: string) {
  return {
    where: `t.user_id = ?1 and t.counterparty_id = ?2 and t.id != ?3 and t.is_split = 0
      and t.transfer_group_id is null and t.categorized_by not in ('manual', 'rule')
      and t.category_id is not ?4
      and (?5 is null or t.direction = ?5) and (?6 is null or t.account_id = ?6)
      and not (t.categorized_by = 'learned' and exists (select 1 from learned_labels l
        where l.id = t.learned_label_id and l.id != ?7
          and ((l.account_id is not null) * 2 + (l.direction is not null)) > ?8))`,
    params: (userId: string, categoryId: string) => [
      userId,
      scope.counterpartyId,
      excludeTxnId,
      categoryId,
      scope.direction,
      scope.accountId,
      labelId,
      scope.specificity,
    ],
  };
}

async function scopeFor(
  db: Db,
  userId: string,
  row: { counterpartyId: string | null; direction: 'in' | 'out'; accountId: string },
  matchDirection: boolean,
  matchAccount: boolean,
): Promise<(LabelScopeInfo & { name: string }) | null> {
  if (!row.counterpartyId) return null;
  const cp = await db
    .select({ id: counterparties.id, key: counterparties.key, name: counterparties.displayName })
    .from(counterparties)
    .where(and(eq(counterparties.userId, userId), eq(counterparties.id, row.counterpartyId)))
    .get();
  if (!cp) return null;
  return {
    counterpartyId: cp.id,
    counterpartyKey: cp.key,
    name: cp.name,
    direction: matchDirection ? row.direction : null,
    accountId: matchAccount ? row.accountId : null,
    specificity: (matchAccount ? 2 : 0) + (matchDirection ? 1 : 0),
  };
}

async function existingLabel(db: Db, userId: string, scope: LabelScopeInfo) {
  return db
    .select()
    .from(learnedLabels)
    .where(
      and(
        eq(learnedLabels.userId, userId),
        eq(learnedLabels.counterpartyId, scope.counterpartyId),
        sql`ifnull(${learnedLabels.direction}, '*') = ifnull(${scope.direction}, '*')`,
        sql`ifnull(${learnedLabels.accountId}, '*') = ifnull(${scope.accountId}, '*')`,
      ),
    )
    .get();
}

export async function labelImpact(
  db: Db,
  d1: D1Database,
  userId: string,
  txnId: string,
  rawQuery: LabelImpactQuery,
) {
  const q = labelImpactQuerySchema.parse(rawQuery);
  const { row } = await loadRow(db, userId, txnId);
  const scope = await scopeFor(db, userId, row, q.matchDirection, q.matchAccount);
  if (!scope) return { counterparty: null, count: 0 };
  const label = await existingLabel(db, userId, scope);
  const w = impactWhere(scope, txnId, label?.id ?? '');
  const res = await d1
    .prepare(`select count(*) as n from transactions t where ${w.where}`)
    .bind(...w.params(userId, q.categoryId))
    .first<{ n: number }>();
  return { counterparty: { id: scope.counterpartyId, name: scope.name }, count: res?.n ?? 0 };
}

/**
 * Learn-from-label (spec §6.3). Sets this transaction manually; with `future` also upserts a learned
 * label; with `past_and_future` also re-applies it to past transactions. One batch, one undo token.
 */
export async function labelTransaction(
  db: Db,
  d1: D1Database,
  userId: string,
  txnId: string,
  raw: LabelRequest,
) {
  const req = labelRequestSchema.parse(raw);
  const { row } = await loadRow(db, userId, txnId);
  if (row.isSplit) {
    throw badRequest('split_transaction', 'Edit the split parts to change their categories');
  }
  await assertCategories(db, userId, [req.categoryId]);
  const now = Date.now();
  const batchId = newId();

  const stmts: D1PreparedStatement[] = [
    d1
      .prepare(
        `insert into audit_log (id, user_id, batch_id, action, entity, entity_id, before, after, created_at)
         select ?1, t.user_id, ?2, 'recategorize', 'transaction', t.id, ${CATEGORY_STATE_JSON('t')},
           json_object('categoryId', ?3, 'categorizedBy', 'manual', 'isSplit', 0), ?4
         from transactions t where t.user_id = ?5 and t.id = ?6`,
      )
      .bind(newId(), batchId, req.categoryId, now, userId, txnId),
    toD1(
      d1,
      db
        .update(transactions)
        .set({
          categoryId: req.categoryId,
          categorizedBy: 'manual',
          ruleId: null,
          learnedLabelId: null,
          confidence: null,
          categorizationReason: null,
          updatedAt: now,
        })
        .where(and(eq(transactions.userId, userId), eq(transactions.id, txnId))),
    ),
  ];

  let learnedLabelId: string | null = null;
  let applyIndex = -1;
  if (req.scope !== 'this') {
    const scope = await scopeFor(db, userId, row, req.matchDirection, req.matchAccount);
    if (!scope) {
      throw badRequest('no_counterparty', 'This transaction has no payee to learn from');
    }
    const existing = await existingLabel(db, userId, scope);
    learnedLabelId = existing?.id ?? newId();
    stmts.push(
      d1
        .prepare(
          `insert into audit_log (id, user_id, batch_id, action, entity, entity_id, before, after, created_at)
           values (?1, ?2, ?3, 'learn_label', 'learned_label', ?4, ?5, ?6, ?7)`,
        )
        .bind(
          newId(),
          userId,
          batchId,
          learnedLabelId,
          existing ? JSON.stringify(existing) : null,
          JSON.stringify({ categoryId: req.categoryId, enabled: 1 }),
          now,
        ),
    );
    stmts.push(
      existing
        ? toD1(
            d1,
            db
              .update(learnedLabels)
              .set({ categoryId: req.categoryId, enabled: 1, updatedAt: now })
              .where(eq(learnedLabels.id, existing.id)),
          )
        : toD1(
            d1,
            db.insert(learnedLabels).values({
              id: learnedLabelId,
              userId,
              counterpartyId: scope.counterpartyId,
              direction: scope.direction,
              accountId: scope.accountId,
              categoryId: req.categoryId,
              createdAt: now,
              updatedAt: now,
            }),
          ),
    );

    if (req.scope === 'past_and_future') {
      const w = impactWhere(scope, txnId, learnedLabelId);
      const params = w.params(userId, req.categoryId);
      stmts.push(
        d1
          .prepare(
            `insert into audit_log (id, user_id, batch_id, action, entity, entity_id, before, after, created_at)
             select lower(hex(randomblob(16))), t.user_id, ?9, 'apply_learned', 'transaction', t.id,
               ${CATEGORY_STATE_JSON('t')},
               json_object('categoryId', ?4, 'categorizedBy', 'learned', 'learnedLabelId', ?7, 'isSplit', 0), ?10
             from transactions t where ${w.where}`,
          )
          .bind(...params, batchId, now),
      );
      applyIndex = stmts.length;
      stmts.push(
        d1
          .prepare(
            `update transactions set category_id = ?4, categorized_by = 'learned', learned_label_id = ?7,
               rule_id = null, confidence = ${LEARNED_CONFIDENCE}, categorization_reason = ?9, updated_at = ?10
             where id in (select t.id from transactions t where ${w.where})`,
          )
          .bind(...params, `learned:${scope.counterpartyKey}`, now),
      );
      stmts.push(
        d1
          .prepare(
            `update learned_labels set hit_count = hit_count + (select count(*) from audit_log
               where batch_id = ?1 and action = 'apply_learned'), last_hit_at = ?2 where id = ?3`,
          )
          .bind(batchId, now, learnedLabelId),
      );
    }
  }

  const results = await d1.batch(stmts);
  const applied = applyIndex >= 0 ? (results[applyIndex]?.meta.changes ?? 0) : 0;
  return {
    transaction: await getTransaction(db, userId, txnId),
    learnedLabelId,
    applied,
    undoToken: batchId,
  };
}

/** Bulk-assign one category to many transactions (manual). Splits are skipped. */
export async function bulkCategorize(
  db: Db,
  d1: D1Database,
  userId: string,
  req: BulkCategoryRequest,
) {
  await assertCategories(db, userId, [req.categoryId]);
  const ids = JSON.stringify([...new Set(req.ids)]);
  const batchId = newId();
  const now = Date.now();
  const where = `t.user_id = ?1 and t.id in (select value from json_each(?2)) and t.is_split = 0
    and (t.category_id is not ?3 or t.categorized_by != 'manual')`;
  const [, update] = await d1.batch([
    d1
      .prepare(
        `insert into audit_log (id, user_id, batch_id, action, entity, entity_id, before, after, created_at)
         select lower(hex(randomblob(16))), t.user_id, ?4, 'bulk_recategorize', 'transaction', t.id,
           ${CATEGORY_STATE_JSON('t')}, json_object('categoryId', ?3, 'categorizedBy', 'manual', 'isSplit', 0), ?5
         from transactions t where ${where}`,
      )
      .bind(userId, ids, req.categoryId, batchId, now),
    d1
      .prepare(
        `update transactions set category_id = ?3, categorized_by = 'manual', rule_id = null,
           learned_label_id = null, confidence = null, categorization_reason = null, updated_at = ?4
         where id in (select t.id from transactions t where ${where})`,
      )
      .bind(userId, ids, req.categoryId, now),
  ]);
  const updated = update?.meta.changes ?? 0;
  return {
    updated,
    skipped: new Set(req.ids).size - updated,
    undoToken: updated > 0 ? batchId : null,
  };
}

// ---------------------------------------------------------------------------- inbox

const DEFAULT_SUGGESTIONS = {
  out: ['food_delivery', 'grocery', 'online_shopping', 'restaurants', 'cab_auto'],
  in: ['salary', 'refund', 'other_income', 'interest', 'gift_received'],
} as const;
const MAX_SUGGESTIONS = 4;

export async function inboxCount(db: Db, userId: string): Promise<number> {
  const uncategorizedId = await getUncategorizedId(db, userId);
  const row = await db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.categoryId, uncategorizedId)))
    .get();
  return Number(row?.n ?? 0);
}

/** Uncategorized transactions with one-tap suggestions (payee history first, then your usual). */
export async function getInbox(
  db: Db,
  userId: string,
  rawQuery: { cursor?: string; limit?: string | number },
): Promise<InboxResponse> {
  const q = inboxQuerySchema.parse(rawQuery);
  const page = await listTransactions(db, userId, {
    uncategorized: 'true',
    cursor: q.cursor,
    limit: q.limit,
  });
  const total = await inboxCount(db, userId);
  const uncategorizedId = await getUncategorizedId(db, userId);

  const cpIds = [
    ...new Set(page.transactions.flatMap((t) => (t.counterparty ? [t.counterparty.id] : []))),
  ];
  const since = addDays(toIstDate(), -180);
  const [history, usual, active] = await Promise.all([
    cpIds.length
      ? db
          .select({
            counterpartyId: transactions.counterpartyId,
            direction: transactions.direction,
            categoryId: transactions.categoryId,
            n: sql<number>`count(*)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
              sql`${transactions.counterpartyId} in (select value from json_each(${JSON.stringify(cpIds)}))`,
              sql`${transactions.categoryId} != ${uncategorizedId}`,
              eq(transactions.isSplit, 0),
            ),
          )
          .groupBy(transactions.counterpartyId, transactions.direction, transactions.categoryId)
          .orderBy(desc(sql`count(*)`))
      : Promise.resolve([]),
    db
      .select({
        direction: transactions.direction,
        categoryId: transactions.categoryId,
        n: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          sql`${transactions.txnDate} >= ${since}`,
          sql`${transactions.categoryId} != ${uncategorizedId}`,
          eq(transactions.isSplit, 0),
          sql`${transactions.transferGroupId} is null`,
        ),
      )
      .groupBy(transactions.direction, transactions.categoryId)
      .orderBy(desc(sql`count(*)`))
      .limit(40),
    db
      .select({ id: categories.id, slug: categories.slug, type: categories.type })
      .from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.archived, 0))),
  ]);
  const activeIds = new Set(active.map((c) => c.id));
  const bySlug = new Map(active.map((c) => [c.slug, c.id]));
  const transferIds = new Set(active.filter((c) => c.type === 'transfer').map((c) => c.id));

  const suggestions: Record<string, string[]> = {};
  for (const t of page.transactions) {
    const out: string[] = [];
    const push = (id: string | null | undefined) => {
      if (id && activeIds.has(id) && !out.includes(id) && out.length < MAX_SUGGESTIONS)
        out.push(id);
    };
    for (const h of history)
      if (h.counterpartyId === t.counterparty?.id && h.direction === t.direction)
        push(h.categoryId);
    for (const u of usual)
      if (u.direction === t.direction && !transferIds.has(u.categoryId ?? '')) push(u.categoryId);
    for (const slug of DEFAULT_SUGGESTIONS[t.direction]) push(bySlug.get(slug));
    suggestions[t.id] = out;
  }
  return { ...page, total, suggestions };
}
