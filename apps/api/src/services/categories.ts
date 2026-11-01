import { and, asc, eq, sql } from 'drizzle-orm';
import type { CategoryCreate, CategoryDto, CategoryUpdate } from '@kharcha/shared';
import { categoryCreateSchema } from '@kharcha/shared';
import type { Db } from '../db/client';
import {
  auditLog,
  budgets,
  categories,
  counterparties,
  learnedLabels,
  rules,
  transactionSplits,
  transactions,
} from '../db/schema';
import { withUniqueAsConflict } from '../lib/dbErrors';
import { ApiException, notFound } from '../lib/errors';
import { newId } from '../lib/ids';

type CategoryRow = typeof categories.$inferSelect;
const DUPLICATE_NAME = 'A category with this name already exists here';
const SYSTEM_GROUP_SLUG = 'system';

const badRequest = (code: string, message: string) => new ApiException(400, code, message);

export function toCategoryDto(r: CategoryRow): CategoryDto {
  return {
    id: r.id,
    slug: r.slug,
    parentId: r.parentId,
    name: r.name,
    type: r.type,
    systemKey: r.systemKey,
    icon: r.icon,
    color: r.color,
    archived: r.archived === 1,
    sortOrder: r.sortOrder,
  };
}

export async function listCategories(db: Db, userId: string): Promise<CategoryDto[]> {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return rows.map(toCategoryDto);
}

async function getRow(db: Db, userId: string, id: string): Promise<CategoryRow> {
  const row = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.id, id)))
    .get();
  if (!row) throw notFound('Category not found');
  return row;
}

/** A valid parent is an active, non-system top-level group. */
async function getParentGroup(db: Db, userId: string, parentId: string): Promise<CategoryRow> {
  const parent = await getRow(db, userId, parentId);
  if (parent.parentId !== null)
    throw badRequest('invalid_parent', 'Categories can only be nested one level');
  if (parent.archived) throw badRequest('invalid_parent', 'That group is archived');
  if (parent.slug === SYSTEM_GROUP_SLUG)
    throw badRequest('invalid_parent', 'System categories are fixed');
  return parent;
}

export async function getUncategorizedId(db: Db, userId: string): Promise<string> {
  const row = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.systemKey, 'uncategorized')))
    .get();
  if (!row) throw new Error('uncategorized category missing (seed not applied)');
  return row.id;
}

export async function createCategory(
  db: Db,
  userId: string,
  input: CategoryCreate,
): Promise<CategoryDto> {
  const data = categoryCreateSchema.parse(input);
  const parent = data.parentId ? await getParentGroup(db, userId, data.parentId) : null;
  const id = newId();
  const maxOrder = await db
    .select({ max: sql<number>`coalesce(max(${categories.sortOrder}), -1)` })
    .from(categories)
    .where(
      and(
        eq(categories.userId, userId),
        parent ? eq(categories.parentId, parent.id) : sql`${categories.parentId} is null`,
      ),
    )
    .get();
  await withUniqueAsConflict(
    () =>
      db.insert(categories).values({
        id,
        userId,
        parentId: parent?.id ?? null,
        name: data.name,
        type: data.type ?? (parent as CategoryRow).type,
        icon: data.icon,
        color: data.color ?? parent?.color ?? null,
        sortOrder: Number(maxOrder?.max ?? -1) + 1,
      }),
    DUPLICATE_NAME,
  );
  return toCategoryDto(await getRow(db, userId, id));
}

export async function updateCategory(
  db: Db,
  userId: string,
  id: string,
  patch: CategoryUpdate,
): Promise<CategoryDto> {
  const cat = await getRow(db, userId, id);
  const isGroup = cat.parentId === null;
  const isSystem = cat.systemKey !== null || cat.slug === SYSTEM_GROUP_SLUG;

  if (
    isSystem &&
    (patch.type !== undefined || patch.archived !== undefined || patch.parentId !== undefined)
  ) {
    throw badRequest(
      'system_category',
      'System categories can be renamed or recolored, not retyped, moved or archived',
    );
  }
  if (patch.parentId !== undefined) {
    if (isGroup) throw badRequest('invalid_parent', 'Groups cannot be moved under another group');
    await getParentGroup(db, userId, patch.parentId);
  }

  const { archived, ...rest } = patch;
  const set = { ...rest, ...(archived === undefined ? {} : { archived: archived ? 1 : 0 }) };
  const ownChildren = and(eq(categories.userId, userId), eq(categories.parentId, id));

  await withUniqueAsConflict(async () => {
    await db.batch([
      db
        .update(categories)
        .set(set)
        .where(and(eq(categories.userId, userId), eq(categories.id, id))),
      // Group type changes flow to children that still had the group's old type.
      ...(isGroup && patch.type && patch.type !== cat.type
        ? [
            db
              .update(categories)
              .set({ type: patch.type })
              .where(and(ownChildren, eq(categories.type, cat.type))),
          ]
        : []),
      // Archiving a group archives its categories (un-archiving restores only the group).
      ...(isGroup && archived === true
        ? [db.update(categories).set({ archived: 1 }).where(ownChildren)]
        : []),
    ]);
  }, DUPLICATE_NAME);
  return toCategoryDto(await getRow(db, userId, id));
}

/**
 * Merge a category into another: every reference moves to the target, then the source is archived.
 * Leaf categories only. Conflicting budgets (target already budgeted for that month) are dropped.
 */
export async function mergeCategory(db: Db, userId: string, sourceId: string, targetId: string) {
  if (sourceId === targetId)
    throw badRequest('invalid_merge', 'Cannot merge a category into itself');
  const [source, target] = await Promise.all([
    getRow(db, userId, sourceId),
    getRow(db, userId, targetId),
  ]);
  if (source.parentId === null || target.parentId === null) {
    throw badRequest('invalid_merge', 'Only categories (not groups) can be merged');
  }
  if (source.systemKey)
    throw badRequest('system_category', 'System categories cannot be merged away');
  if (target.archived) throw badRequest('invalid_merge', 'Target category is archived');

  const counts = await db
    .select({
      transactions: sql<number>`(select count(*) from transactions where user_id = ${userId} and category_id = ${sourceId})`,
      splits: sql<number>`(select count(*) from transaction_splits where user_id = ${userId} and category_id = ${sourceId})`,
    })
    .from(sql`(select 1)`)
    .get();

  await db.batch([
    db
      .update(transactions)
      .set({ categoryId: targetId })
      .where(and(eq(transactions.userId, userId), eq(transactions.categoryId, sourceId))),
    db
      .update(transactions)
      .set({ aiSuggestedCategoryId: targetId })
      .where(
        and(eq(transactions.userId, userId), eq(transactions.aiSuggestedCategoryId, sourceId)),
      ),
    db
      .update(transactionSplits)
      .set({ categoryId: targetId })
      .where(and(eq(transactionSplits.userId, userId), eq(transactionSplits.categoryId, sourceId))),
    db
      .update(rules)
      .set({ categoryId: targetId })
      .where(and(eq(rules.userId, userId), eq(rules.categoryId, sourceId))),
    db
      .update(learnedLabels)
      .set({ categoryId: targetId })
      .where(and(eq(learnedLabels.userId, userId), eq(learnedLabels.categoryId, sourceId))),
    db
      .update(counterparties)
      .set({ defaultCategoryId: targetId })
      .where(
        and(eq(counterparties.userId, userId), eq(counterparties.defaultCategoryId, sourceId)),
      ),
    // Budgets: drop source budgets whose month the target already budgets, move the rest.
    db.delete(budgets).where(
      and(
        eq(budgets.userId, userId),
        eq(budgets.categoryId, sourceId),
        sql`ifnull(${budgets.month}, '*') in (select ifnull(b.month, '*') from budgets b
            where b.user_id = ${userId} and b.category_id = ${targetId})`,
      ),
    ),
    db
      .update(budgets)
      .set({ categoryId: targetId })
      .where(and(eq(budgets.userId, userId), eq(budgets.categoryId, sourceId))),
    db
      .update(categories)
      .set({ archived: 1 })
      .where(and(eq(categories.userId, userId), eq(categories.id, sourceId))),
    db.insert(auditLog).values({
      id: newId(),
      userId,
      batchId: newId(),
      action: 'merge_category',
      entity: 'category',
      entityId: sourceId,
      before: JSON.stringify({ sourceId, ...counts }),
      after: JSON.stringify({ targetId }),
    }),
  ]);

  return {
    moved: { transactions: Number(counts?.transactions ?? 0), splits: Number(counts?.splits ?? 0) },
  };
}
