import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import {
  categorize,
  type CategorizeResult,
  cleanDisplayName,
  counterpartyKey,
  isoDayOfWeek,
  parseRupeesToPaise,
  sha256Hex,
  splitIssues,
  weekStart,
  type TransactionCreateParsed,
  type TransactionDto,
  type TransactionListQuery,
  type TransactionUpdate,
  transactionListQuerySchema,
} from '@kharcha/shared';
import type { Db } from '../db/client';
import { inJson, runBatch } from '../db/batch';
import {
  accounts,
  auditLog,
  categories,
  counterparties,
  learnedLabels,
  rules,
  tags,
  transactionSplits,
  transactionTags,
  transactions,
} from '../db/schema';
import { decodeCursor, encodeCursor } from '../lib/cursor';
import { ApiException, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { getUncategorizedId } from './categories';
import { loadCategorizer } from './categorization';

type TxnRow = typeof transactions.$inferSelect;
type SplitRow = typeof transactionSplits.$inferSelect;

const badRequest = (code: string, message: string) => new ApiException(400, code, message);

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

// ---------------------------------------------------------------------------- ownership checks

async function assertAccount(db: Db, userId: string, accountId: string): Promise<void> {
  const row = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.id, accountId)))
    .get();
  if (!row) throw notFound('Account not found');
}

export async function assertCategories(db: Db, userId: string, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), inJson(categories.id, unique)));
  if (rows.length !== unique.length) throw notFound('Category not found');
}

async function assertReimbursement(
  db: Db,
  userId: string,
  txnId: string | null,
  reimbursedBy: string,
) {
  if (reimbursedBy === txnId)
    throw badRequest('invalid_reimbursement', 'A transaction cannot reimburse itself');
  const row = await db
    .select({ direction: transactions.direction })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, reimbursedBy)))
    .get();
  if (!row) throw notFound('Reimbursement transaction not found');
  if (row.direction !== 'in') {
    throw badRequest('invalid_reimbursement', 'The reimbursement must be an incoming transaction');
  }
}

// ---------------------------------------------------------------------------- upserts

async function upsertCounterparty(db: Db, userId: string, name: string): Promise<string> {
  const displayName = cleanDisplayName(name);
  const key = counterpartyKey(displayName);
  await db
    .insert(counterparties)
    .values({ id: newId(), userId, key, displayName, vpa: key.includes('@') ? key : null })
    .onConflictDoNothing();
  const row = await db
    .select({ id: counterparties.id, mergedIntoId: counterparties.mergedIntoId })
    .from(counterparties)
    .where(and(eq(counterparties.userId, userId), eq(counterparties.key, key)))
    .get();
  if (!row) throw new Error('counterparty upsert failed');
  return row.mergedIntoId ?? row.id;
}

export async function upsertTags(db: Db, userId: string, names: string[]): Promise<string[]> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return [];
  await runBatch(
    db,
    unique.map((name) =>
      db.insert(tags).values({ id: newId(), userId, name }).onConflictDoNothing(),
    ),
  );
  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), inJson(tags.name, unique)));
  return rows.map((r) => r.id);
}

export function refreshCounterparties(db: Db, ids: (string | null)[]): BatchItem<'sqlite'>[] {
  const real = [...new Set(ids.filter((x): x is string => !!x))];
  if (real.length === 0) return [];
  return [
    db
      .update(counterparties)
      .set({
        txnCount: sql`(select count(*) from transactions t where t.counterparty_id = ${counterparties.id})`,
        lastSeenDate: sql`(select max(t.txn_date) from transactions t where t.counterparty_id = ${counterparties.id})`,
      })
      .where(inJson(counterparties.id, real)),
  ];
}

function splitRows(
  userId: string,
  transactionId: string,
  splits: TransactionCreateParsed['splits'],
) {
  return splits.map((s) => ({
    id: newId(),
    userId,
    transactionId,
    categoryId: s.categoryId,
    amountPaise: s.amountPaise,
    note: s.note,
  }));
}

// ---------------------------------------------------------------------------- reads

const listColumns = {
  txn: transactions,
  counterpartyName: counterparties.displayName,
};

async function toDtos(
  db: Db,
  userId: string,
  rows: { txn: TxnRow; counterpartyName: string | null }[],
): Promise<TransactionDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.txn.id);
  const [splits, tagRows] = await Promise.all([
    db
      .select()
      .from(transactionSplits)
      .where(
        and(eq(transactionSplits.userId, userId), inJson(transactionSplits.transactionId, ids)),
      ),
    db
      .select({ transactionId: transactionTags.transactionId, id: tags.id, name: tags.name })
      .from(transactionTags)
      .innerJoin(tags, eq(tags.id, transactionTags.tagId))
      .where(inJson(transactionTags.transactionId, ids))
      .orderBy(tags.name),
  ]);
  const splitsBy = groupBy(splits, (s) => s.transactionId);
  const tagsBy = groupBy(tagRows, (t) => t.transactionId);

  return rows.map(({ txn: t, counterpartyName }) => ({
    id: t.id,
    accountId: t.accountId,
    txnDate: t.txnDate,
    amountPaise: t.amountPaise,
    direction: t.direction,
    rawNarration: t.rawNarration,
    channel: t.channel,
    counterparty:
      t.counterpartyId && counterpartyName
        ? { id: t.counterpartyId, name: counterpartyName }
        : null,
    categoryId: t.categoryId,
    categorizedBy: t.categorizedBy,
    categorizationReason: t.categorizationReason,
    confidence: t.confidence,
    vpa: t.vpa,
    isSplit: t.isSplit === 1,
    splits: (splitsBy.get(t.id) ?? []).map((s) => ({
      id: s.id,
      categoryId: s.categoryId,
      amountPaise: s.amountPaise,
      note: s.note,
    })),
    tags: (tagsBy.get(t.id) ?? []).map(({ id, name }) => ({ id, name })),
    note: t.note,
    status: t.status,
    source: t.source,
    isReimbursable: t.isReimbursable === 1,
    reimbursedByTxnId: t.reimbursedByTxnId,
    transferGroupId: t.transferGroupId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
}

export async function getTransaction(db: Db, userId: string, id: string): Promise<TransactionDto> {
  const row = await db
    .select(listColumns)
    .from(transactions)
    .leftJoin(counterparties, eq(counterparties.id, transactions.counterpartyId))
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
    .get();
  if (!row) throw notFound('Transaction not found');
  const [dto] = await toDtos(db, userId, [row]);
  return dto as TransactionDto;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * WHERE conditions for the transaction list filters (shared by the list and exports).
 * Queries using them must left-join counterparties (search matches the payee name).
 */
export async function transactionFilterConds(
  db: Db,
  userId: string,
  q: Omit<ReturnType<typeof transactionListQuerySchema.parse>, 'limit' | 'cursor'>,
): Promise<(SQL | undefined)[]> {
  const t = transactions;
  const conds: (SQL | undefined)[] = [eq(t.userId, userId)];

  if (q.accountIds?.length) conds.push(inJson(t.accountId, q.accountIds));
  if (q.direction) conds.push(eq(t.direction, q.direction));
  if (q.importId) conds.push(eq(t.importId, q.importId));
  if (q.from) conds.push(sql`${t.txnDate} >= ${q.from}`);
  if (q.to) conds.push(sql`${t.txnDate} <= ${q.to}`);
  if (q.uncategorized) conds.push(eq(t.categoryId, await getUncategorizedId(db, userId)));
  if (q.categoryIds?.length) {
    // Group ids expand to their children; split parts match too.
    const ids = JSON.stringify(q.categoryIds);
    const expanded = sql`(select id from categories where user_id = ${userId}
      and (id in (select value from json_each(${ids})) or parent_id in (select value from json_each(${ids}))))`;
    conds.push(
      sql`(${t.categoryId} in ${expanded} or exists (select 1 from transaction_splits s
        where s.transaction_id = ${t.id} and s.category_id in ${expanded}))`,
    );
  }
  if (q.tagIds?.length) {
    conds.push(
      sql`exists (select 1 from transaction_tags tt where tt.transaction_id = ${t.id}
        and tt.tag_id in (select value from json_each(${JSON.stringify(q.tagIds)})))`,
    );
  }
  if (q.q) {
    const like = `%${escapeLike(q.q)}%`;
    const amount = parseRupeesToPaise(q.q);
    conds.push(
      sql`(${t.rawNarration} like ${like} escape '\\' or ${t.note} like ${like} escape '\\'
        or ${counterparties.displayName} like ${like} escape '\\'
        ${amount && amount > 0 ? sql`or ${t.amountPaise} = ${amount}` : sql``})`,
    );
  }
  return conds;
}

export async function listTransactions(db: Db, userId: string, rawQuery: TransactionListQuery) {
  const q = transactionListQuerySchema.parse(rawQuery);
  const t = transactions;
  const conds = await transactionFilterConds(db, userId, q);
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    conds.push(
      sql`(${t.txnDate}, ${t.createdAt}, ${t.id}) < (${c.txnDate}, ${c.createdAt}, ${c.id})`,
    );
  }

  const rows = await db
    .select(listColumns)
    .from(t)
    .leftJoin(counterparties, eq(counterparties.id, t.counterpartyId))
    .where(and(...conds))
    .orderBy(desc(t.txnDate), desc(t.createdAt), desc(t.id))
    .limit(q.limit + 1);

  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  return {
    transactions: await toDtos(db, userId, page),
    nextCursor:
      rows.length > q.limit && last
        ? encodeCursor({
            txnDate: last.txn.txnDate,
            createdAt: last.txn.createdAt,
            id: last.txn.id,
          })
        : null,
  };
}

// ---------------------------------------------------------------------------- writes

export async function createTransaction(db: Db, userId: string, input: TransactionCreateParsed) {
  await assertAccount(db, userId, input.accountId);
  await assertCategories(db, userId, [
    ...(input.categoryId ? [input.categoryId] : []),
    ...input.splits.map((s) => s.categoryId),
  ]);
  if (input.reimbursedByTxnId) await assertReimbursement(db, userId, null, input.reimbursedByTxnId);

  const id = newId();
  const isSplit = input.splits.length > 0;
  const counterpartyId = input.counterpartyName
    ? await upsertCounterparty(db, userId, input.counterpartyName)
    : null;
  let tagIds = await upsertTags(db, userId, input.tags);
  let auto: CategorizeResult | null = null;
  if (!isSplit && !input.categoryId) {
    // No category chosen: run the engine (rules → learned labels → keywords) on payee + note.
    const account = await db
      .select({ type: accounts.type })
      .from(accounts)
      .where(eq(accounts.id, input.accountId))
      .get();
    const { ctx } = await loadCategorizer(db, userId);
    const key = input.counterpartyName
      ? counterpartyKey(cleanDisplayName(input.counterpartyName))
      : null;
    auto = categorize(
      {
        narration: input.note,
        extraText: input.counterpartyName,
        counterpartyKey: key,
        counterpartyId,
        vpa: key?.includes('@') ? key : null,
        amountPaise: input.amountPaise,
        direction: input.direction,
        accountId: input.accountId,
        accountType: account?.type ?? null,
        channel: null,
      },
      ctx,
    );
    if (auto?.setTagIds.length) tagIds = [...new Set([...tagIds, ...auto.setTagIds])];
  }
  const categoryId = isSplit
    ? null
    : (input.categoryId ?? auto?.categoryId ?? (await getUncategorizedId(db, userId)));

  await runBatch(db, [
    db.insert(transactions).values({
      id,
      userId,
      accountId: input.accountId,
      txnDate: input.txnDate,
      weekStart: weekStart(input.txnDate),
      dow: isoDayOfWeek(input.txnDate),
      amountPaise: input.amountPaise,
      direction: input.direction,
      channel: null, // payment rail is unknown for manual entries; parsers set it in Phase 2/3
      counterpartyId,
      categoryId,
      categorizedBy: isSplit || input.categoryId ? 'manual' : (auto?.categorizedBy ?? 'none'),
      ruleId: auto?.ruleId ?? null,
      learnedLabelId: auto?.learnedLabelId ?? null,
      confidence: auto?.confidence ?? null,
      categorizationReason: auto?.reason ?? null,
      isSplit: isSplit ? 1 : 0,
      note: input.note ?? auto?.setNote ?? null,
      status: 'confirmed',
      source: 'manual',
      fingerprint: await sha256Hex(`manual|${id}`),
      isReimbursable: input.isReimbursable ? 1 : 0,
      reimbursedByTxnId: input.reimbursedByTxnId,
    }),
    ...(isSplit ? [db.insert(transactionSplits).values(splitRows(userId, id, input.splits))] : []),
    ...(tagIds.length
      ? [db.insert(transactionTags).values(tagIds.map((tagId) => ({ transactionId: id, tagId })))]
      : []),
    ...refreshCounterparties(db, [counterpartyId]),
    ...(auto?.ruleId
      ? [
          db
            .update(rules)
            .set({ hitCount: sql`${rules.hitCount} + 1`, lastHitAt: Date.now() })
            .where(and(eq(rules.userId, userId), eq(rules.id, auto.ruleId))),
        ]
      : []),
    ...(auto?.learnedLabelId
      ? [
          db
            .update(learnedLabels)
            .set({ hitCount: sql`${learnedLabels.hitCount} + 1`, lastHitAt: Date.now() })
            .where(
              and(eq(learnedLabels.userId, userId), eq(learnedLabels.id, auto.learnedLabelId)),
            ),
        ]
      : []),
  ]);
  return getTransaction(db, userId, id);
}

export async function loadRow(db: Db, userId: string, id: string) {
  const row = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.id, id)))
    .get();
  if (!row) throw notFound('Transaction not found');
  const splits = await db
    .select()
    .from(transactionSplits)
    .where(and(eq(transactionSplits.userId, userId), eq(transactionSplits.transactionId, id)));
  return { row, splits };
}

export async function updateTransaction(
  db: Db,
  userId: string,
  id: string,
  patch: TransactionUpdate,
) {
  const { row, splits: oldSplits } = await loadRow(db, userId, id);
  const amount = patch.amountPaise ?? row.amountPaise;

  if (patch.accountId) await assertAccount(db, userId, patch.accountId);
  await assertCategories(db, userId, [
    ...(patch.categoryId ? [patch.categoryId] : []),
    ...(patch.splits ?? []).map((s) => s.categoryId),
  ]);
  if (patch.reimbursedByTxnId) await assertReimbursement(db, userId, id, patch.reimbursedByTxnId);

  // Resolve the categorization outcome.
  type CatState = Pick<TxnRow, 'categoryId' | 'categorizedBy' | 'isSplit'>;
  let cat: CatState | null = null;
  let newSplits: ReturnType<typeof splitRows> | null = null;
  if (patch.splits !== undefined && patch.splits.length > 0) {
    const issue = splitIssues(
      amount,
      patch.splits.map((s) => ({ ...s, note: s.note ?? null })),
    );
    if (issue) throw badRequest('invalid_splits', issue);
    newSplits = splitRows(
      userId,
      id,
      patch.splits.map((s) => ({ ...s, note: s.note ?? null })),
    );
    cat = { categoryId: null, categorizedBy: 'manual', isSplit: 1 };
  } else if (patch.categoryId !== undefined || patch.splits !== undefined) {
    // Explicit category, or un-splitting: a split transaction becomes a single-category one.
    newSplits = row.isSplit ? [] : null;
    cat = patch.categoryId
      ? { categoryId: patch.categoryId, categorizedBy: 'manual', isSplit: 0 }
      : { categoryId: await getUncategorizedId(db, userId), categorizedBy: 'none', isSplit: 0 };
  } else if (
    row.isSplit &&
    patch.amountPaise !== undefined &&
    patch.amountPaise !== row.amountPaise
  ) {
    throw badRequest(
      'invalid_splits',
      'Update the split parts too when changing the amount of a split',
    );
  }

  let counterpartyId = row.counterpartyId;
  if (patch.counterpartyName !== undefined) {
    counterpartyId = patch.counterpartyName
      ? await upsertCounterparty(db, userId, patch.counterpartyName)
      : null;
  }
  const tagIds = patch.tags !== undefined ? await upsertTags(db, userId, patch.tags) : null;
  const txnDate = patch.txnDate ?? row.txnDate;

  const categoryChanged =
    cat !== null &&
    (cat.categoryId !== row.categoryId || cat.isSplit !== row.isSplit || newSplits !== null);

  await runBatch(db, [
    db
      .update(transactions)
      .set({
        accountId: patch.accountId ?? row.accountId,
        txnDate,
        weekStart: weekStart(txnDate),
        dow: isoDayOfWeek(txnDate),
        amountPaise: amount,
        direction: patch.direction ?? row.direction,
        note: patch.note !== undefined ? patch.note : row.note,
        counterpartyId,
        isReimbursable:
          patch.isReimbursable !== undefined ? (patch.isReimbursable ? 1 : 0) : row.isReimbursable,
        reimbursedByTxnId:
          patch.reimbursedByTxnId !== undefined ? patch.reimbursedByTxnId : row.reimbursedByTxnId,
        ...(cat
          ? {
              ...cat,
              ruleId: null,
              learnedLabelId: null,
              confidence: null,
              categorizationReason: null,
            }
          : {}),
      })
      .where(and(eq(transactions.userId, userId), eq(transactions.id, id))),
    ...(newSplits !== null
      ? [
          db.delete(transactionSplits).where(eq(transactionSplits.transactionId, id)),
          ...(newSplits.length ? [db.insert(transactionSplits).values(newSplits)] : []),
        ]
      : []),
    ...(tagIds !== null
      ? [
          db.delete(transactionTags).where(eq(transactionTags.transactionId, id)),
          ...(tagIds.length
            ? [
                db
                  .insert(transactionTags)
                  .values(tagIds.map((tagId) => ({ transactionId: id, tagId }))),
              ]
            : []),
        ]
      : []),
    ...(categoryChanged && cat
      ? [
          db.insert(auditLog).values({
            id: newId(),
            userId,
            batchId: newId(),
            action: 'recategorize',
            entity: 'transaction',
            entityId: id,
            before: JSON.stringify({
              categoryId: row.categoryId,
              categorizedBy: row.categorizedBy,
              isSplit: row.isSplit,
              splits: oldSplits,
            }),
            after: JSON.stringify({ ...cat, splits: newSplits }),
          }),
        ]
      : []),
    ...refreshCounterparties(db, [row.counterpartyId, counterpartyId]),
  ]);
  return getTransaction(db, userId, id);
}

export interface DeletedSnapshot {
  transaction: TxnRow;
  splits: SplitRow[];
  tagIds: string[];
}

/** Hard-deletes with a full snapshot in audit_log; returns the batch id usable for undo. */
export async function deleteTransaction(db: Db, userId: string, id: string): Promise<string> {
  const { row, splits } = await loadRow(db, userId, id);
  const tagIds = (
    await db
      .select({ id: transactionTags.tagId })
      .from(transactionTags)
      .where(eq(transactionTags.transactionId, id))
  ).map((r) => r.id);
  const batchId = newId();
  const snapshot: DeletedSnapshot = { transaction: row, splits, tagIds };

  await runBatch(db, [
    db.insert(auditLog).values({
      id: newId(),
      userId,
      batchId,
      action: 'delete_txn',
      entity: 'transaction',
      entityId: id,
      before: JSON.stringify(snapshot),
    }),
    db.delete(transactions).where(and(eq(transactions.userId, userId), eq(transactions.id, id))),
    ...refreshCounterparties(db, [row.counterpartyId]),
  ]);
  return batchId;
}

// ---------------------------------------------------------------------------- lookups

export async function listTags(db: Db, userId: string) {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      count: sql<number>`count(${transactionTags.transactionId})`,
    })
    .from(tags)
    .leftJoin(transactionTags, eq(transactionTags.tagId, tags.id))
    .where(eq(tags.userId, userId))
    .groupBy(tags.id)
    .orderBy(desc(sql`count(${transactionTags.transactionId})`), tags.name);
  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

export async function searchCounterparties(
  db: Db,
  userId: string,
  q: string | undefined,
  limit = 20,
) {
  const rows = await db
    .select({
      id: counterparties.id,
      name: counterparties.displayName,
      key: counterparties.key,
      vpa: counterparties.vpa,
      txnCount: counterparties.txnCount,
      lastSeenDate: counterparties.lastSeenDate,
    })
    .from(counterparties)
    .where(
      and(
        eq(counterparties.userId, userId),
        sql`${counterparties.mergedIntoId} is null`,
        q
          ? sql`(${counterparties.displayName} like ${`%${escapeLike(q)}%`} escape '\\'
              or ${counterparties.key} like ${`%${escapeLike(q.toLowerCase())}%`} escape '\\')`
          : undefined,
      ),
    )
    .orderBy(desc(counterparties.txnCount), counterparties.displayName)
    .limit(limit);
  return rows;
}
