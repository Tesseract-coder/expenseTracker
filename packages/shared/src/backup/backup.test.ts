import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  type BackupFile,
  RESTORE_CHUNK_ROWS,
  backupCounts,
  backupFileName,
  parseBackupFile,
  planRestore,
} from '.';

function file(tables: Partial<BackupFile['tables']> = {}): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: 0,
    tables: Object.fromEntries(
      BACKUP_TABLES.map((t) => [t, tables[t] ?? []]),
    ) as BackupFile['tables'],
  };
}

describe('parseBackupFile', () => {
  it.each([
    ['not JSON', '{', 'not valid JSON'],
    ['another app', JSON.stringify({ hello: 1 }), "isn't a Kharcha backup file"],
    ['newer version', JSON.stringify({ format: BACKUP_FORMAT, version: 9 }), 'version 9'],
    [
      'missing tables',
      JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: 1 }),
      'damaged',
    ],
    [
      'bad cell',
      JSON.stringify({ ...file(), tables: { ...file().tables, tags: [{ id: { x: 1 } }] } }),
      'damaged',
    ],
    [
      'device-only setting',
      JSON.stringify(file({ settings: [{ key: 'restore_state', value: '{}' }] })),
      'damaged',
    ],
  ])('rejects %s', (_n, text, message) => {
    const r = parseBackupFile(text);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.error).toContain(message);
  });

  it('accepts a valid file', () => {
    const r = parseBackupFile(JSON.stringify(file({ tags: [{ id: 't', name: 'x' }] })));
    expect(r.ok && backupCounts(r.file).tags).toBe(1);
  });
});

describe('planRestore', () => {
  it('chunks rows in table order, then adds self-links for rows that have one', () => {
    const txns = Array.from({ length: RESTORE_CHUNK_ROWS + 1 }, (_, i) => ({
      id: `t${i}`,
      reimbursed_by_txn_id: i === 0 ? 't1' : null,
    }));
    const steps = planRestore(
      file({
        categories: [
          { id: 'c1', parent_id: null },
          { id: 'c2', parent_id: 'c1' },
        ],
        transactions: txns,
        tags: [{ id: 'g' }],
      }),
    );
    expect(steps.map((s) => `${s.table}:${s.phase}:${s.rows.length}`)).toEqual([
      'categories:rows:2',
      'tags:rows:1',
      `transactions:rows:${RESTORE_CHUNK_ROWS}`,
      'transactions:rows:1',
      'categories:links:1',
      'transactions:links:1',
    ]);
    expect(steps.at(-1)?.rows).toEqual([{ id: 't0', reimbursed_by_txn_id: 't1' }]);
  });
});

it('names backups by IST date', () => {
  expect(backupFileName(Date.UTC(2026, 10, 5, 20, 0))).toBe('kharcha-backup-2026-11-06.json');
});
