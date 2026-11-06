import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  type BackupFile,
  backupCounts,
  backupPageResponseSchema,
  planRestore,
  restoreChunkResponseSchema,
  restoreFinishResponseSchema,
  restoreStartResponseSchema,
} from '@kharcha/shared';
import { apiGet, apiPost } from '@/lib/api';

export type Progress = (done: number, total: number, label: string) => void;

const TABLE_LABEL: Record<(typeof BACKUP_TABLES)[number], string> = {
  parser_profiles: 'column mappings',
  accounts: 'accounts',
  categories: 'categories',
  counterparties: 'payees',
  rules: 'rules',
  learned_labels: 'learned labels',
  imports: 'imports',
  tags: 'tags',
  transactions: 'transactions',
  transaction_splits: 'splits',
  transaction_tags: 'tags on transactions',
  budgets: 'budgets',
  settings: 'settings',
};
export const tableLabel = (t: (typeof BACKUP_TABLES)[number]) => TABLE_LABEL[t];

/** Pages through every table (each request stays small for the Worker's CPU budget). */
export async function exportBackup(onProgress?: Progress): Promise<BackupFile> {
  const tables = {} as BackupFile['tables'];
  for (const [i, table] of BACKUP_TABLES.entries()) {
    const rows: BackupFile['tables'][typeof table] = [];
    let after: number | null = 0;
    while (after !== null) {
      onProgress?.(i, BACKUP_TABLES.length, `Saving ${TABLE_LABEL[table]}…`);
      const page: { rows: BackupFile['tables'][typeof table]; next: number | null } = await apiGet(
        `/backup?table=${table}${after ? `&after=${after}` : ''}`,
        backupPageResponseSchema,
      );
      rows.push(...page.rows);
      after = page.next;
    }
    tables[table] = rows;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(), tables };
}

/**
 * Replaces everything with the backup: start (wipes your data), chunks, then finish (verifies
 * every table's row count). If it stops halfway, restoring the same file again fixes it.
 */
export async function restoreBackup(file: BackupFile, onProgress?: Progress) {
  const steps = planRestore(file);
  const total = steps.length + 2;
  onProgress?.(0, total, 'Clearing current data…');
  const { restoreId } = await apiPost(
    '/backup/restore',
    { format: file.format, version: file.version, counts: backupCounts(file) },
    restoreStartResponseSchema,
  );
  for (const [i, step] of steps.entries()) {
    onProgress?.(
      i + 1,
      total,
      step.phase === 'rows' ? `Restoring ${TABLE_LABEL[step.table]}…` : 'Linking records…',
    );
    await apiPost('/backup/restore/chunk', { restoreId, ...step }, restoreChunkResponseSchema);
  }
  onProgress?.(total - 1, total, 'Checking…');
  return apiPost('/backup/restore/finish', { restoreId }, restoreFinishResponseSchema);
}
