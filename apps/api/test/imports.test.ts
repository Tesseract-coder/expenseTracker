import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { importPreviewResponseSchema } from '@kharcha/shared';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { clearUserCache } from '../src/services/users';
import { createApp } from '../src/app';
import {
  categoryIdBySlug,
  devEnv,
  getJson,
  importRows,
  postJson,
  previewBody,
  upload,
} from './helpers';

const { hdfcSavings, hdfcCard } = env.TEST_FIXTURES;

async function account(name: string, extra: Record<string, unknown> = {}) {
  const res = await postJson('/api/accounts', {
    name,
    type: 'savings',
    openingBalanceDate: '2026-09-30',
    ...extra,
  });
  return res.body.account.id as string;
}

let hdfc: string;
beforeEach(async () => {
  hdfc = await account('HDFC Salary', {
    bank: 'hdfc',
    last4: '1234',
    openingBalancePaise: 5000000,
  });
});

describe('upload', () => {
  it('stores the original file privately in R2 and records the import', async () => {
    const res = await upload(hdfc, 'Statement Oct.csv', 'Date,Narration\n01/10/26,X\n');
    expect(res.status).toBe(201);
    const list = (await getJson('/api/imports')).body.imports;
    expect(list[0]).toMatchObject({
      id: res.body.importId,
      fileName: 'Statement Oct.csv',
      status: 'uploaded',
    });

    const keys = (await env.STATEMENTS.list({ prefix: 'u/' })).objects.map((o) => o.key);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`/imports/${res.body.importId}/[0-9a-f]{64}\\.csv$`));
  });

  it('serves the original file back as an attachment', async () => {
    const res = await upload(hdfc, 'oct.csv', 'hello,world\n');
    const file = await createApp().request(
      `http://localhost/api/imports/${res.body.importId}/file`,
      {},
      devEnv(),
    );
    expect(file.headers.get('content-disposition')).toBe('attachment; filename="oct.csv"');
    expect(await file.text()).toBe('hello,world\n');
  });

  it.each([
    ['unsupported type', 'statement.pdf', 'x', 'unsupported_file'],
    ['empty file', 'statement.csv', '', 'empty_file'],
  ])('rejects %s', async (_n, name, content, code) => {
    const res = await upload(hdfc, name, content);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  it('rejects unknown accounts', async () => {
    expect((await upload('nope')).status).toBe(404);
  });

  it('warns when the same file was already imported into the account', async () => {
    await importRows(hdfc, hdfcSavings, {}, 'same-bytes');
    const again = await upload(hdfc, 'statement.csv', 'same-bytes');
    expect(again.body.duplicateOf).toMatchObject({ fileName: 'statement.csv' });
  });
});

describe('preview + commit', () => {
  it('imports a statement, keeping genuinely repeated ₹20 payments', async () => {
    const { preview, commit, id } = await importRows(hdfc, hdfcSavings);
    const parsed = importPreviewResponseSchema.parse(preview);
    expect(parsed.summary).toMatchObject({ total: 8, new: 8, duplicate: 0, nearDuplicate: 0 });
    expect(commit).toMatchObject({ inserted: 8, skippedDuplicates: 0 });

    const txns = (await getJson(`/api/transactions?importId=${id}`)).body.transactions;
    expect(txns).toHaveLength(8);
    expect(txns.filter((t: any) => t.amountPaise === 2000)).toHaveLength(2);
    expect(txns.every((t: any) => t.source === 'import')).toBe(true);
    const ids = await categoryIdBySlug();
    expect(txns.find((t: any) => t.amountPaise === 9500000)).toMatchObject({
      categoryId: ids.uncategorized,
      categorizedBy: 'none',
    });

    const imp = (await getJson('/api/imports')).body.imports.find((i: any) => i.id === id);
    expect(imp).toMatchObject({
      status: 'committed',
      rowsParsed: 8,
      rowsNew: 8,
      statementFrom: '2026-10-01',
      statementTo: '2026-10-31',
    });
  });

  it('never creates duplicates when re-importing an overlapping statement', async () => {
    await importRows(hdfc, hdfcSavings);
    const overlap = [
      ...hdfcSavings.slice(2),
      {
        ...hdfcSavings[0],
        txnDate: '2026-11-01',
        narration: 'NEW NOVEMBER ROW',
        refNo: null,
        sourceRow: 99,
      },
    ];
    const { preview, commit } = await importRows(hdfc, overlap);
    expect(preview.summary).toMatchObject({ total: 7, new: 1, duplicate: 6 });
    expect(commit).toMatchObject({ inserted: 1, skippedDuplicates: 6 });
    const all = (await getJson('/api/transactions?limit=100')).body.transactions;
    expect(all).toHaveLength(9);
  });

  it('flags near-duplicates of manual entries and skips them unless included', async () => {
    const manual = (
      await postJson('/api/transactions', {
        accountId: hdfc,
        txnDate: '2026-10-02',
        amountPaise: 45050,
        direction: 'out',
        note: 'swiggy',
      })
    ).body.transaction;

    const up = await upload(hdfc, 'a.csv', 'a');
    const preview = (
      await postJson(`/api/imports/${up.body.importId}/preview`, previewBody(hdfcSavings))
    ).body;
    const near = preview.rows.find((r: any) => r.status === 'near_duplicate');
    expect(near).toMatchObject({
      amountPaise: 45050,
      match: { txnId: manual.id, reason: 'no_narration' },
    });

    const commit = (await postJson(`/api/imports/${up.body.importId}/commit`, {})).body;
    expect(commit.inserted).toBe(7);

    // Second statement copy, this time choosing to keep the near-duplicate.
    const up2 = await upload(hdfc, 'b.csv', 'b');
    const rows2 = [{ ...hdfcSavings[1], refNo: 'OTHER', narration: 'SWIGGY AGAIN', sourceRow: 1 }];
    const p2 = (await postJson(`/api/imports/${up2.body.importId}/preview`, previewBody(rows2)))
      .body;
    expect(p2.rows[0].status).toBe('near_duplicate');
    const c2 = (
      await postJson(`/api/imports/${up2.body.importId}/commit`, { includeNearDuplicates: [0] })
    ).body;
    expect(c2.inserted).toBe(1);
  });

  it('reconciles against the statement closing balance', async () => {
    const up = await upload(hdfc);
    const ok = await postJson(
      `/api/imports/${up.body.importId}/preview`,
      previewBody(hdfcSavings, { closingBalancePaise: 10485150 }),
    );
    expect(ok.body.reconciliation).toEqual({
      statementClosingPaise: 10485150,
      projectedBalancePaise: 10485150,
      matches: true,
    });

    const off = await postJson(
      `/api/imports/${up.body.importId}/preview`,
      previewBody(hdfcSavings, { closingBalancePaise: 1 }),
    );
    expect(off.body.reconciliation.matches).toBe(false);
  });

  it('refuses to commit twice or before preview', async () => {
    const up = await upload(hdfc);
    expect((await postJson(`/api/imports/${up.body.importId}/commit`, {})).body.error.code).toBe(
      'import_not_ready',
    );
    await postJson(`/api/imports/${up.body.importId}/preview`, previewBody(hdfcSavings));
    expect((await postJson(`/api/imports/${up.body.importId}/commit`, {})).status).toBe(200);
    expect((await postJson(`/api/imports/${up.body.importId}/commit`, {})).status).toBe(409);
    expect(
      (await postJson(`/api/imports/${up.body.importId}/preview`, previewBody(hdfcSavings))).body
        .error.code,
    ).toBe('import_not_editable');
  });

  it('validates preview payloads', async () => {
    const up = await upload(hdfc);
    const res = await postJson(`/api/imports/${up.body.importId}/preview`, previewBody([]));
    expect(res.body.error).toMatchObject({
      code: 'validation_error',
      message: 'No transactions found in this file',
    });
  });
});

describe('transfer detection', () => {
  it('pairs a savings debit with an already-imported card payment and links both legs', async () => {
    const card = await account('HDFC Regalia', {
      type: 'credit_card',
      bank: 'hdfc',
      last4: '4321',
    });
    // Card statement first: "PAYMENT RECEIVED, THANK YOU" ₹18,500 on 2026-10-07.
    const cardRow = {
      ...hdfcCard.find((r: any) => r.amountPaise === 1850000),
      txnDate: '2026-10-07',
    };
    const first = await importRows(card, [cardRow]);
    const cardTxnId = (await getJson(`/api/transactions?importId=${first.id}`)).body.transactions[0]
      .id;

    const autopay = hdfcSavings.find((r: any) => r.amountPaise === 1850000);
    const up = await upload(hdfc);
    const preview = (
      await postJson(`/api/imports/${up.body.importId}/preview`, previewBody([autopay]))
    ).body;
    expect(preview.rows[0].transfer).toMatchObject({
      kind: 'cc_bill_payment',
      confidence: 'high',
      counterpartTxnId: cardTxnId,
      counterpartAccountId: card,
    });
    expect(preview.summary.transfers).toBe(1);

    const commit = (
      await postJson(`/api/imports/${up.body.importId}/commit`, { acceptTransfers: [0] })
    ).body;
    expect(commit.transfersLinked).toBe(1);

    const ids = await categoryIdBySlug();
    const debit = (await getJson(`/api/transactions?importId=${up.body.importId}`)).body
      .transactions[0];
    const credit = (await getJson(`/api/transactions/${cardTxnId}`)).body.transaction;
    expect(debit.categoryId).toBe(ids.cc_bill_payment);
    expect(credit.categoryId).toBe(ids.cc_bill_payment);
    expect(debit.transferGroupId).toBeTruthy();
    expect(credit.transferGroupId).toBe(debit.transferGroupId);
  });

  it('suggests a card-bill payment on a single leg when the card is not imported', async () => {
    await account('HDFC Regalia', { type: 'credit_card', last4: '4321' });
    const up = await upload(hdfc);
    const preview = (
      await postJson(`/api/imports/${up.body.importId}/preview`, previewBody(hdfcSavings))
    ).body;
    const autopay = preview.rows.find((r: any) => r.amountPaise === 1850000);
    expect(autopay.transfer).toMatchObject({ kind: 'cc_bill_payment', counterpartTxnId: null });

    // Not accepted → stays Uncategorized.
    await postJson(`/api/imports/${up.body.importId}/commit`, {});
    const ids = await categoryIdBySlug();
    const txn = (await getJson(`/api/transactions?importId=${up.body.importId}&q=AUTOPAY`)).body
      .transactions[0];
    expect(txn.categoryId).toBe(ids.uncategorized);
  });

  it('pairs savings → savings self transfers', async () => {
    const kotak = await account('Kotak', { bank: 'kotak', last4: '5678' });
    await postJson('/api/transactions', {
      accountId: kotak,
      txnDate: '2026-10-15',
      amountPaise: 2000000,
      direction: 'in',
      note: 'from hdfc',
    });
    const imps = hdfcSavings.find((r: any) => r.amountPaise === 2000000);
    const up = await upload(hdfc);
    const preview = (
      await postJson(`/api/imports/${up.body.importId}/preview`, previewBody([imps]))
    ).body;
    expect(preview.rows[0].transfer).toMatchObject({
      kind: 'self_transfer',
      confidence: 'high',
      counterpartAccountId: kotak,
    });
  });
});

describe('revert', () => {
  it('deletes the imported transactions and un-links transfer counterparts', async () => {
    const card = await account('Card', { type: 'credit_card', last4: '4321' });
    const cardRow = {
      ...hdfcCard.find((r: any) => r.amountPaise === 1850000),
      txnDate: '2026-10-06',
    };
    const first = await importRows(card, [cardRow]);
    const cardTxn = (await getJson(`/api/transactions?importId=${first.id}`)).body.transactions[0];
    const second = await importRows(hdfc, hdfcSavings, { acceptTransfers: [4] });
    expect(second.commit.transfersLinked).toBe(1);

    const res = await postJson(`/api/imports/${second.id}/revert`, {});
    expect(res.body).toEqual({ deleted: 8 });
    expect((await getJson(`/api/transactions?importId=${second.id}`)).body.transactions).toEqual(
      [],
    );
    const ids = await categoryIdBySlug();
    expect((await getJson(`/api/transactions/${cardTxn.id}`)).body.transaction).toMatchObject({
      transferGroupId: null,
      categoryId: ids.uncategorized,
    });
    expect((await postJson(`/api/imports/${second.id}/revert`, {})).status).toBe(409);
  });
});

describe('parser profiles', () => {
  it('saves a mapping and remembers it on the account', async () => {
    const mapping = {
      headerRow: 1,
      dateCol: 0,
      valueDateCol: null,
      narrationCols: [1],
      refCol: null,
      balanceCol: 4,
      amount: { kind: 'debit_credit', debitCol: 2, creditCol: 3 },
      dateOrder: 'dmy',
    };
    const res = await postJson('/api/parser-profiles', {
      name: 'My co-op bank',
      mapping,
      accountId: hdfc,
    });
    expect(res.status).toBe(201);
    expect((await getJson(`/api/accounts/${hdfc}`)).body.account.parserProfileId).toBe(
      res.body.profile.id,
    );
    expect((await getJson('/api/parser-profiles')).body.profiles).toEqual([
      { id: res.body.profile.id, name: 'My co-op bank', mapping },
    ]);
  });
});

describe('isolation', () => {
  it("cannot preview, commit or download another user's import", async () => {
    const up = await upload(hdfc);
    // Hand the existing data to another user; the dev login is then provisioned as a fresh user.
    await getDb(env.DB).update(users).set({ email: 'someone@else.com' });
    clearUserCache();
    expect(
      (await postJson(`/api/imports/${up.body.importId}/preview`, previewBody(hdfcSavings))).status,
    ).toBe(404);
    expect((await postJson(`/api/imports/${up.body.importId}/commit`, {})).status).toBe(404);
    expect((await getJson('/api/imports')).body.imports).toEqual([]);
  });
});
