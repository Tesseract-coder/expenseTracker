import { and, asc, eq, sql } from 'drizzle-orm';
import {
  compileConditions,
  parseStoredConditions,
  RULE_TEST_SCAN_LIMIT,
  type RuleConditions,
  type RuleCreate,
  ruleCreateSchema,
  type RuleDto,
  type RuleTestResponse,
  type RuleUpdate,
  ruleUpdateSchema,
} from '@kharcha/shared';
import type { Db } from '../db/client';
import { rules, tags } from '../db/schema';
import { notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { conditionsToSql, parseTagIds, renumber, runCategorizationChunk } from './categorization';
import { assertCategories, upsertTags } from './transactions';

type RuleRow = typeof rules.$inferSelect;

async function tagNames(db: Db, userId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, userId));
  return new Map(rows.map((t) => [t.id, t.name]));
}

function toDto(r: RuleRow, names: Map<string, string>): RuleDto {
  return {
    id: r.id,
    name: r.name,
    priority: r.priority,
    enabled: r.enabled === 1,
    // Stored conditions were validated on write; an unreadable row shows as a never-matching rule.
    conditions: parseStoredConditions(r.conditions) ?? {
      all: [{ field: 'narration', op: 'eq', value: '(invalid rule)' }],
    },
    categoryId: r.categoryId,
    setTags: parseTagIds(r.setTags).flatMap((id) => {
      const n = names.get(id);
      return n ? [n] : [];
    }),
    setNote: r.setNote,
    hitCount: r.hitCount,
    lastHitAt: r.lastHitAt,
    createdAt: r.createdAt,
  };
}

async function getRow(db: Db, userId: string, id: string): Promise<RuleRow> {
  const row = await db
    .select()
    .from(rules)
    .where(and(eq(rules.userId, userId), eq(rules.id, id)))
    .get();
  if (!row) throw notFound('Rule not found');
  return row;
}

export async function listRules(db: Db, userId: string): Promise<RuleDto[]> {
  const [rows, names] = await Promise.all([
    db
      .select()
      .from(rules)
      .where(eq(rules.userId, userId))
      .orderBy(asc(rules.priority), asc(rules.createdAt)),
    tagNames(db, userId),
  ]);
  return rows.map((r) => toDto(r, names));
}

export async function getRule(db: Db, userId: string, id: string): Promise<RuleDto> {
  return toDto(await getRow(db, userId, id), await tagNames(db, userId));
}

/** New rules go to the end of the list (lowest priority); reorder to move them up. */
export async function createRule(db: Db, userId: string, input: RuleCreate): Promise<RuleDto> {
  const data = ruleCreateSchema.parse(input);
  await assertCategories(db, userId, [data.categoryId]);
  const tagIds = await upsertTags(db, userId, data.setTags);
  const max = await db
    .select({ p: sql<number | null>`max(${rules.priority})` })
    .from(rules)
    .where(eq(rules.userId, userId))
    .get();
  const id = newId();
  await db.insert(rules).values({
    id,
    userId,
    name: data.name,
    priority: (max?.p ?? 0) + 1,
    enabled: data.enabled ? 1 : 0,
    conditions: JSON.stringify(data.conditions),
    categoryId: data.categoryId,
    setTags: tagIds.length ? JSON.stringify(tagIds) : null,
    setNote: data.setNote,
  });
  return getRule(db, userId, id);
}

export async function updateRule(
  db: Db,
  userId: string,
  id: string,
  input: RuleUpdate,
): Promise<RuleDto> {
  const patch = ruleUpdateSchema.parse(input);
  await getRow(db, userId, id);
  if (patch.categoryId) await assertCategories(db, userId, [patch.categoryId]);
  const tagIds = patch.setTags ? await upsertTags(db, userId, patch.setTags) : null;
  await db
    .update(rules)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled ? 1 : 0 } : {}),
      ...(patch.conditions ? { conditions: JSON.stringify(patch.conditions) } : {}),
      ...(patch.categoryId ? { categoryId: patch.categoryId } : {}),
      ...(tagIds ? { setTags: tagIds.length ? JSON.stringify(tagIds) : null } : {}),
      ...(patch.setNote !== undefined ? { setNote: patch.setNote } : {}),
    })
    .where(and(eq(rules.userId, userId), eq(rules.id, id)));
  return getRule(db, userId, id);
}

/** Deleting a rule leaves past categorizations in place (their rule_id becomes null). */
export async function deleteRule(db: Db, userId: string, id: string): Promise<void> {
  await getRow(db, userId, id);
  await db.delete(rules).where(and(eq(rules.userId, userId), eq(rules.id, id)));
}

/** Sets priority = position for the given ids (one statement). Unknown ids are ignored. */
export async function reorderRules(
  d1: D1Database,
  db: Db,
  userId: string,
  ids: string[],
): Promise<RuleDto[]> {
  await d1
    .prepare(
      `update rules set priority = j.key + 1, updated_at = ?3
       from json_each(?1) as j where rules.id = j.value and rules.user_id = ?2`,
    )
    .bind(JSON.stringify(ids), userId, Date.now())
    .run();
  return listRules(db, userId);
}

interface TestRow {
  id: string;
  txn_date: string;
  amount_paise: number;
  direction: 'in' | 'out';
  raw_narration: string | null;
  note: string | null;
  counterparty_key: string | null;
  counterparty_name: string | null;
  vpa: string | null;
  account_id: string;
  channel: string | null;
  category_id: string | null;
  categorized_by: 'manual' | 'rule' | 'learned' | 'keyword' | 'ai' | 'none';
}

/** "Test rule against my history": scans the most recent transactions that pass the SQL prefilter. */
export async function testRule(
  d1: D1Database,
  userId: string,
  conditions: RuleConditions,
): Promise<RuleTestResponse> {
  const f = conditionsToSql(conditions);
  const { results } = await d1
    .prepare(
      `select t.id, t.txn_date, t.amount_paise, t.direction, t.raw_narration, t.note,
         cp.key as counterparty_key, cp.display_name as counterparty_name, t.vpa, t.account_id,
         t.channel, t.category_id, t.categorized_by
       from transactions t left join counterparties cp on cp.id = t.counterparty_id
       where t.user_id = ?1 and ${renumber(f.where, 1)}
       order by t.txn_date desc, t.created_at desc limit ${RULE_TEST_SCAN_LIMIT}`,
    )
    .bind(userId, ...f.params)
    .all<TestRow>();
  const predicate = compileConditions(conditions);
  const matches = results.filter((r) =>
    predicate({
      narration: r.raw_narration ?? r.note,
      counterpartyKey: r.counterparty_key,
      vpa: r.vpa,
      amountPaise: r.amount_paise,
      direction: r.direction,
      accountId: r.account_id,
      channel: r.channel as never,
    }),
  );
  return {
    scanned: results.length,
    matched: matches.length,
    manual: matches.filter((m) => m.categorized_by === 'manual').length,
    truncated: results.length === RULE_TEST_SCAN_LIMIT,
    sample: matches.slice(0, 20).map((m) => ({
      id: m.id,
      txnDate: m.txn_date,
      amountPaise: m.amount_paise,
      direction: m.direction,
      title: m.counterparty_name ?? m.note ?? m.raw_narration ?? 'Transaction',
      categoryId: m.category_id,
      categorizedBy: m.categorized_by,
    })),
  };
}

/** Re-runs the pipeline on past non-manual transactions matching this rule (chunked; loop on cursor). */
export async function applyRule(
  db: Db,
  d1: D1Database,
  userId: string,
  id: string,
  req: { cursor?: string; batchId?: string },
) {
  const row = await getRow(db, userId, id);
  const conditions = parseStoredConditions(row.conditions);
  if (!conditions || row.enabled !== 1) {
    return { processed: 0, changed: 0, nextCursor: null, batchId: req.batchId ?? newId() };
  }
  return runCategorizationChunk(
    db,
    d1,
    userId,
    { kind: 'rule', ruleId: id, conditions },
    { scope: 'all', cursor: req.cursor, batchId: req.batchId },
    'apply_rule',
  );
}
