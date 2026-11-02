import { and, asc, eq, sql } from 'drizzle-orm';
import {
  categorize,
  type CategorizationRunRequest,
  categorizationRunRequestSchema,
  type CategorizeContext,
  type CategorizeResult,
  type CompiledRuleRef,
  compileConditions,
  type LearnedLabelRef,
  normalizeNarration,
  parseStoredConditions,
  type RuleConditions,
} from '@kharcha/shared';
import type { Db } from '../db/client';
import { inJson } from '../db/batch';
import { categories, counterparties, learnedLabels, rules } from '../db/schema';
import { newId } from '../lib/ids';
import { getUncategorizedId } from './categories';

// ---------------------------------------------------------------------------- context

export interface Categorizer {
  ctx: CategorizeContext;
  /** Rule predicates by id (enabled rules only), for rule-scoped runs. */
  ruleById: Map<string, CompiledRuleRef>;
}

export function parseTagIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Loads the user's enabled rules, learned labels and active category slugs (3 small queries). */
export async function loadCategorizer(db: Db, userId: string): Promise<Categorizer> {
  const [ruleRows, labelRows, categoryRows] = await db.batch([
    db
      .select()
      .from(rules)
      .where(and(eq(rules.userId, userId), eq(rules.enabled, 1)))
      .orderBy(asc(rules.priority), asc(rules.createdAt)),
    db
      .select({
        id: learnedLabels.id,
        counterpartyId: learnedLabels.counterpartyId,
        direction: learnedLabels.direction,
        accountId: learnedLabels.accountId,
        categoryId: learnedLabels.categoryId,
      })
      .from(learnedLabels)
      .where(and(eq(learnedLabels.userId, userId), eq(learnedLabels.enabled, 1))),
    db
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(
        and(
          eq(categories.userId, userId),
          eq(categories.archived, 0),
          sql`${categories.slug} is not null`,
        ),
      ),
  ]);

  const compiled: CompiledRuleRef[] = [];
  for (const r of ruleRows) {
    const conditions = parseStoredConditions(r.conditions);
    if (!conditions) continue;
    compiled.push({
      id: r.id,
      name: r.name,
      categoryId: r.categoryId,
      setTagIds: parseTagIds(r.setTags),
      setNote: r.setNote,
      test: compileConditions(conditions),
    });
  }
  const learned = new Map<string, LearnedLabelRef[]>();
  for (const l of labelRows) {
    const list = learned.get(l.counterpartyId) ?? [];
    list.push(l);
    learned.set(l.counterpartyId, list);
  }
  const bySlug = new Map(categoryRows.map((c) => [c.slug as string, c.id]));
  return {
    ctx: { rules: compiled, learned, categoryIdBySlug: (s) => bySlug.get(s) },
    ruleById: new Map(compiled.map((r) => [r.id, r])),
  };
}

/** Effective counterparty id (after merges) for each existing key. One query. */
export async function resolveCounterpartyKeys(
  db: Db,
  userId: string,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: counterparties.id,
      key: counterparties.key,
      mergedIntoId: counterparties.mergedIntoId,
    })
    .from(counterparties)
    .where(and(eq(counterparties.userId, userId), inJson(counterparties.key, unique)));
  return new Map(rows.map((r) => [r.key, r.mergedIntoId ?? r.id]));
}

// ---------------------------------------------------------------------------- shared SQL

/** Upserts counterparties from a JSON array of {id, key, name, vpa}. Existing keys are kept as-is. */
export const UPSERT_COUNTERPARTIES_SQL = `insert or ignore into counterparties
    (id, user_id, key, display_name, vpa, txn_count, created_at, updated_at)
  select json_extract(value, '$.id'), ?1, json_extract(value, '$.key'), json_extract(value, '$.name'),
    json_extract(value, '$.vpa'), 0, ?2, ?2
  from json_each(?3)`;

/** Effective counterparty id for a key, resolved inside SQL (follows merges). */
export const COUNTERPARTY_ID_BY_KEY = (keyExpr: string, userParam: string) =>
  `(select coalesce(c.merged_into_id, c.id) from counterparties c where c.user_id = ${userParam} and c.key = ${keyExpr})`;

/** Refreshes txn_count / last_seen_date for the counterparties behind a JSON array of keys. */
export const REFRESH_COUNTERPARTIES_BY_KEYS_SQL = `update counterparties set
    txn_count = (select count(*) from transactions t where t.counterparty_id = counterparties.id),
    last_seen_date = (select max(t.txn_date) from transactions t where t.counterparty_id = counterparties.id)
  where user_id = ?1 and id in (
    select coalesce(c.merged_into_id, c.id) from counterparties c
    where c.user_id = ?1 and c.key in (select value from json_each(?2)))`;

/** Adds hits from a JSON array of {id, n} to rules or learned_labels. */
export const BUMP_HITS_SQL = (table: 'rules' | 'learned_labels') => `update ${table} set
    hit_count = hit_count + j.n, last_hit_at = ?3
  from (select json_extract(value, '$.id') as id, json_extract(value, '$.n') as n from json_each(?1)) as j
  where ${table}.id = j.id and ${table}.user_id = ?2`;

export function countHits(results: (CategorizeResult | null)[]) {
  const ruleHits = new Map<string, number>();
  const labelHits = new Map<string, number>();
  for (const r of results) {
    if (r?.ruleId) ruleHits.set(r.ruleId, (ruleHits.get(r.ruleId) ?? 0) + 1);
    if (r?.learnedLabelId)
      labelHits.set(r.learnedLabelId, (labelHits.get(r.learnedLabelId) ?? 0) + 1);
  }
  const toJson = (m: Map<string, number>) => JSON.stringify([...m].map(([id, n]) => ({ id, n })));
  return {
    rules: toJson(ruleHits),
    labels: toJson(labelHits),
    any: ruleHits.size + labelHits.size,
  };
}

export function hitStatements(
  d1: D1Database,
  userId: string,
  results: (CategorizeResult | null)[],
) {
  const hits = countHits(results);
  const now = Date.now();
  const out: D1PreparedStatement[] = [];
  if (hits.rules !== '[]')
    out.push(d1.prepare(BUMP_HITS_SQL('rules')).bind(hits.rules, userId, now));
  if (hits.labels !== '[]')
    out.push(d1.prepare(BUMP_HITS_SQL('learned_labels')).bind(hits.labels, userId, now));
  return out;
}

/** Category state captured in audit_log before/after for undo. */
export interface CategoryState {
  categoryId: string | null;
  categorizedBy: string;
  ruleId: string | null;
  learnedLabelId: string | null;
  confidence: number | null;
  reason: string | null;
  isSplit?: number;
}

/** json_object() of a transaction's category state, for INSERT … SELECT audit rows. */
export const CATEGORY_STATE_JSON = (t: string) =>
  `json_object('categoryId', ${t}.category_id, 'categorizedBy', ${t}.categorized_by,
    'ruleId', ${t}.rule_id, 'learnedLabelId', ${t}.learned_label_id, 'confidence', ${t}.confidence,
    'reason', ${t}.categorization_reason, 'isSplit', ${t}.is_split)`;

export const CATEGORY_ACTIONS = [
  'recategorize',
  'bulk_recategorize',
  'apply_learned',
  'apply_rule',
  'auto_categorize',
] as const;

// ---------------------------------------------------------------------------- re-run categorization

export const RUN_CHUNK = 250;

interface RunRow {
  id: string;
  raw_narration: string | null;
  note: string | null;
  direction: 'in' | 'out';
  amount_paise: number;
  account_id: string;
  account_type: string;
  channel: string | null;
  vpa: string | null;
  counterparty_id: string | null;
  counterparty_key: string | null;
  category_id: string | null;
  categorized_by: string;
  rule_id: string | null;
  learned_label_id: string | null;
  confidence: number | null;
  categorization_reason: string | null;
  source: string;
}

export type RunScope =
  | { kind: 'uncategorized' }
  | { kind: 'all' }
  | { kind: 'rule'; ruleId: string; conditions: RuleConditions };

/**
 * SQL prefilter for a rule's conditions. Regex conditions have no SQL equivalent (D1 has no
 * REGEXP), so they are left to the JS predicate, which always runs as the final check.
 */
export function conditionsToSql(conditions: RuleConditions): { where: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `?${params.length + 100}`; // placeholder, renumbered by caller
  };
  const textCol = {
    narration: `lower(coalesce(t.raw_narration, t.note, ''))`,
    counterparty_key: `lower(coalesce(cp.key, ''))`,
    vpa: `lower(coalesce(t.vpa, ''))`,
  } as const;
  for (const c of conditions.all) {
    switch (c.field) {
      case 'narration':
      case 'counterparty_key':
      case 'vpa':
        if (c.op === 'contains')
          parts.push(`instr(${textCol[c.field]}, ${p(c.value.toLowerCase())}) > 0`);
        else if (c.op === 'eq')
          parts.push(`trim(${textCol[c.field]}) = ${p(c.value.toLowerCase())}`);
        break;
      case 'amount':
        if (c.op === 'eq') parts.push(`t.amount_paise = ${p(c.value)}`);
        else if (c.op === 'gte') parts.push(`t.amount_paise >= ${p(c.value)}`);
        else if (c.op === 'lte') parts.push(`t.amount_paise <= ${p(c.value)}`);
        else parts.push(`t.amount_paise between ${p(c.value[0])} and ${p(c.value[1])}`);
        break;
      case 'direction':
        parts.push(`t.direction = ${p(c.value)}`);
        break;
      case 'account_id':
        parts.push(`t.account_id in (select value from json_each(${p(JSON.stringify(c.value))}))`);
        break;
      case 'channel':
        parts.push(`t.channel in (select value from json_each(${p(JSON.stringify(c.value))}))`);
        break;
    }
  }
  return { where: parts.length ? parts.join(' and ') : '1 = 1', params };
}

/** Renumbers `?101…` placeholders to follow `offset` fixed params. */
export function renumber(where: string, offset: number): string {
  return where.replace(/\?(\d{3,})/g, (_, n: string) => `?${Number(n) - 100 + offset}`);
}

export const RUN_SELECT = `select t.id, t.raw_narration, t.note, t.direction, t.amount_paise, t.account_id,
    a.type as account_type, t.channel, t.vpa, t.counterparty_id, cp.key as counterparty_key,
    t.category_id, t.categorized_by, t.rule_id, t.learned_label_id, t.confidence,
    t.categorization_reason, t.source
  from transactions t
  join accounts a on a.id = t.account_id
  left join counterparties cp on cp.id = t.counterparty_id`;

const UPDATE_FROM_JSON_SQL = `update transactions set
    channel = coalesce(j.channel, transactions.channel),
    vpa = coalesce(j.vpa, transactions.vpa),
    ifsc_prefix = coalesce(j.ifsc, transactions.ifsc_prefix),
    counterparty_id = coalesce(${COUNTERPARTY_ID_BY_KEY('j.cpKey', '?2')}, transactions.counterparty_id),
    category_id = coalesce(j.categoryId, transactions.category_id),
    categorized_by = coalesce(j.categorizedBy, transactions.categorized_by),
    rule_id = case when j.categorizedBy is null then transactions.rule_id
      else (select r.id from rules r where r.id = j.ruleId and r.user_id = ?2) end,
    learned_label_id = case when j.categorizedBy is null then transactions.learned_label_id
      else (select l.id from learned_labels l where l.id = j.learnedLabelId and l.user_id = ?2) end,
    confidence = case when j.categorizedBy is null then transactions.confidence else j.confidence end,
    categorization_reason = case when j.categorizedBy is null then transactions.categorization_reason else j.reason end,
    updated_at = ?3
  from (select json_extract(value, '$.id') as id, json_extract(value, '$.channel') as channel,
      json_extract(value, '$.vpa') as vpa, json_extract(value, '$.ifsc') as ifsc,
      json_extract(value, '$.cpKey') as cpKey, json_extract(value, '$.categoryId') as categoryId,
      json_extract(value, '$.categorizedBy') as categorizedBy, json_extract(value, '$.ruleId') as ruleId,
      json_extract(value, '$.learnedLabelId') as learnedLabelId, json_extract(value, '$.confidence') as confidence,
      json_extract(value, '$.reason') as reason
    from json_each(?1)) as j
  where transactions.id = j.id and transactions.user_id = ?2 and transactions.categorized_by != 'manual'`;

const AUDIT_FROM_JSON_SQL = `insert into audit_log (id, user_id, batch_id, action, entity, entity_id, before, after, created_at)
  select lower(hex(randomblob(16))), ?1, ?2, ?3, 'transaction', json_extract(value, '$.id'),
    json_extract(value, '$.before'), json_extract(value, '$.after'), ?4
  from json_each(?5)`;

/**
 * Runs the engine over one chunk of non-manual, non-split, non-transfer transactions and writes
 * the differences (plus normalization backfill for imported rows that predate Phase 3).
 * Callers loop with `nextCursor`; every chunk shares `batchId`, so the whole run undoes at once.
 */
export async function runCategorizationChunk(
  db: Db,
  d1: D1Database,
  userId: string,
  scope: RunScope,
  rawReq: CategorizationRunRequest,
  action: 'auto_categorize' | 'apply_rule' = 'auto_categorize',
) {
  const req = categorizationRunRequestSchema.parse(rawReq);
  const batchId = req.batchId ?? newId();
  const { ctx, ruleById } = await loadCategorizer(db, userId);
  const uncategorizedId = await getUncategorizedId(db, userId);

  let where = `t.user_id = ?1 and t.is_split = 0 and t.transfer_group_id is null and t.id > ?2`;
  let params: unknown[] = [userId, req.cursor ?? ''];
  if (scope.kind === 'uncategorized') where += ` and t.categorized_by = 'none'`;
  else where += ` and t.categorized_by != 'manual'`;
  if (scope.kind === 'rule') {
    const f = conditionsToSql(scope.conditions);
    where += ` and ${renumber(f.where, params.length)}`;
    params = [...params, ...f.params];
  }
  const { results: rows } = await d1
    .prepare(`${RUN_SELECT} where ${where} order by t.id limit ${RUN_CHUNK}`)
    .bind(...params)
    .all<RunRow>();

  // Backfill normalization for imported rows that have no counterparty/channel yet.
  const backfill = new Map<string, ReturnType<typeof normalizeNarration>>();
  for (const r of rows) {
    if (r.source !== 'manual' && r.raw_narration && !r.counterparty_id && !r.channel) {
      backfill.set(r.id, normalizeNarration(r.raw_narration, r.account_type as never));
    }
  }
  const newKeys = [...backfill.values()].flatMap((n) =>
    n.counterpartyKey ? [n.counterpartyKey] : [],
  );
  const keyIds = await resolveCounterpartyKeys(db, userId, newKeys);

  const rulePredicate = scope.kind === 'rule' ? compileConditions(scope.conditions) : null;
  const updates: Record<string, unknown>[] = [];
  const audits: { id: string; before: CategoryState; after: CategoryState }[] = [];
  const applied: (CategorizeResult | null)[] = [];
  const cpUpserts = new Map<
    string,
    { id: string; key: string; name: string; vpa: string | null }
  >();

  for (const r of rows) {
    const n = backfill.get(r.id);
    const cpKey = n?.counterpartyKey ?? r.counterparty_key;
    const input = {
      narration: r.raw_narration ?? r.note,
      counterpartyKey: cpKey,
      counterpartyId: r.counterparty_id ?? (cpKey ? (keyIds.get(cpKey) ?? null) : null),
      vpa: n?.vpa ?? r.vpa,
      amountPaise: r.amount_paise,
      direction: r.direction,
      accountId: r.account_id,
      accountType: r.account_type as never,
      channel: (n?.channel ?? r.channel) as never,
    };
    if (rulePredicate && !rulePredicate(input)) continue;
    if (scope.kind === 'rule' && !ruleById.has(scope.ruleId)) continue;

    const result = categorize(input, ctx);
    const after: CategoryState = result
      ? {
          categoryId: result.categoryId,
          categorizedBy: result.categorizedBy,
          ruleId: result.ruleId,
          learnedLabelId: result.learnedLabelId,
          confidence: result.confidence,
          reason: result.reason,
        }
      : {
          categoryId: uncategorizedId,
          categorizedBy: 'none',
          ruleId: null,
          learnedLabelId: null,
          confidence: null,
          reason: null,
        };
    const before: CategoryState = {
      categoryId: r.category_id,
      categorizedBy: r.categorized_by,
      ruleId: r.rule_id,
      learnedLabelId: r.learned_label_id,
      confidence: r.confidence,
      reason: r.categorization_reason,
      isSplit: 0,
    };
    const changed =
      before.categoryId !== after.categoryId ||
      before.categorizedBy !== after.categorizedBy ||
      before.ruleId !== after.ruleId ||
      before.learnedLabelId !== after.learnedLabelId;

    if (n?.counterpartyKey && n.payee) {
      cpUpserts.set(n.counterpartyKey, {
        id: newId(),
        key: n.counterpartyKey,
        name: n.payee,
        vpa: n.vpa,
      });
    }
    if (!changed && !n) continue;
    updates.push({
      id: r.id,
      channel: n?.channel ?? null,
      vpa: n?.vpa ?? null,
      ifsc: n?.ifscPrefix ?? null,
      cpKey: n?.counterpartyKey ?? null,
      ...(changed ? after : {}),
    });
    if (changed) {
      audits.push({ id: r.id, before, after });
      applied.push(result);
    }
  }

  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if (cpUpserts.size) {
    stmts.push(
      d1
        .prepare(UPSERT_COUNTERPARTIES_SQL)
        .bind(userId, now, JSON.stringify([...cpUpserts.values()])),
    );
  }
  if (audits.length) {
    stmts.push(
      d1.prepare(AUDIT_FROM_JSON_SQL).bind(userId, batchId, action, now, JSON.stringify(audits)),
    );
  }
  if (updates.length) {
    stmts.push(d1.prepare(UPDATE_FROM_JSON_SQL).bind(JSON.stringify(updates), userId, now));
  }
  if (cpUpserts.size) {
    stmts.push(
      d1
        .prepare(REFRESH_COUNTERPARTIES_BY_KEYS_SQL)
        .bind(userId, JSON.stringify([...cpUpserts.keys()])),
    );
  }
  stmts.push(...hitStatements(d1, userId, applied));
  if (stmts.length) await d1.batch(stmts);

  const last = rows.at(-1);
  return {
    processed: rows.length,
    changed: audits.length,
    nextCursor: rows.length === RUN_CHUNK && last ? last.id : null,
    batchId,
  };
}
