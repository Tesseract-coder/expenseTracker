import { and, desc, eq } from 'drizzle-orm';
import type { LearnedLabelDto } from '@kharcha/shared';
import { learnedLabelUpdateSchema } from '@kharcha/shared';
import type { Db } from '../db/client';
import { counterparties, learnedLabels } from '../db/schema';
import { notFound } from '../lib/errors';
import { assertCategories } from './transactions';

const columns = {
  label: learnedLabels,
  counterpartyName: counterparties.displayName,
};

function toDto(r: {
  label: typeof learnedLabels.$inferSelect;
  counterpartyName: string;
}): LearnedLabelDto {
  const l = r.label;
  return {
    id: l.id,
    counterparty: { id: l.counterpartyId, name: r.counterpartyName },
    direction: l.direction,
    accountId: l.accountId,
    categoryId: l.categoryId,
    enabled: l.enabled === 1,
    hitCount: l.hitCount,
    lastHitAt: l.lastHitAt,
    createdAt: l.createdAt,
  };
}

export async function listLearnedLabels(db: Db, userId: string): Promise<LearnedLabelDto[]> {
  const rows = await db
    .select(columns)
    .from(learnedLabels)
    .innerJoin(counterparties, eq(counterparties.id, learnedLabels.counterpartyId))
    .where(eq(learnedLabels.userId, userId))
    .orderBy(desc(learnedLabels.updatedAt));
  return rows.map(toDto);
}

async function getLabel(db: Db, userId: string, id: string): Promise<LearnedLabelDto> {
  const row = await db
    .select(columns)
    .from(learnedLabels)
    .innerJoin(counterparties, eq(counterparties.id, learnedLabels.counterpartyId))
    .where(and(eq(learnedLabels.userId, userId), eq(learnedLabels.id, id)))
    .get();
  if (!row) throw notFound('Learned label not found');
  return toDto(row);
}

export async function updateLearnedLabel(db: Db, userId: string, id: string, input: unknown) {
  const patch = learnedLabelUpdateSchema.parse(input);
  await getLabel(db, userId, id);
  if (patch.categoryId) await assertCategories(db, userId, [patch.categoryId]);
  await db
    .update(learnedLabels)
    .set({
      ...(patch.categoryId ? { categoryId: patch.categoryId } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled ? 1 : 0 } : {}),
    })
    .where(and(eq(learnedLabels.userId, userId), eq(learnedLabels.id, id)));
  return getLabel(db, userId, id);
}

/** Past transactions keep their category; future ones stop matching. */
export async function deleteLearnedLabel(db: Db, userId: string, id: string): Promise<void> {
  await getLabel(db, userId, id);
  await db
    .delete(learnedLabels)
    .where(and(eq(learnedLabels.userId, userId), eq(learnedLabels.id, id)));
}
