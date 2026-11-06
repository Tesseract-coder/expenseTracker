import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import {
  BACKUP_EXCLUDED_SETTINGS,
  columnMappingSchema,
  ruleConditionsSchema,
  BACKUP_PAGE_SIZE,
  BACKUP_TABLES,
  type BackupRow,
  type BackupTable,
  type RestoreChunk,
} from '@kharcha/shared';
import * as schema from '../db/schema';
import { ApiException } from '../lib/errors';
import { newId } from '../lib/ids';
import { log } from '../lib/logger';

/**
 * Backup/restore, driven by the Drizzle schema: column lists and foreign keys come from the table
 * definitions, so a new column is backed up without touching this file. Every statement binds the
 * rows as one JSON parameter (`json_each`), filters by user and checks that every reference
 * points at the same user's rows.
 */
const TABLES: Record<BackupTable, SQLiteTable> = {
  parser_profiles: schema.parserProfiles,
  accounts: schema.accounts,
  categories: schema.categories,
  counterparties: schema.counterparties,
  rules: schema.rules,
  learned_labels: schema.learnedLabels,
  imports: schema.imports,
  tags: schema.tags,
  transactions: schema.transactions,
  transaction_splits: schema.transactionSplits,
  transaction_tags: schema.transactionTags,
  budgets: schema.budgets,
  settings: schema.settings,
};

export interface TableMeta {
  name: BackupTable;
  /** Every column except user_id. */
  columns: string[];
  hasUserId: boolean;
  /** References to other owned tables (checked for ownership on restore). */
  refs: { column: string; table: string; key: string }[];
  /** References to this table itself (restored in the links pass). */
  selfLinks: string[];
}

const metaCache = new Map<BackupTable, TableMeta>();
export function tableMeta(name: BackupTable): TableMeta {
  const cached = metaCache.get(name);
  if (cached) return cached;
  const cfg = getTableConfig(TABLES[name]);
  const refs: TableMeta['refs'] = [];
  const selfLinks: string[] = [];
  for (const fk of cfg.foreignKeys) {
    const r = fk.reference();
    const column = (r.columns[0] as { name: string }).name;
    const target = getTableConfig(r.foreignTable).name;
    if (target === 'users') continue;
    if (target === name) selfLinks.push(column);
    else refs.push({ column, table: target, key: (r.foreignColumns[0] as { name: string }).name });
  }
  const all = cfg.columns.map((c) => c.name);
  const meta: TableMeta = {
    name,
    columns: all.filter((c) => c !== 'user_id'),
    hasUserId: all.includes('user_id'),
    refs,
    selfLinks,
  };
  metaCache.set(name, meta);
  return meta;
}

const RESTORE_STATE_KEY = 'restore_state';
/** Settings that survive the wipe: the restore marker, and the seed version (so a request on
 * another isolate can't re-seed categories mid-restore). */
const KEPT_SETTINGS = [RESTORE_STATE_KEY, 'category_seed_version'];

const ownedBy = (table: string) =>
  table === 'transaction_tags'
    ? `transaction_id in (select id from transactions where user_id = ?1)`
    : `user_id = ?1`;

// ---------------------------------------------------------------------------------- export

export async function exportPage(
  d1: D1Database,
  userId: string,
  table: BackupTable,
  after: number,
): Promise<{ rows: BackupRow[]; next: number | null }> {
  const meta = tableMeta(table);
  const excluded =
    table === 'settings'
      ? ` and key not in (${BACKUP_EXCLUDED_SETTINGS.map((k) => `'${k}'`).join(', ')})`
      : '';
  const { results } = await d1
    .prepare(
      `select rowid as "_rowid", ${meta.columns.map((c) => `"${c}"`).join(', ')} from ${table}
       where ${ownedBy(table)}${excluded} and rowid > ?2 order by rowid limit ?3`,
    )
    .bind(userId, after, BACKUP_PAGE_SIZE)
    .all<Record<string, string | number | null>>();
  const rows = results.map(({ _rowid, ...row }) => row);
  const last = results.at(-1);
  return {
    rows,
    next: results.length === BACKUP_PAGE_SIZE && last ? Number(last._rowid) : null,
  };
}

// --------------------------------------------------------------------------------- restore

interface RestoreState {
  id: string;
  startedAt: number;
  /** Row counts the backup file declared, checked by finish. */
  counts: Record<BackupTable, number>;
}

async function restoreState(d1: D1Database, userId: string): Promise<RestoreState | null> {
  const row = await d1
    .prepare(`select value from settings where user_id = ?1 and key = ?2`)
    .bind(userId, RESTORE_STATE_KEY)
    .first<{ value: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as RestoreState;
  } catch {
    return null;
  }
}

export async function backupStatus(d1: D1Database, userId: string) {
  const state = await restoreState(d1, userId);
  return { restoreInProgress: state ? { startedAt: state.startedAt } : null };
}

/**
 * Deletes everything the user owns (children first) and marks a restore as in progress, in one
 * atomic batch. Undo history and caches go too; R2 statement files are kept (imports restored
 * with the same ids find them again).
 */
export async function startRestore(
  d1: D1Database,
  userId: string,
  counts: Record<BackupTable, number>,
): Promise<{ restoreId: string }> {
  const state: RestoreState = { id: newId(), startedAt: Date.now(), counts };
  const wipe = [
    'transaction_tags',
    'transaction_splits',
    'audit_log',
    'recurring_series',
    'budgets',
    'transactions',
    'learned_labels',
    'rules',
    'imports',
    'tags',
    'counterparties',
    'categories',
    'accounts',
    'parser_profiles',
  ].flatMap((t) => [
    // categories.parent_id is ON DELETE RESTRICT (checked per row): children first.
    ...(t === 'categories'
      ? [
          d1
            .prepare(`delete from categories where user_id = ?1 and parent_id is not null`)
            .bind(userId),
        ]
      : []),
    d1.prepare(`delete from ${t} where ${ownedBy(t)}`).bind(userId),
  ]);
  await d1.batch([
    ...wipe,
    d1
      .prepare(
        `delete from settings where user_id = ?1 and key not in (${KEPT_SETTINGS.map((_, i) => `?${i + 2}`).join(', ')})`,
      )
      .bind(userId, ...KEPT_SETTINGS),
    d1
      .prepare(
        `insert into settings (user_id, key, value, updated_at) values (?1, ?2, ?3, ?4)
         on conflict (user_id, key) do update set value = excluded.value`,
      )
      .bind(userId, RESTORE_STATE_KEY, JSON.stringify(state), state.startedAt),
  ]);
  log.info('restore started');
  return { restoreId: state.id };
}

async function requireRestore(
  d1: D1Database,
  userId: string,
  restoreId: string,
): Promise<RestoreState> {
  const state = await restoreState(d1, userId);
  if (!state || state.id !== restoreId)
    throw new ApiException(409, 'no_restore', 'This restore is no longer running. Start again.');
  return state;
}

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * JSON text columns are checked with the same schemas the API uses, so a hand-edited or hostile
 * backup can't plant data the app would later choke on (e.g. a rule with an unsafe regex).
 */
const JSON_COLUMNS: Partial<Record<BackupTable, Record<string, z.ZodType>>> = {
  parser_profiles: { mapping: columnMappingSchema },
  rules: {
    conditions: ruleConditionsSchema,
    set_tags: z.array(z.string().max(64)).max(50).nullable(),
  },
  settings: { value: z.unknown() },
};

function checkJson(meta: TableMeta, rows: BackupRow[]) {
  const cols = JSON_COLUMNS[meta.name];
  if (!cols) return;
  for (const row of rows) {
    for (const [col, schema] of Object.entries(cols)) {
      const raw = row[col];
      if (raw === undefined || (raw === null && col === 'set_tags')) continue;
      let ok = typeof raw === 'string';
      if (ok) {
        try {
          ok = schema.safeParse(JSON.parse(raw as string)).success;
        } catch {
          ok = false;
        }
      }
      if (!ok)
        throw new ApiException(
          400,
          'restore_invalid',
          `The backup's ${meta.name} contain an invalid value.`,
        );
    }
  }
}

function checkColumns(meta: TableMeta, rows: BackupRow[]): string[] {
  const known = new Set(meta.columns);
  const used = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!known.has(key))
        throw new ApiException(
          400,
          'restore_invalid',
          `Unknown column "${key}" in ${meta.name}. Was this backup made by a newer version?`,
        );
      used.add(key);
    }
    if (
      meta.name === 'settings' &&
      (BACKUP_EXCLUDED_SETTINGS as readonly unknown[]).includes(row.key)
    )
      throw new ApiException(400, 'restore_invalid', 'This backup file is damaged.');
  }
  // Keep schema order; columns missing from every row fall back to their defaults.
  return meta.columns.filter((c) => used.has(c));
}

const refCheck = (r: TableMeta['refs'][number]) => {
  const v = `json_extract(j.value, ${sqlStr(`$.${r.column}`)})`;
  return `(${v} is null or ${v} in (select ${r.key} from ${r.table} where ${ownedBy(r.table)}))`;
};

function insertSql(meta: TableMeta, cols: string[]): string {
  const values = cols.map((c) =>
    meta.selfLinks.includes(c) ? 'null' : `json_extract(j.value, ${sqlStr(`$.${c}`)})`,
  );
  const target = [...cols, ...(meta.hasUserId ? ['user_id'] : [])].map((c) => `"${c}"`);
  const where = meta.refs.filter((r) => cols.includes(r.column)).map(refCheck);
  // Settings keep the seed version across the wipe, so a backup's copy replaces it.
  const conflict =
    meta.name === 'settings'
      ? ' on conflict (user_id, key) do update set value = excluded.value'
      : '';
  return `insert into ${meta.name} (${target.join(', ')})
    select ${[...values, ...(meta.hasUserId ? ['?1'] : [])].join(', ')} from json_each(?2) as j
    where ${where.length ? where.join(' and ') : '1'}${conflict}`;
}

function linkSql(meta: TableMeta, col: string): string {
  return `update ${meta.name} set "${col}" = l.v
    from (select json_extract(value, '$.id') as id, json_extract(value, ${sqlStr(`$.${col}`)}) as v
          from json_each(?2)) as l
    where ${meta.name}.id = l.id and ${meta.name}.user_id = ?1 and l.v is not null
      and l.v in (select id from ${meta.name} where user_id = ?1)`;
}

/** Writes one chunk. Every row must land: a skipped row means a reference outside the backup. */
export async function restoreChunk(
  d1: D1Database,
  userId: string,
  chunk: RestoreChunk,
): Promise<{ written: number }> {
  await requireRestore(d1, userId, chunk.restoreId);
  const meta = tableMeta(chunk.table);
  const cols = checkColumns(meta, chunk.rows);
  if (chunk.phase === 'rows') checkJson(meta, chunk.rows);
  const json = JSON.stringify(chunk.rows);

  let stmts: D1PreparedStatement[];
  let expected: number;
  if (chunk.phase === 'rows') {
    stmts = [d1.prepare(insertSql(meta, cols)).bind(userId, json)];
    expected = chunk.rows.length;
  } else {
    const linkCols = meta.selfLinks.filter((c) => cols.includes(c));
    if (linkCols.length === 0 || !cols.includes('id'))
      throw new ApiException(400, 'restore_invalid', `${meta.name} has no links to restore.`);
    stmts = linkCols.map((c) => d1.prepare(linkSql(meta, c)).bind(userId, json));
    expected = chunk.rows.reduce(
      (n, r) => n + linkCols.filter((c) => r[c] !== null && r[c] !== undefined).length,
      0,
    );
  }

  let results: D1Result[];
  try {
    results = await d1.batch(stmts);
  } catch (err) {
    // Constraint names only, never row content.
    const msg = err instanceof Error ? err.message : '';
    const kind = /UNIQUE|PRIMARY KEY/i.test(msg)
      ? 'a duplicate row'
      : /FOREIGN KEY/i.test(msg)
        ? 'a missing reference'
        : /CHECK|NOT NULL/i.test(msg)
          ? 'an invalid value'
          : 'unreadable data';
    log.warn('restore chunk failed', { errorName: err instanceof Error ? err.name : 'unknown' });
    throw new ApiException(400, 'restore_invalid', `The backup's ${meta.name} contain ${kind}.`);
  }
  const written = results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  if (written !== expected)
    throw new ApiException(
      400,
      'restore_invalid',
      `${expected - written} ${meta.name} rows refer to data that isn't in this backup.`,
    );
  return { written };
}

/** Confirms every table has the expected row count, then clears the restore marker. */
export async function finishRestore(
  d1: D1Database,
  userId: string,
  restoreId: string,
): Promise<{ counts: Record<BackupTable, number> }> {
  const { counts: expected } = await requireRestore(d1, userId, restoreId);
  const excluded = BACKUP_EXCLUDED_SETTINGS.map((k) => `'${k}'`).join(', ');
  const results = await d1.batch(
    BACKUP_TABLES.map((t) =>
      d1
        .prepare(
          `select count(*) as n from ${t} where ${ownedBy(t)}${t === 'settings' ? ` and key not in (${excluded})` : ''}`,
        )
        .bind(userId),
    ),
  );
  const counts = Object.fromEntries(
    BACKUP_TABLES.map((t, i) => [t, Number((results[i]?.results[0] as { n: number }).n)]),
  ) as Record<BackupTable, number>;
  const off = BACKUP_TABLES.filter((t) => counts[t] !== expected[t]);
  if (off.length)
    throw new ApiException(
      409,
      'restore_incomplete',
      `Restore is incomplete (${off.join(', ')}). Restore again from the same file.`,
    );
  await d1
    .prepare(`delete from settings where user_id = ?1 and key = ?2`)
    .bind(userId, RESTORE_STATE_KEY)
    .run();
  log.info('restore finished', { inserted: counts.transactions });
  return { counts };
}

/** Exposed for tests: the shared constant must match the schema's self-references. */
export const schemaSelfLinks = () =>
  Object.fromEntries(
    BACKUP_TABLES.map((t) => [t, tableMeta(t).selfLinks] as const).filter(([, l]) => l.length > 0),
  );
