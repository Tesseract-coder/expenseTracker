/**
 * Full backup (JSON) and restore. The file holds every row you own, table by table, with the
 * database's own column names; `user_id` is left out and set by the server on restore. Caches
 * (recurring series) and history (audit log) aren't included; original statement files stay in
 * R2 and aren't part of the file.
 *
 * Export and restore run in chunks (Workers Free: 10 ms CPU per request): the browser pages
 * through `GET /api/backup`, and restores with start → chunks → finish.
 */
import { z } from 'zod';
import { idSchema } from '../schemas/primitives';

export const BACKUP_FORMAT = 'kharcha-backup';
export const BACKUP_VERSION = 1;

/** Restore order: every table comes after the tables it references. */
export const BACKUP_TABLES = [
  'parser_profiles',
  'accounts',
  'categories',
  'counterparties',
  'rules',
  'learned_labels',
  'imports',
  'tags',
  'transactions',
  'transaction_splits',
  'transaction_tags',
  'budgets',
  'settings',
] as const;
export type BackupTable = (typeof BACKUP_TABLES)[number];

/**
 * Columns that reference their own table. They're restored in a second "links" pass, once all
 * rows exist, so row order inside a table never matters. (The API test checks this against the
 * schema.)
 */
export const BACKUP_SELF_LINKS: Partial<Record<BackupTable, readonly string[]>> = {
  categories: ['parent_id'],
  counterparties: ['merged_into_id'],
  transactions: ['reimbursed_by_txn_id'],
};

/** Settings keys that belong to this device/session, never to a backup. */
export const BACKUP_EXCLUDED_SETTINGS = ['restore_state'] as const;

export const BACKUP_PAGE_SIZE = 1000;
export const RESTORE_CHUNK_ROWS = 400;

const cellSchema = z.union([z.string().max(20_000), z.number().finite(), z.null()]);
export const backupRowSchema = z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), cellSchema);
export type BackupRow = z.infer<typeof backupRowSchema>;

const tableEnum = z.enum(BACKUP_TABLES);
const countsSchema = z.record(tableEnum, z.number().int().min(0).max(1_000_000));

export const backupFileSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.number().int(),
  tables: z.record(tableEnum, z.array(backupRowSchema)),
});
export type BackupFile = z.infer<typeof backupFileSchema>;

export const backupPageQuerySchema = z.object({
  table: tableEnum,
  after: z.coerce.number().int().min(0).default(0),
});
export const backupPageResponseSchema = z.object({
  rows: z.array(backupRowSchema),
  /** Pass as `after` for the next page; null when the table is done. */
  next: z.number().int().nullable(),
});

export const restoreStartSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  counts: countsSchema,
});
export const restoreStartResponseSchema = z.object({ restoreId: z.string() });

export const restoreChunkSchema = z.object({
  restoreId: idSchema,
  table: tableEnum,
  phase: z.enum(['rows', 'links']),
  rows: z.array(backupRowSchema).min(1).max(RESTORE_CHUNK_ROWS),
});
export type RestoreChunk = z.infer<typeof restoreChunkSchema>;
export const restoreChunkResponseSchema = z.object({ written: z.number().int() });

export const restoreFinishSchema = z.object({ restoreId: idSchema });
export const restoreFinishResponseSchema = z.object({ counts: countsSchema });

export const backupStatusResponseSchema = z.object({
  restoreInProgress: z.object({ startedAt: z.number().int() }).nullable(),
});

export function backupFileName(exportedAt: number): string {
  const d = new Date(exportedAt + 5.5 * 3600_000); // IST date
  return `kharcha-backup-${d.toISOString().slice(0, 10)}.json`;
}

export function backupCounts(file: BackupFile): Record<BackupTable, number> {
  return Object.fromEntries(BACKUP_TABLES.map((t) => [t, file.tables[t]?.length ?? 0])) as Record<
    BackupTable,
    number
  >;
}

/**
 * Parses and checks a backup file. Returns a friendly error instead of throwing, because the
 * file comes from the user (possibly another app, or a different version).
 */
export function parseBackupFile(
  text: string,
): { ok: true; file: BackupFile } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "This isn't a Kharcha backup (not valid JSON)." };
  }
  const head = z.object({ format: z.string(), version: z.number() }).safeParse(json);
  if (!head.success || head.data.format !== BACKUP_FORMAT)
    return { ok: false, error: "This isn't a Kharcha backup file." };
  if (head.data.version !== BACKUP_VERSION)
    return {
      ok: false,
      error: `This backup is version ${head.data.version}; this app reads version ${BACKUP_VERSION}.`,
    };
  const parsed = backupFileSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: 'This backup file is damaged or incomplete.' };
  for (const row of parsed.data.tables.settings ?? []) {
    if ((BACKUP_EXCLUDED_SETTINGS as readonly unknown[]).includes(row.key))
      return { ok: false, error: 'This backup file is damaged or incomplete.' };
  }
  return { ok: true, file: parsed.data };
}

export interface RestoreStep {
  table: BackupTable;
  phase: 'rows' | 'links';
  rows: BackupRow[];
}

/** Chunked restore plan: all rows in table order, then self-links (only rows that have one). */
export function planRestore(file: BackupFile): RestoreStep[] {
  const steps: RestoreStep[] = [];
  const chunk = (table: BackupTable, phase: RestoreStep['phase'], rows: BackupRow[]) => {
    for (let i = 0; i < rows.length; i += RESTORE_CHUNK_ROWS)
      steps.push({ table, phase, rows: rows.slice(i, i + RESTORE_CHUNK_ROWS) });
  };
  for (const t of BACKUP_TABLES) chunk(t, 'rows', file.tables[t] ?? []);
  for (const t of BACKUP_TABLES) {
    const cols = BACKUP_SELF_LINKS[t];
    if (!cols) continue;
    const links = (file.tables[t] ?? [])
      .filter((r) => cols.some((c) => r[c] !== null && r[c] !== undefined))
      .map((r) =>
        Object.fromEntries([['id', r.id ?? null], ...cols.map((c) => [c, r[c] ?? null])]),
      );
    chunk(t, 'links', links);
  }
  return steps;
}
