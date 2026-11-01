import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { transactionDtoSchema, transactionListResponseSchema } from '@kharcha/shared';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { createAccount } from '../src/services/accounts';
import { seedUserDefaults } from '../src/services/seed';
import { createTransaction } from '../src/services/transactions';
import { cashAccountId, categoryIdBySlug, del, getJson, patchJson, postJson } from './helpers';

let ids: Record<string, string>;
let cash: string;

beforeEach(async () => {
  ids = await categoryIdBySlug();
  cash = await cashAccountId();
});

const create = (body: Record<string, unknown>) =>
  postJson('/api/transactions', {
    accountId: cash,
    direction: 'out',
    txnDate: '2026-11-04',
    amountPaise: 25000,
    ...body,
  });

describe('create', () => {
  it('creates a manual transaction with category, counterparty, tags and derived date fields', async () => {
    const res = await create({
      categoryId: ids.grocery,
      counterpartyName: 'Ramesh  Kirana Store',
      note: 'weekly veggies',
      tags: ['#Home', 'monthly'],
    });
    expect(res.status).toBe(201);
    const t = transactionDtoSchema.parse(res.body.transaction);
    expect(t).toMatchObject({
      amountPaise: 25000,
      categoryId: ids.grocery,
      categorizedBy: 'manual',
      source: 'manual',
      status: 'confirmed',
      counterparty: { name: 'Ramesh Kirana Store' },
      isSplit: false,
    });
    expect(t.tags.map((x) => x.name)).toEqual(['home', 'monthly']);

    const row = await env.DB.prepare(
      'select week_start, dow, fingerprint from transactions where id = ?',
    )
      .bind(t.id)
      .first<{ week_start: string; dow: number; fingerprint: string }>();
    expect(row).toMatchObject({ week_start: '2026-11-02', dow: 3 });
    expect(row?.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const cp = await getJson('/api/counterparties?q=kirana');
    expect(cp.body.counterparties).toEqual([
      expect.objectContaining({ name: 'Ramesh Kirana Store', txnCount: 1 }),
    ]);
  });

  it('reuses the counterparty for name variants', async () => {
    await create({ counterpartyName: 'Swiggy' });
    const res = await create({ counterpartyName: 'SWIGGY PVT LTD' });
    expect(res.body.transaction.counterparty.name).toBe('Swiggy');
  });

  it('defaults to Uncategorized when no category is given', async () => {
    const t = (await create({})).body.transaction;
    expect(t).toMatchObject({ categoryId: ids.uncategorized, categorizedBy: 'none' });
  });

  it('creates split transactions and validates the sum', async () => {
    const ok = await create({
      amountPaise: 150000,
      splits: [
        { categoryId: ids.grocery, amountPaise: 100000 },
        { categoryId: ids.home_repairs, amountPaise: 50000, note: 'bulbs' },
      ],
    });
    expect(ok.status).toBe(201);
    expect(ok.body.transaction).toMatchObject({
      isSplit: true,
      categoryId: null,
      categorizedBy: 'manual',
    });
    expect(ok.body.transaction.splits).toHaveLength(2);

    const bad = await create({
      amountPaise: 150000,
      splits: [
        { categoryId: ids.grocery, amountPaise: 100000 },
        { categoryId: ids.home_repairs, amountPaise: 40000 },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.issues[0].path).toBe('splits');
  });

  it('rejects unknown accounts and categories', async () => {
    expect((await create({ accountId: 'nope' })).status).toBe(404);
    expect((await create({ categoryId: 'nope' })).status).toBe(404);
  });

  it('links reimbursements only to incoming transactions', async () => {
    const credit = (await create({ direction: 'in', amountPaise: 25000 })).body.transaction;
    const debit = (await create({})).body.transaction;
    const ok = await create({ isReimbursable: true, reimbursedByTxnId: credit.id });
    expect(ok.body.transaction).toMatchObject({
      isReimbursable: true,
      reimbursedByTxnId: credit.id,
    });
    expect((await create({ reimbursedByTxnId: debit.id })).body.error.code).toBe(
      'invalid_reimbursement',
    );
    expect(
      (await patchJson(`/api/transactions/${credit.id}`, { reimbursedByTxnId: credit.id })).status,
    ).toBe(400);
  });
});

describe('update', () => {
  it('edits fields, recomputes date fields and replaces tags', async () => {
    const t = (await create({ categoryId: ids.grocery, tags: ['a', 'b'] })).body.transaction;
    const res = await patchJson(`/api/transactions/${t.id}`, {
      txnDate: '2026-11-08',
      amountPaise: 30000,
      note: null,
      tags: ['c'],
    });
    expect(res.status).toBe(200);
    expect(res.body.transaction).toMatchObject({
      txnDate: '2026-11-08',
      amountPaise: 30000,
      note: null,
    });
    expect(res.body.transaction.tags.map((x: any) => x.name)).toEqual(['c']);
    const row = await env.DB.prepare('select dow from transactions where id = ?')
      .bind(t.id)
      .first<{ dow: number }>();
    expect(row?.dow).toBe(7);
  });

  it('recategorizes with an audit entry, and un-splits when a category is set', async () => {
    const t = (
      await create({
        amountPaise: 300,
        splits: [
          { categoryId: ids.grocery, amountPaise: 100 },
          { categoryId: ids.medical, amountPaise: 200 },
        ],
      })
    ).body.transaction;

    const amountOnly = await patchJson(`/api/transactions/${t.id}`, { amountPaise: 400 });
    expect(amountOnly.body.error.code).toBe('invalid_splits');

    const res = await patchJson(`/api/transactions/${t.id}`, { categoryId: ids.medical });
    expect(res.body.transaction).toMatchObject({
      isSplit: false,
      categoryId: ids.medical,
      splits: [],
    });

    const audit = await env.DB.prepare(
      "select action, before from audit_log where entity_id = ? and action = 'recategorize'",
    )
      .bind(t.id)
      .first<{ action: string; before: string }>();
    expect(JSON.parse(audit!.before)).toMatchObject({ isSplit: 1, categoryId: null });
  });

  it('clears the counterparty and refreshes its count', async () => {
    const t = (await create({ counterpartyName: 'Zomato' })).body.transaction;
    await patchJson(`/api/transactions/${t.id}`, { counterpartyName: null });
    const cp = await getJson('/api/counterparties?q=zomato');
    expect(cp.body.counterparties[0].txnCount).toBe(0);
  });
});

describe('delete + undo', () => {
  it('restores the transaction with splits and tags', async () => {
    const t = (
      await create({
        amountPaise: 300,
        tags: ['trip'],
        counterpartyName: 'DMart',
        splits: [
          { categoryId: ids.grocery, amountPaise: 100 },
          { categoryId: ids.home_repairs, amountPaise: 200 },
        ],
      })
    ).body.transaction;

    const deleted = await del(`/api/transactions/${t.id}`);
    expect(deleted.status).toBe(200);
    expect((await getJson(`/api/transactions/${t.id}`)).status).toBe(404);

    const undo = await postJson(`/api/undo/${deleted.body.undoToken}`, {});
    expect(undo.body).toEqual({ restored: 1 });
    const restored = (await getJson(`/api/transactions/${t.id}`)).body.transaction;
    expect(restored.splits).toHaveLength(2);
    expect(restored.tags.map((x: any) => x.name)).toEqual(['trip']);
    expect((await getJson('/api/counterparties?q=dmart')).body.counterparties[0].txnCount).toBe(1);

    expect((await postJson(`/api/undo/${deleted.body.undoToken}`, {})).status).toBe(404);
  });
});

describe('list', () => {
  async function seedList() {
    const hdfc = (
      await postJson('/api/accounts', {
        name: 'HDFC',
        type: 'savings',
        openingBalanceDate: '2026-01-01',
      })
    ).body.account.id;
    const mk = (b: Record<string, unknown>) => create(b).then((r) => r.body.transaction);
    return {
      hdfc,
      salary: await mk({
        accountId: hdfc,
        direction: 'in',
        amountPaise: 9000000,
        txnDate: '2026-10-31',
        categoryId: ids.salary,
        note: 'October salary',
      }),
      grocery: await mk({
        txnDate: '2026-11-01',
        amountPaise: 45050,
        categoryId: ids.grocery,
        counterpartyName: 'BigBasket',
      }),
      swiggy: await mk({
        txnDate: '2026-11-02',
        amountPaise: 38000,
        categoryId: ids.food_delivery,
        tags: ['party'],
      }),
      split: await mk({
        txnDate: '2026-11-03',
        amountPaise: 1000,
        splits: [
          { categoryId: ids.petrol, amountPaise: 600 },
          { categoryId: ids.grocery, amountPaise: 400 },
        ],
      }),
      uncategorized: await mk({ txnDate: '2026-11-03', amountPaise: 777 }),
    };
  }

  const list = async (qs = '') =>
    transactionListResponseSchema.parse((await getJson(`/api/transactions${qs}`)).body);
  const idsOf = (r: { transactions: { id: string }[] }) => r.transactions.map((t) => t.id);

  it('orders newest first and paginates with a stable cursor', async () => {
    const s = await seedList();
    const all = idsOf(await list());
    expect(all[0]).toBe(s.uncategorized.id);
    expect(all.at(-1)).toBe(s.salary.id);

    const p1 = await list('?limit=2');
    const p2 = await list(`?limit=2&cursor=${p1.nextCursor}`);
    const p3 = await list(`?limit=2&cursor=${p2.nextCursor}`);
    expect([...idsOf(p1), ...idsOf(p2), ...idsOf(p3)]).toEqual(all);
    expect(p3.nextCursor).toBeNull();
  });

  it.each([
    ['direction', () => `?direction=in`, (s: any) => [s.salary.id]],
    ['account', (s: any) => `?accountIds=${s.hdfc}`, (s: any) => [s.salary.id]],
    ['date range', () => `?from=2026-11-02&to=2026-11-02`, (s: any) => [s.swiggy.id]],
    [
      'category incl. split parts',
      () => `?categoryIds=${ids.grocery}`,
      (s: any) => [s.split.id, s.grocery.id],
    ],
    ['group expands to children', () => `?categoryIds=${ids.travel}`, (s: any) => [s.split.id]],
    ['tag', (s: any) => `?tagIds=${s.swiggy.tags[0].id}`, (s: any) => [s.swiggy.id]],
    ['uncategorized', () => `?uncategorized=true`, (s: any) => [s.uncategorized.id]],
    ['search note', () => `?q=salary`, (s: any) => [s.salary.id]],
    ['search counterparty', () => `?q=bigbask`, (s: any) => [s.grocery.id]],
    ['search amount', () => `?q=450.50`, (s: any) => [s.grocery.id]],
    ['search escapes LIKE wildcards', () => `?q=%25`, () => []],
  ])('filters by %s', async (_name, qs, expected) => {
    const s = await seedList();
    expect(idsOf(await list(qs(s)))).toEqual(expected(s));
  });

  it('rejects malformed cursors and query params', async () => {
    expect((await getJson('/api/transactions?cursor=garbage')).body.error.code).toBe(
      'invalid_cursor',
    );
    expect((await getJson('/api/transactions?limit=0')).status).toBe(400);
  });
});

describe('tenant isolation', () => {
  it("never exposes another user's transactions", async () => {
    const db = getDb(env.DB);
    await db.insert(users).values({ id: 'other', email: 'other@example.com' });
    await seedUserDefaults(db, 'other');
    const acct = await createAccount(db, 'other', {
      name: 'Theirs',
      type: 'savings',
      openingBalanceDate: '2026-01-01',
    });
    const theirs = await createTransaction(db, 'other', {
      accountId: acct.id,
      txnDate: '2026-11-01',
      amountPaise: 123,
      direction: 'out',
      categoryId: null,
      splits: [],
      note: 'secret',
      counterpartyName: null,
      tags: [],
      isReimbursable: false,
      reimbursedByTxnId: null,
    });

    expect((await getJson('/api/transactions?q=secret')).body.transactions).toEqual([]);
    expect((await getJson(`/api/transactions/${theirs.id}`)).status).toBe(404);
    expect((await patchJson(`/api/transactions/${theirs.id}`, { note: 'x' })).status).toBe(404);
    expect((await del(`/api/transactions/${theirs.id}`)).status).toBe(404);
    expect((await create({ accountId: acct.id })).status).toBe(404);
    expect((await getJson(`/api/accounts/${acct.id}`)).status).toBe(404);
    expect((await getJson('/api/accounts')).body.accounts.map((a: any) => a.name)).not.toContain(
      'Theirs',
    );
  });
});
