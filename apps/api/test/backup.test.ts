import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_PAGE_SIZE,
  BACKUP_SELF_LINKS,
  BACKUP_TABLES,
  BACKUP_VERSION,
  type BackupFile,
  backupCounts,
  backupPageResponseSchema,
  planRestore,
} from '@kharcha/shared';
import { schemaSelfLinks } from '../src/services/backup';
import { call, categoryIdBySlug, getJson, importRows, patchJson, postJson } from './helpers';

const { hdfcSavings } = env.TEST_FIXTURES;

async function exportAll(): Promise<BackupFile> {
  const tables = {} as BackupFile['tables'];
  for (const table of BACKUP_TABLES) {
    tables[table] = [];
    let after: number | null = 0;
    while (after !== null) {
      const res = await getJson(`/api/backup?table=${table}${after ? `&after=${after}` : ''}`);
      expect(res.status).toBe(200);
      const page = backupPageResponseSchema.parse(res.body);
      tables[table].push(...page.rows);
      after = page.next;
    }
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(), tables };
}

async function restore(file: BackupFile) {
  const start = await postJson('/api/backup/restore', {
    format: file.format,
    version: file.version,
    counts: backupCounts(file),
  });
  expect(start.status).toBe(201);
  const { restoreId } = start.body;
  for (const step of planRestore(file)) {
    const res = await postJson('/api/backup/restore/chunk', { restoreId, ...step });
    if (res.status !== 200) return { restoreId, failed: res };
  }
  return { restoreId, finish: await postJson('/api/backup/restore/finish', { restoreId }) };
}

/** Rows sorted by a stable key, so exports can be compared regardless of rowid order. */
const normalize = (file: BackupFile) =>
  Object.fromEntries(
    BACKUP_TABLES.map((t) => [
      t,
      [...file.tables[t]].sort((a, b) =>
        JSON.stringify([a.id, a.key, a.transaction_id, a.tag_id]).localeCompare(
          JSON.stringify([b.id, b.key, b.transaction_id, b.tag_id]),
        ),
      ),
    ]),
  );

let hdfc: string;
let ids: Record<string, string>;

beforeEach(async () => {
  hdfc = (
    await postJson('/api/accounts', {
      name: 'HDFC',
      type: 'savings',
      bank: 'hdfc',
      last4: '1234',
      openingBalanceDate: '2026-09-30',
    })
  ).body.account.id;
  ids = await categoryIdBySlug();
});

/** A bit of everything: import, rule, learned label, split, tags, reimbursement, budget, settings. */
async function seedEverything() {
  await importRows(hdfc, hdfcSavings);
  await postJson('/api/rules', {
    name: 'Veg vendor',
    conditions: { all: [{ field: 'vpa', op: 'eq', value: 'ramesh.k@okaxis' }] },
    categoryId: ids.grocery,
    setTags: ['sabzi'],
  });
  const txns = (await getJson('/api/transactions')).body.transactions;
  const swiggy = txns.find((t: any) => t.amountPaise === 45050);
  await patchJson(`/api/transactions/${swiggy.id}/category`, {
    categoryId: ids.food_delivery,
    scope: 'future',
  });
  const credit = (
    await postJson('/api/transactions', {
      accountId: hdfc,
      txnDate: '2026-10-21',
      amountPaise: 120000,
      direction: 'in',
      note: 'Office repaid',
      categoryId: ids.salary,
    })
  ).body.transaction;
  await postJson('/api/transactions', {
    accountId: hdfc,
    txnDate: '2026-10-20',
    amountPaise: 300000,
    direction: 'out',
    note: 'Team dinner',
    splits: [
      { categoryId: ids.restaurants, amountPaise: 180000 },
      { categoryId: ids.grocery, amountPaise: 120000 },
    ],
    tags: ['work', 'trip'],
    isReimbursable: true,
    reimbursedByTxnId: credit.id,
  });
  await call('PUT', '/api/budgets', { categoryId: ids.grocery, amountPaise: 1_000_000 });
  await patchJson('/api/settings', { emergencyFundPaise: 30_000_000 });
}

describe('backup and restore', () => {
  it('round-trips every table exactly', async () => {
    await seedEverything();
    const before = await exportAll();
    const counts = backupCounts(before);
    for (const t of [
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
    ] as const)
      expect(counts[t], t).toBeGreaterThan(0);
    expect(before.tables.transactions.some((t) => t.reimbursed_by_txn_id)).toBe(true);
    expect(before.tables.categories.some((c) => c.parent_id)).toBe(true);
    // user_id never leaves the server
    expect(JSON.stringify(before)).not.toContain('user_id');

    // Change things after the backup: the restore must bring back the exact snapshot.
    await postJson('/api/transactions', {
      accountId: hdfc,
      txnDate: '2026-10-25',
      amountPaise: 999,
      direction: 'out',
    });
    await postJson('/api/categories', { name: 'Pets', parentId: ids.lifestyle ?? null });

    const result = await restore(before);
    expect(result.failed).toBeUndefined();
    expect(result.finish?.status).toBe(200);
    expect(result.finish?.body.counts).toEqual(counts);

    const after = await exportAll();
    expect(normalize(after)).toEqual(normalize(before));
    expect((await getJson('/api/backup/status')).body).toEqual({ restoreInProgress: null });

    // The app works on the restored data: balances, reports, undo-free edits.
    const accounts = (await getJson('/api/accounts')).body.accounts;
    expect(accounts.find((a: any) => a.id === hdfc)).toBeTruthy();
    expect((await getJson('/api/reports/summary?from=2026-10-01&to=2026-10-31')).status).toBe(200);
  });

  it('restores into an empty account from scratch, then marks the restore done', async () => {
    await seedEverything();
    const backup = await exportAll();
    const { finish } = await restore(backup);
    expect(finish?.status).toBe(200);
    // Restoring the same file twice is fine (the wipe makes it idempotent).
    const again = await restore(backup);
    expect(again.finish?.status).toBe(200);
  });

  it('pages through big tables', async () => {
    const userId = (await getJson('/api/me')).body.id;
    const tags = Array.from({ length: BACKUP_PAGE_SIZE + 5 }, (_, i) => ({
      id: `tag${i}`,
      n: `t${i}`,
    }));
    await env.DB.prepare(
      `insert into tags (id, user_id, name, created_at) select json_extract(value, '$.id'), ?1,
       json_extract(value, '$.n'), 0 from json_each(?2)`,
    )
      .bind(userId, JSON.stringify(tags))
      .run();
    const first = await getJson('/api/backup?table=tags');
    expect(first.body.rows).toHaveLength(BACKUP_PAGE_SIZE);
    expect(first.body.next).toBeTypeOf('number');
    const second = await getJson(`/api/backup?table=tags&after=${first.body.next}`);
    expect(second.body).toMatchObject({ next: null });
    expect(second.body.rows).toHaveLength(5);
  });

  it('keeps self-links in sync with the schema', () => {
    expect(schemaSelfLinks()).toEqual(BACKUP_SELF_LINKS);
  });

  it('rejects chunks without a running restore, unknown columns and foreign references', async () => {
    const chunk = { table: 'tags', phase: 'rows', rows: [{ id: 't1', name: 'x' }] };
    expect(
      (await postJson('/api/backup/restore/chunk', { restoreId: 'nope', ...chunk })).status,
    ).toBe(409);

    // A category id that belongs to another user must not be attachable.
    await env.DB.prepare(
      `insert into users (id, email, created_at) values ('other', 'other@example.com', 0)`,
    ).run();
    await env.DB.prepare(
      `insert into categories (id, user_id, name, type, slug, created_at, updated_at) values ('foreign', 'other', 'X', 'expense_need', 'x', 0, 0)`,
    ).run();

    const empty = await exportAll();
    const { restoreId } = (
      await postJson('/api/backup/restore', {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        counts: backupCounts(empty),
      })
    ).body;
    const unknown = await postJson('/api/backup/restore/chunk', {
      restoreId,
      ...chunk,
      rows: [{ id: 't1', name: 'x', owner: 'me' }],
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toContain('Unknown column "owner"');

    const foreign = await postJson('/api/backup/restore/chunk', {
      restoreId,
      table: 'budgets',
      phase: 'rows',
      rows: [{ id: 'b1', category_id: 'foreign', amount_paise: 100, month: null }],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('restore_invalid');
    const other = await env.DB.prepare(`select count(*) as n from budgets`).first<{ n: number }>();
    expect(other?.n).toBe(0);

    // JSON columns are validated like the API does (a hostile regex never reaches the engine).
    const badRule = await postJson('/api/backup/restore/chunk', {
      restoreId,
      table: 'rules',
      phase: 'rows',
      rows: [
        {
          id: 'r1',
          name: 'x',
          conditions: JSON.stringify({
            all: [{ field: 'narration', op: 'regex', value: '(a+)+$' }],
          }),
          category_id: null,
          priority: 1,
        },
      ],
    });
    expect(badRule.status).toBe(400);
    expect(badRule.body.error.message).toBe("The backup's rules contain an invalid value.");
    const badMapping = await postJson('/api/backup/restore/chunk', {
      restoreId,
      table: 'parser_profiles',
      phase: 'rows',
      rows: [{ id: 'p1', name: 'x', mapping: '{not json' }],
    });
    expect(badMapping.body.error.message).toBe(
      "The backup's parser_profiles contain an invalid value.",
    );

    const restoreState = await postJson('/api/backup/restore/chunk', {
      restoreId,
      table: 'settings',
      phase: 'rows',
      rows: [{ key: 'restore_state', value: '{}' }],
    });
    expect(restoreState.status).toBe(400);

    // Status shows the unfinished restore until finish succeeds.
    expect((await getJson('/api/backup/status')).body.restoreInProgress).toMatchObject({
      startedAt: expect.any(Number),
    });
  });

  it('refuses to finish when rows are missing', async () => {
    await seedEverything();
    const backup = await exportAll();
    const { restoreId } = (
      await postJson('/api/backup/restore', {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        counts: backupCounts(backup),
      })
    ).body;
    const finish = await postJson('/api/backup/restore/finish', { restoreId });
    expect(finish.status).toBe(409);
    expect(finish.body.error.code).toBe('restore_incomplete');
  });

  it('reports constraint errors without row content', async () => {
    const empty = await exportAll();
    const { restoreId } = (
      await postJson('/api/backup/restore', {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        counts: backupCounts(empty),
      })
    ).body;
    const bad = await postJson('/api/backup/restore/chunk', {
      restoreId,
      table: 'accounts',
      phase: 'rows',
      rows: [
        { id: 'a1', name: 'SECRET NAME', type: 'not-a-type', opening_balance_date: '2026-01-01' },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe("The backup's accounts contain an invalid value.");
    const noLinks = await postJson('/api/backup/restore/chunk', {
      restoreId,
      table: 'tags',
      phase: 'links',
      rows: [{ id: 'x' }],
    });
    expect(noLinks.status).toBe(400);
  });
});
