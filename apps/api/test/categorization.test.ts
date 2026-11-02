import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { importPreviewResponseSchema, inboxResponseSchema } from '@kharcha/shared';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { clearUserCache } from '../src/services/users';
import { createApp } from '../src/app';
import {
  cashAccountId,
  categoryIdBySlug,
  del,
  devEnv,
  getJson,
  importRows,
  patchJson,
  postJson,
  previewBody,
  upload,
} from './helpers';

const { hdfcSavings } = env.TEST_FIXTURES;

async function account(name: string, extra: Record<string, unknown> = {}) {
  const res = await postJson('/api/accounts', {
    name,
    type: 'savings',
    openingBalanceDate: '2026-01-01',
    ...extra,
  });
  return res.body.account.id as string;
}

let seq = 0;
const row = (
  narration: string,
  amountPaise: number,
  direction: 'in' | 'out' = 'out',
  txnDate = '2026-10-10',
) => ({
  txnDate,
  valueDate: null,
  narration,
  refNo: null,
  amountPaise,
  direction,
  balancePaise: null,
  sourceRow: ++seq,
});

const RAMESH = (n: number, date = '2026-10-10') =>
  row(
    `UPI/DR/4275${String(n).padStart(8, '0')}/RAMESH K/SBIN/ramesh.k@okaxis/veg`,
    30000 + n,
    'out',
    date,
  );

const txnsOf = async (q = '') =>
  (await getJson(`/api/transactions?limit=100${q}`)).body.transactions as any[];

let hdfc: string;
let ids: Record<string, string>;
beforeEach(async () => {
  hdfc = await account('HDFC', { bank: 'hdfc', last4: '1234' });
  ids = await categoryIdBySlug();
});

describe('categorization on import', () => {
  it('previews proposed categories and payees, then stores them with counterparties', async () => {
    const { preview, commit, id } = await importRows(hdfc, hdfcSavings);
    const parsed = importPreviewResponseSchema.parse(preview);
    const swiggy = parsed.rows.find((r) => r.narration.includes('SWIGGY'));
    expect(swiggy).toMatchObject({
      payee: 'Swiggy',
      proposal: {
        categoryId: ids.grocery,
        categorizedBy: 'keyword',
        reason: 'keyword:swiggy instamart',
      },
    });
    expect(commit.categorized).toBeGreaterThanOrEqual(5);

    const txns = await txnsOf(`&importId=${id}`);
    const stored = txns.find((t) => t.amountPaise === 45050);
    expect(stored).toMatchObject({
      channel: 'upi',
      vpa: 'swiggy.instamart@ybl',
      counterparty: { name: 'Swiggy' },
      categoryId: ids.grocery,
      categorizedBy: 'keyword',
    });
    // Both genuine ₹20 chai payments share one counterparty, with its count maintained.
    const cps = (await getJson('/api/counterparties?q=chai')).body.counterparties;
    expect(cps).toEqual([expect.objectContaining({ key: 'chaiwala@paytm', txnCount: 2 })]);
    expect(txns.find((t) => t.amountPaise === 40200)).toMatchObject({
      categoryId: ids.interest,
      channel: 'interest',
    });
  });

  it('moves ATM withdrawals to the Cash account as a transfer (and revert removes both legs)', async () => {
    const cash = await cashAccountId();
    const cashOpened = (await getJson('/api/accounts')).body.accounts.find(
      (a: any) => a.id === cash,
    ).openingBalanceDate as string;
    const up = await upload(hdfc, 'atm.csv', 'atm');
    const preview = (
      await postJson(
        `/api/imports/${up.body.importId}/preview`,
        previewBody([
          row('ATM WDL-ATM CASH 1234 PUNE CAMP', 500000, 'out', cashOpened),
          row('SWIGGY ORDER', 30000, 'out', cashOpened),
        ]),
      )
    ).body;
    const atm = preview.rows[0];
    expect(atm.transfer).toMatchObject({ kind: 'atm_cash', counterpartAccountId: cash });
    expect(preview.summary.transfers).toBe(1);

    const commit = await postJson(`/api/imports/${up.body.importId}/commit`, {
      acceptTransfers: [0],
    });
    expect(commit.body).toMatchObject({ inserted: 2, transfersLinked: 1 });
    const legs = (await txnsOf()).filter((t) => t.amountPaise === 500000);
    expect(legs).toHaveLength(2);
    expect(new Set(legs.map((l) => l.transferGroupId)).size).toBe(1);
    expect(legs.every((l) => l.categoryId === ids.atm_cash)).toBe(true);
    expect(legs.find((l) => l.accountId === cash)).toMatchObject({ direction: 'in' });
    const accounts = (await getJson('/api/accounts')).body.accounts;
    expect(accounts.find((a: any) => a.id === cash).balancePaise).toBe(500000);

    await postJson(`/api/imports/${up.body.importId}/revert`, {});
    expect((await txnsOf()).filter((t) => t.amountPaise === 500000)).toHaveLength(0);
  });

  it('applies rule tags and notes to imported rows', async () => {
    await postJson('/api/rules', {
      name: 'Veg vendor',
      conditions: { all: [{ field: 'vpa', op: 'eq', value: 'ramesh.k@okaxis' }] },
      categoryId: ids.grocery,
      setTags: ['sabzi'],
      setNote: 'Vegetables',
    });
    await importRows(hdfc, [RAMESH(1)]);
    const [t] = await txnsOf();
    expect(t).toMatchObject({
      categoryId: ids.grocery,
      categorizedBy: 'rule',
      categorizationReason: 'rule:Veg vendor',
      note: 'Vegetables',
      tags: [expect.objectContaining({ name: 'sabzi' })],
    });
    const rules = (await getJson('/api/rules')).body.rules;
    expect(rules[0]).toMatchObject({ hitCount: 1, setTags: ['sabzi'] });
  });
});

describe('learn from label', () => {
  async function seedRamesh() {
    await importRows(hdfc, [
      RAMESH(1, '2026-10-01'),
      RAMESH(2, '2026-10-02'),
      RAMESH(3, '2026-10-03'),
    ]);
    const txns = await txnsOf();
    expect(txns.every((t) => t.categoryId === ids.uncategorized)).toBe(true);
    return txns;
  }

  it('this one only: sets the transaction manually and learns nothing', async () => {
    const [t] = await seedRamesh();
    const res = await patchJson(`/api/transactions/${t.id}/category`, { categoryId: ids.grocery });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      transaction: { categoryId: ids.grocery, categorizedBy: 'manual' },
      learnedLabelId: null,
      applied: 0,
    });
    expect((await getJson('/api/learned-labels')).body.labels).toEqual([]);
  });

  it('all future: the next import of that payee is auto-labelled', async () => {
    const [t] = await seedRamesh();
    const res = await patchJson(`/api/transactions/${t.id}/category`, {
      categoryId: ids.grocery,
      scope: 'future',
    });
    expect(res.body.learnedLabelId).toBeTruthy();
    // Past rows are untouched with "future".
    expect((await txnsOf()).filter((x) => x.categoryId === ids.uncategorized)).toHaveLength(2);

    const { preview } = await importRows(hdfc, [RAMESH(9, '2026-11-01')]);
    expect(preview.rows[0].proposal).toMatchObject({ categorizedBy: 'learned' });
    const next = (await txnsOf()).find((x) => x.txnDate === '2026-11-01');
    expect(next).toMatchObject({ categoryId: ids.grocery, categorizedBy: 'learned' });

    const labels = (await getJson('/api/learned-labels')).body.labels;
    expect(labels).toEqual([
      expect.objectContaining({
        counterparty: expect.objectContaining({ name: 'Ramesh K' }),
        direction: 'out',
        accountId: null,
        categoryId: ids.grocery,
        hitCount: 1,
      }),
    ]);
  });

  it('all past + future: shows the impact, applies it, skips manual rows, and undoes everything', async () => {
    const txns = await seedRamesh();
    const [a, b, c] = txns as [any, any, any];
    await patchJson(`/api/transactions/${c.id}`, { categoryId: ids.restaurants }); // manual override

    const impact = await getJson(
      `/api/transactions/${a.id}/category/impact?categoryId=${ids.grocery}&matchDirection=true`,
    );
    expect(impact.body).toEqual({
      counterparty: { id: a.counterparty.id, name: 'Ramesh K' },
      count: 1,
    });

    const res = await patchJson(`/api/transactions/${a.id}/category`, {
      categoryId: ids.grocery,
      scope: 'past_and_future',
    });
    expect(res.body.applied).toBe(1);
    const after = await txnsOf();
    expect(after.find((x) => x.id === b.id)).toMatchObject({
      categoryId: ids.grocery,
      categorizedBy: 'learned',
      categorizationReason: 'learned:ramesh.k@okaxis',
    });
    expect(after.find((x) => x.id === c.id).categoryId).toBe(ids.restaurants);

    const undo = await postJson(`/api/undo/${res.body.undoToken}`, {});
    expect(undo.status).toBe(200);
    const restored = await txnsOf();
    expect(restored.find((x) => x.id === a.id).categoryId).toBe(ids.uncategorized);
    expect(restored.find((x) => x.id === b.id)).toMatchObject({
      categoryId: ids.uncategorized,
      categorizedBy: 'none',
    });
    expect(restored.find((x) => x.id === c.id).categoryId).toBe(ids.restaurants);
    expect((await getJson('/api/learned-labels')).body.labels).toEqual([]);
    expect((await postJson(`/api/undo/${res.body.undoToken}`, {})).status).toBe(404);
  });

  it('direction-scoped labels leave refunds from the same payee alone', async () => {
    await importRows(hdfc, [
      RAMESH(1),
      row('UPI/CR/427500000099/RAMESH K/SBIN/ramesh.k@okaxis/back', 500, 'in'),
    ]);
    const out = (await txnsOf()).find((t) => t.direction === 'out');
    const res = await patchJson(`/api/transactions/${out.id}/category`, {
      categoryId: ids.grocery,
      scope: 'past_and_future',
    });
    expect(res.body.applied).toBe(0);
    expect((await txnsOf()).find((t) => t.direction === 'in').categoryId).toBe(ids.uncategorized);
  });

  it('re-labelling the same scope updates the existing learned label', async () => {
    const [t] = await seedRamesh();
    const first = await patchJson(`/api/transactions/${t.id}/category`, {
      categoryId: ids.grocery,
      scope: 'future',
    });
    const second = await patchJson(`/api/transactions/${t.id}/category`, {
      categoryId: ids.restaurants,
      scope: 'future',
    });
    expect(second.body.learnedLabelId).toBe(first.body.learnedLabelId);
    const labels = (await getJson('/api/learned-labels')).body.labels;
    expect(labels).toHaveLength(1);
    expect(labels[0].categoryId).toBe(ids.restaurants);
    // Undoing the second label change restores the first one.
    await postJson(`/api/undo/${second.body.undoToken}`, {});
    expect((await getJson('/api/learned-labels')).body.labels[0].categoryId).toBe(ids.grocery);
  });

  it('rejects learning without a payee, labelling splits and unknown categories', async () => {
    const manual = await postJson('/api/transactions', {
      accountId: hdfc,
      txnDate: '2026-10-01',
      amountPaise: 1000,
      direction: 'out',
    });
    const id = manual.body.transaction.id;
    expect(
      (
        await patchJson(`/api/transactions/${id}/category`, {
          categoryId: ids.grocery,
          scope: 'future',
        })
      ).body.error.code,
    ).toBe('no_counterparty');
    expect(
      (await patchJson(`/api/transactions/${id}/category`, { categoryId: 'nope' })).status,
    ).toBe(404);
    await patchJson(`/api/transactions/${id}`, {
      splits: [
        { categoryId: ids.grocery, amountPaise: 500 },
        { categoryId: ids.rent, amountPaise: 500 },
      ],
    });
    expect(
      (await patchJson(`/api/transactions/${id}/category`, { categoryId: ids.grocery })).body.error
        .code,
    ).toBe('split_transaction');
  });

  it('learned labels can be disabled, recategorized and deleted', async () => {
    const [t] = await seedRamesh();
    const { learnedLabelId } = (
      await patchJson(`/api/transactions/${t.id}/category`, {
        categoryId: ids.grocery,
        scope: 'future',
      })
    ).body;
    const off = await patchJson(`/api/learned-labels/${learnedLabelId}`, { enabled: false });
    expect(off.body.label.enabled).toBe(false);
    const { preview } = await importRows(hdfc, [RAMESH(7, '2026-11-02')]);
    expect(preview.rows[0].proposal).toBeNull();

    expect(
      (await patchJson(`/api/learned-labels/${learnedLabelId}`, { categoryId: ids.rent })).body
        .label.categoryId,
    ).toBe(ids.rent);
    expect((await del(`/api/learned-labels/${learnedLabelId}`)).status).toBe(204);
    expect((await del(`/api/learned-labels/${learnedLabelId}`)).status).toBe(404);
  });
});

describe('bulk relabel', () => {
  it('assigns one category to many, skips splits, and undoes', async () => {
    await importRows(hdfc, [RAMESH(1), RAMESH(2), RAMESH(3)]);
    const txns = await txnsOf();
    const res = await postJson('/api/transactions/bulk-category', {
      ids: [...txns.map((t) => t.id), 'missing'],
      categoryId: ids.grocery,
    });
    expect(res.body).toMatchObject({ updated: 3, skipped: 1 });
    expect(
      (await txnsOf()).every((t) => t.categoryId === ids.grocery && t.categorizedBy === 'manual'),
    ).toBe(true);
    await postJson(`/api/undo/${res.body.undoToken}`, {});
    expect((await txnsOf()).every((t) => t.categoryId === ids.uncategorized)).toBe(true);
  });

  it('does not undo rows that were changed again afterwards', async () => {
    await importRows(hdfc, [RAMESH(1)]);
    const [t] = await txnsOf();
    const bulk = await postJson('/api/transactions/bulk-category', {
      ids: [t.id],
      categoryId: ids.grocery,
    });
    await patchJson(`/api/transactions/${t.id}/category`, { categoryId: ids.rent });
    await postJson(`/api/undo/${bulk.body.undoToken}`, {});
    expect((await txnsOf())[0].categoryId).toBe(ids.rent);
  });

  it('validates the body', async () => {
    expect(
      (await postJson('/api/transactions/bulk-category', { ids: [], categoryId: 'x' })).status,
    ).toBe(400);
  });
});

describe('inbox', () => {
  it('lists uncategorized transactions with payee-history suggestions first', async () => {
    await importRows(hdfc, [
      RAMESH(1),
      RAMESH(2),
      row('UPI/DR/427500000777/UNKNOWN SHOP/HDFC/shop@okicici/x', 999),
    ]);
    const txns = await txnsOf();
    await patchJson(`/api/transactions/${txns.find((t) => t.amountPaise === 30001).id}/category`, {
      categoryId: ids.medical,
    });

    const inbox = inboxResponseSchema.parse((await getJson('/api/inbox')).body);
    expect(inbox.total).toBe(2);
    expect(inbox.transactions).toHaveLength(2);
    const ramesh = inbox.transactions.find((t) => t.amountPaise === 30002)!;
    expect(inbox.suggestions[ramesh.id]?.[0]).toBe(ids.medical);
    expect(inbox.suggestions[ramesh.id]).toHaveLength(4);
    expect((await getJson('/api/inbox/count')).body).toEqual({ count: 2, review: 0 });
  });
});

describe('rules', () => {
  const rentRule = (over: Record<string, unknown> = {}) => ({
    name: 'Rent',
    conditions: {
      all: [
        { field: 'narration', op: 'contains', value: 'landlord' },
        { field: 'amount', op: 'gte', value: 1000000 },
      ],
    },
    categoryId: ids.rent,
    ...over,
  });

  it('creates, lists, updates, reorders and deletes', async () => {
    const a = (await postJson('/api/rules', rentRule())).body.rule;
    const b = (await postJson('/api/rules', rentRule({ name: 'Second' }))).body.rule;
    expect([a.priority, b.priority]).toEqual([1, 2]);
    const reordered = (await postJson('/api/rules/reorder', { ids: [b.id, a.id] })).body.rules;
    expect(reordered.map((r: any) => r.name)).toEqual(['Second', 'Rent']);
    const upd = await patchJson(`/api/rules/${a.id}`, { enabled: false, setTags: ['home'] });
    expect(upd.body.rule).toMatchObject({ enabled: false, setTags: ['home'] });
    expect((await del(`/api/rules/${a.id}`)).status).toBe(204);
    expect((await getJson(`/api/rules/${a.id}`)).status).toBe(404);
  });

  it('rejects dangerous regexes and unknown categories', async () => {
    const bad = await postJson(
      '/api/rules',
      rentRule({ conditions: { all: [{ field: 'narration', op: 'regex', value: '(a+)+$' }] } }),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues[0].message).toContain('Nested repetition');
    expect((await postJson('/api/rules', rentRule({ categoryId: 'nope' }))).status).toBe(404);
  });

  it('tests against history, then applies to past transactions (manual rows untouched)', async () => {
    await importRows(hdfc, [
      row('NEFT-SBIN0001234-LANDLORD SHARMA-OCT RENT', 2500000, 'out', '2026-10-01'),
      row('NEFT-SBIN0001234-LANDLORD SHARMA-SEP RENT', 2500000, 'out', '2026-09-01'),
      row('NEFT-SBIN0001234-LANDLORD SHARMA-DEPOSIT', 500, 'out', '2026-08-01'),
    ]);
    const txns = await txnsOf();
    const sep = txns.find((t) => t.txnDate === '2026-09-01');
    await patchJson(`/api/transactions/${sep.id}/category`, { categoryId: ids.home_repairs });

    const test = await postJson('/api/rules/test', { conditions: rentRule().conditions });
    expect(test.body).toMatchObject({ matched: 2, manual: 1, truncated: false });
    expect(test.body.sample[0]).toMatchObject({ txnDate: '2026-10-01', title: 'Landlord Sharma' });

    const regexTest = await postJson('/api/rules/test', {
      conditions: { all: [{ field: 'narration', op: 'regex', value: '(oct|sep) rent$' }] },
    });
    expect(regexTest.body.matched).toBe(2);

    const rule = (await postJson('/api/rules', rentRule())).body.rule;
    const applied = await postJson(`/api/rules/${rule.id}/apply`, {});
    expect(applied.body).toMatchObject({ changed: 1, nextCursor: null });
    const after = await txnsOf();
    expect(after.find((t) => t.txnDate === '2026-10-01')).toMatchObject({
      categoryId: ids.rent,
      categorizedBy: 'rule',
    });
    expect(after.find((t) => t.txnDate === '2026-09-01').categoryId).toBe(ids.home_repairs);
    expect(after.find((t) => t.txnDate === '2026-08-01').categoryId).toBe(ids.uncategorized);

    // Before the rule the keyword engine had already filed it under Rent; undo restores exactly that.
    await postJson(`/api/undo/${applied.body.batchId}`, {});
    expect((await txnsOf()).find((t) => t.txnDate === '2026-10-01')).toMatchObject({
      categoryId: ids.rent,
      categorizedBy: 'keyword',
    });
  });

  it('rules outrank learned labels', async () => {
    await importRows(hdfc, [RAMESH(1)]);
    const [t] = await txnsOf();
    await patchJson(`/api/transactions/${t.id}/category`, {
      categoryId: ids.grocery,
      scope: 'future',
    });
    await postJson('/api/rules', {
      name: 'Big Ramesh',
      conditions: { all: [{ field: 'counterparty_key', op: 'eq', value: 'ramesh.k@okaxis' }] },
      categoryId: ids.domestic_help,
    });
    const { preview } = await importRows(hdfc, [RAMESH(5, '2026-11-01')]);
    expect(preview.rows[0].proposal).toMatchObject({
      categoryId: ids.domestic_help,
      categorizedBy: 'rule',
    });
  });
});

describe('re-run categorization', () => {
  it('backfills payees for older imports and categorizes them, as one undo', async () => {
    // Simulate Phase 2 rows: imported, uncategorized, no channel/counterparty.
    await importRows(hdfc, [RAMESH(1)]);
    await env.DB.prepare(
      "update transactions set channel = null, vpa = null, counterparty_id = null, category_id = ?1, categorized_by = 'none'",
    )
      .bind(ids.uncategorized)
      .run();
    await env.DB.prepare(
      "insert into learned_labels (id, user_id, counterparty_id, direction, account_id, category_id, enabled, hit_count, created_at, updated_at) select 'll1', user_id, id, null, null, ?1, 1, 0, 0, 0 from counterparties",
    )
      .bind(ids.grocery)
      .run();

    const run = await postJson('/api/categorization/run', {});
    expect(run.body).toMatchObject({ processed: 1, changed: 1, nextCursor: null });
    const [t] = await txnsOf();
    expect(t).toMatchObject({
      channel: 'upi',
      counterparty: { name: 'Ramesh K' },
      categoryId: ids.grocery,
      categorizedBy: 'learned',
    });
    await postJson(`/api/undo/${run.body.batchId}`, {});
    expect((await txnsOf())[0].categoryId).toBe(ids.uncategorized);
  });
});

describe('manual entries', () => {
  it('auto-categorize from payee keywords and learned labels when no category is chosen', async () => {
    const swiggy = await postJson('/api/transactions', {
      accountId: hdfc,
      txnDate: '2026-10-01',
      amountPaise: 25000,
      direction: 'out',
      counterpartyName: 'Swiggy',
    });
    expect(swiggy.body.transaction).toMatchObject({
      categoryId: ids.food_delivery,
      categorizedBy: 'keyword',
      categorizationReason: 'keyword:swiggy',
    });

    const chosen = await postJson('/api/transactions', {
      accountId: hdfc,
      txnDate: '2026-10-01',
      amountPaise: 25000,
      direction: 'out',
      counterpartyName: 'Swiggy',
      categoryId: ids.restaurants,
    });
    expect(chosen.body.transaction.categorizedBy).toBe('manual');
  });
});

describe('payees', () => {
  it('renames and merges, and later imports of the old key land on the target', async () => {
    await importRows(hdfc, [
      RAMESH(1),
      row('UPI/DR/427500000555/R KUMAR/SBIN/rkumar@okhdfcbank/veg', 700),
    ]);
    const cps = (await getJson('/api/counterparties')).body.counterparties;
    const ramesh = cps.find((c: any) => c.key === 'ramesh.k@okaxis');
    const kumar = cps.find((c: any) => c.key === 'rkumar@okhdfcbank');

    const renamed = await patchJson(`/api/counterparties/${ramesh.id}`, {
      displayName: 'Ramesh (veg)',
    });
    expect(renamed.body.counterparty.name).toBe('Ramesh (veg)');

    const merged = await postJson(`/api/counterparties/${kumar.id}/merge`, { targetId: ramesh.id });
    expect(merged.body).toEqual({ moved: 1 });
    expect((await getJson('/api/counterparties')).body.counterparties).toHaveLength(1);
    expect((await txnsOf()).every((t) => t.counterparty?.id === ramesh.id)).toBe(true);

    await importRows(hdfc, [
      row('UPI/DR/427500000556/R KUMAR/SBIN/rkumar@okhdfcbank/veg', 701, 'out', '2026-11-03'),
    ]);
    const newest = (await txnsOf()).find((t) => t.txnDate === '2026-11-03');
    expect(newest.counterparty).toEqual({ id: ramesh.id, name: 'Ramesh (veg)' });
    expect(
      (await postJson(`/api/counterparties/${ramesh.id}/merge`, { targetId: ramesh.id })).status,
    ).toBe(400);
  });
});

describe('isolation', () => {
  it("cannot label, bulk-edit, undo or read another user's data", async () => {
    await importRows(hdfc, [RAMESH(1)]);
    const [t] = await txnsOf();
    const bulk = await postJson('/api/transactions/bulk-category', {
      ids: [t.id],
      categoryId: ids.grocery,
    });
    const rule = (
      await postJson('/api/rules', {
        name: 'x',
        conditions: { all: [{ field: 'direction', op: 'eq', value: 'out' }] },
        categoryId: ids.grocery,
      })
    ).body.rule;

    await getDb(env.DB).update(users).set({ email: 'someone@else.com' });
    clearUserCache();
    const mine = await categoryIdBySlug();
    expect(
      (await patchJson(`/api/transactions/${t.id}/category`, { categoryId: mine.grocery })).status,
    ).toBe(404);
    expect(
      (await postJson('/api/transactions/bulk-category', { ids: [t.id], categoryId: mine.grocery }))
        .body.updated,
    ).toBe(0);
    expect((await postJson(`/api/undo/${bulk.body.undoToken}`, {})).status).toBe(404);
    expect((await getJson(`/api/rules/${rule.id}`)).status).toBe(404);
    expect((await getJson('/api/rules')).body.rules).toEqual([]);
    expect((await getJson('/api/inbox')).body.total).toBe(0);
    expect((await postJson('/api/rules/test', { conditions: rule.conditions })).body.scanned).toBe(
      0,
    );
  });
});

describe('rate limiting', () => {
  it('limits the first chunk of a run, not its continuations', async () => {
    const app = createApp();
    const denyAll = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const run = (body: unknown) =>
      app.request(
        'http://localhost/api/categorization/run',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        devEnv({ UPLOAD_LIMITER: denyAll }),
      );
    expect((await run({})).status).toBe(429);
    expect((await run({ cursor: '0' })).status).toBe(200);
  });
});
