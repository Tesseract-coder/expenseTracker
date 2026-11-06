import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EXPORT_PAGE_ROWS,
  budgetListResponseSchema,
  exportResponseSchema,
  healthScoreResponseSchema,
  recurringListResponseSchema,
  summaryResponseSchema,
  trendsResponseSchema,
  whenResponseSchema,
  whereResponseSchema,
} from '@kharcha/shared';
import { getDb } from '../src/db/client';
import { users } from '../src/db/schema';
import { runDailyJobs } from '../src/jobs/daily';
import { clearUserCache } from '../src/services/users';
import { categoryIdBySlug, del, getJson, patchJson, postJson, call } from './helpers';

const R = 100;
let ids: Record<string, string>;
let acc: string;
let other: string;

async function account(name: string) {
  const res = await postJson('/api/accounts', {
    name,
    type: 'savings',
    openingBalanceDate: '2026-01-01',
  });
  return res.body.account.id as string;
}

async function txn(
  txnDate: string,
  rupees: number,
  direction: 'in' | 'out',
  slug: string | null,
  extra: Record<string, unknown> = {},
) {
  const res = await postJson('/api/transactions', {
    accountId: acc,
    txnDate,
    amountPaise: rupees * R,
    direction,
    categoryId: slug ? ids[slug] : null,
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.transaction;
}

/** October 2026 ledger with known totals (see expectations below). */
async function seedOctober() {
  await txn('2026-10-01', 100_000, 'in', 'salary', { counterpartyName: 'Acme' });
  await txn('2026-10-03', 25_000, 'out', 'rent', { counterpartyName: 'Landlord' });
  await txn('2026-10-05', 5_000, 'out', 'grocery', { counterpartyName: 'DMart' });
  await txn('2026-10-05', 3_000, 'out', 'restaurants', { counterpartyName: 'Cafe' });
  await txn('2026-10-12', 500, 'in', 'restaurants', { counterpartyName: 'Cafe' }); // refund
  await txn('2026-10-10', 10_000, 'out', 'mutual_funds', { counterpartyName: 'Groww' });
  await txn('2026-10-11', 1_000, 'out', null); // uncategorized spend
  await txn('2026-10-11', 2_000, 'in', null); // uncategorized income (excluded)
  await txn('2026-10-15', 7_000, 'out', 'self_transfer'); // transfer (excluded)
  await txn('2026-10-20', 4_000, 'out', null, {
    counterpartyName: 'DMart',
    splits: [
      { categoryId: ids.grocery, amountPaise: 3_000 * R },
      { categoryId: ids.clothing, amountPaise: 1_000 * R },
    ],
  });
}

const OCT = 'from=2026-10-01&to=2026-10-31';

beforeEach(async () => {
  ids = await categoryIdBySlug();
  acc = await account('Main');
  other = await account('Other');
});

describe('summary', () => {
  it('computes income, spend (net of refunds, splits exploded), invested and savings rate', async () => {
    await seedOctober();
    await txn('2026-09-10', 2_000, 'out', 'restaurants');
    const res = await getJson(
      `/api/reports/summary?${OCT}&compareFrom=2026-09-01&compareTo=2026-09-30`,
    );
    expect(res.status).toBe(200);
    const s = summaryResponseSchema.parse(res.body);
    expect(s.totals).toEqual({
      income: 100_000 * R,
      needs: 33_000 * R,
      wants: 3_500 * R,
      unclassified: 1_000 * R,
      spend: 37_500 * R,
      invested: 10_000 * R,
      netSavings: 62_500 * R,
      savingsRate: 0.625,
      uncategorizedIncome: 2_000 * R,
    });
    expect(s.previous?.spend).toBe(2_000 * R);
    expect(s.byGroup[0]).toEqual({ groupId: ids.household, spend: 33_000 * R });
    expect(s.byCategory.find((c) => c.categoryId === ids.restaurants)).toMatchObject({
      spend: 2_500 * R,
      previous: 2_000 * R,
    });
    expect(s.byCategory.find((c) => c.categoryId === ids.grocery)?.spend).toBe(8_000 * R);
    expect(s.trend.granularity).toBe('day');
    expect(s.trend.points).toHaveLength(31);
    expect(s.trend.points.find((p) => p.bucket === '2026-10-05')?.spend).toBe(8_000 * R);
    expect(s.trend.points.find((p) => p.bucket === '2026-10-02')?.spend).toBe(0);
  });

  it('filters by account', async () => {
    await seedOctober();
    const s = (await getJson(`/api/reports/summary?${OCT}&accountIds=${other}`)).body;
    expect(s.totals.spend).toBe(0);
    expect(s.totals.savingsRate).toBeNull();
  });

  it('uses weekly and monthly buckets for longer ranges', async () => {
    const q = (from: string, to: string) =>
      getJson(`/api/reports/summary?from=${from}&to=${to}`).then((r) => r.body.trend);
    expect((await q('2026-07-01', '2026-10-31')).granularity).toBe('week');
    const year = await q('2026-01-01', '2026-12-31');
    expect(year.granularity).toBe('month');
    expect(year.points).toHaveLength(12);
  });

  it('validates the range', async () => {
    expect((await getJson('/api/reports/summary?from=2026-11-01&to=2026-10-01')).status).toBe(400);
    expect((await getJson('/api/reports/summary?from=nope&to=2026-10-01')).status).toBe(400);
  });
});

describe('trends', () => {
  it('returns gap-filled monthly buckets and per-category spend', async () => {
    await seedOctober();
    await txn('2026-08-05', 1_500, 'out', 'restaurants');
    const t = trendsResponseSchema.parse(
      (await getJson('/api/reports/trends?granularity=month&from=2026-07-01&to=2026-10-31')).body,
    );
    expect(t.buckets.map((b) => b.bucket)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(t.buckets[3]).toEqual({
      bucket: '2026-10',
      income: 100_000 * R,
      spend: 37_500 * R,
      invested: 10_000 * R,
    });
    expect(t.buckets[2]?.spend).toBe(0);
    expect(t.categories).toContainEqual({
      bucket: '2026-08',
      categoryId: ids.restaurants,
      spend: 1_500 * R,
    });
  });

  it('labels financial years', async () => {
    await txn('2026-03-15', 100, 'out', 'grocery');
    await txn('2026-04-15', 200, 'out', 'grocery');
    const t = (
      await getJson(
        '/api/reports/trends?granularity=year&yearMode=fy&from=2025-04-01&to=2027-03-31',
      )
    ).body;
    expect(t.buckets).toEqual([
      { bucket: 'FY 2025-26', income: 0, spend: 100 * R, invested: 0 },
      { bucket: 'FY 2026-27', income: 0, spend: 200 * R, invested: 0 },
    ]);
  });

  it('weekly buckets start on Monday', async () => {
    await txn('2026-11-01', 100, 'out', 'grocery'); // Sunday → week of Oct 26
    const t = (await getJson('/api/reports/trends?granularity=week&from=2026-10-26&to=2026-11-08'))
      .body;
    expect(t.buckets.map((b: any) => [b.bucket, b.spend])).toEqual([
      ['2026-10-26', 100 * R],
      ['2026-11-02', 0],
    ]);
  });
});

describe('when and where', () => {
  it('answers when you spent more', async () => {
    await seedOctober();
    const w = whenResponseSchema.parse((await getJson(`/api/reports/when?${OCT}`)).body);
    expect(w.topDays[0]).toMatchObject({ date: '2026-10-03', spend: 25_000 * R });
    expect(w.topDays[0]?.top[0]).toMatchObject({ title: 'Landlord', amountPaise: 25_000 * R });
    expect(w.topDays[1]?.top.map((t) => t.title)).toEqual(['DMart', 'Cafe']);
    // Oct 2026 has five Saturdays (3, 10, 17, 24, 31): rent on the 3rd.
    expect(w.byDow.find((d) => d.dow === 6)).toEqual({
      dow: 6,
      spend: 25_000 * R,
      average: 5_000 * R,
    });
    expect(w.byWeekOfMonth[0]).toEqual({ week: 1, spend: 33_000 * R });
    expect(w.topMonths).toEqual([{ month: '2026-10', spend: 37_500 * R }]);
    expect(w.daily.find((d) => d.date === '2026-10-12')?.spend).toBe(-500 * R);
  });

  it('answers where you spent more, with changes vs the previous period', async () => {
    await seedOctober();
    await txn('2026-09-05', 9_000, 'out', 'restaurants', { counterpartyName: 'Cafe' });
    const w = whereResponseSchema.parse(
      (await getJson(`/api/reports/where?${OCT}&compareFrom=2026-09-01&compareTo=2026-09-30`)).body,
    );
    expect(w.topCategories[0]).toEqual({ categoryId: ids.rent, spend: 25_000 * R, count: 1 });
    expect(w.topCounterparties.map((c) => c.name)).toEqual(['Landlord', 'DMart', 'Cafe']);
    expect(w.topCounterparties[1]).toMatchObject({ spend: 9_000 * R, count: 2 });
    expect(w.topTransactions[0]).toMatchObject({ title: 'Landlord', amountPaise: 25_000 * R });
    expect(w.changes[0]).toEqual({
      categoryId: ids.rent,
      current: 25_000 * R,
      previous: 0,
      delta: 25_000 * R,
      pct: null,
    });
    expect(w.changes.find((c) => c.categoryId === ids.restaurants)).toMatchObject({
      delta: -6_500 * R,
    });
  });
});

describe('budgets', () => {
  it('tracks category and group budgets with overrides and alert states', async () => {
    await seedOctober();
    await call('PUT', '/api/budgets', { categoryId: ids.grocery, amountPaise: 10_000 * R });
    await call('PUT', '/api/budgets', { categoryId: ids.household, amountPaise: 30_000 * R });
    await call('PUT', '/api/budgets', { categoryId: ids.restaurants, amountPaise: 5_000 * R });
    // October-only override for restaurants.
    await call('PUT', '/api/budgets', {
      categoryId: ids.restaurants,
      month: '2026-10',
      amountPaise: 3_000 * R,
    });
    const list = budgetListResponseSchema.parse((await getJson('/api/budgets?month=2026-10')).body);
    const by = (slug: string) => list.budgets.find((b) => b.categoryId === ids[slug])!;
    expect(by('household')).toMatchObject({ spentPaise: 33_000 * R, state: 'over' });
    expect(by('grocery')).toMatchObject({ spentPaise: 8_000 * R, state: 'warning', pct: 0.8 });
    expect(by('restaurants')).toMatchObject({
      month: '2026-10',
      amountPaise: 3_000 * R,
      spentPaise: 2_500 * R,
      state: 'warning',
    });
    expect(list.totals.budgetedPaise).toBe(43_000 * R);
    // November falls back to the default.
    const nov = (await getJson('/api/budgets?month=2026-11')).body;
    expect(nov.budgets.find((b: any) => b.categoryId === ids.restaurants).amountPaise).toBe(
      5_000 * R,
    );

    // Re-saving the default replaces it.
    await call('PUT', '/api/budgets', { categoryId: ids.grocery, amountPaise: 20_000 * R });
    expect(
      (await getJson('/api/budgets?month=2026-10')).body.budgets.find(
        (b: any) => b.categoryId === ids.grocery,
      ),
    ).toMatchObject({ amountPaise: 20_000 * R, state: 'ok' });

    expect((await del(`/api/budgets/${by('household').id}`)).status).toBe(204);
    expect((await del(`/api/budgets/${by('household').id}`)).status).toBe(404);
  });

  it('rejects non-spending categories and bad months', async () => {
    const res = await call('PUT', '/api/budgets', { categoryId: ids.salary, amountPaise: 100 });
    expect(res.body.error.code).toBe('invalid_budget_category');
    expect((await getJson('/api/budgets?month=2026-13')).status).toBe(400);
  });
});

describe('settings and health', () => {
  it('returns defaults and merges target updates', async () => {
    const s = (await getJson('/api/settings')).body.settings;
    expect(s).toMatchObject({ yearMode: 'calendar', emergencyFundPaise: null });
    expect(s.targets.investmentRate).toBe(0.15);
    const upd = await patchJson('/api/settings', {
      yearMode: 'fy',
      targets: { savingsRate: 0.3 },
      emergencyFundPaise: 300_000 * R,
    });
    expect(upd.body.settings).toMatchObject({
      yearMode: 'fy',
      emergencyFundPaise: 300_000 * R,
      targets: { savingsRate: 0.3, needs: 0.5 },
    });
    expect((await patchJson('/api/settings', { targets: { savingsRate: 2 } })).status).toBe(400);
  });

  it('scores a month from aggregates, budgets and the emergency fund', async () => {
    await seedOctober();
    await patchJson('/api/settings', { emergencyFundPaise: 200_000 * R });
    await call('PUT', '/api/budgets', { categoryId: ids.grocery, amountPaise: 6_000 * R });
    const h = healthScoreResponseSchema.parse(
      (await getJson('/api/reports/health?period=month&date=2026-10-15')).body,
    );
    expect(h.from).toBe('2026-10-01');
    expect(h.totals).toMatchObject({ income: 100_000 * R, spend: 37_500 * R, savings: 62_500 * R });
    const c = (k: string) => h.components.find((x) => x.key === k)!;
    expect(c('savings_rate')).toMatchObject({ value: '62.5%', status: 'good' });
    expect(c('budget_adherence')).toMatchObject({ value: '0 of 1', score: 0 });
    expect(c('emergency_fund').value).toBe('6.1 months');
    expect(h.score).toBeGreaterThan(60);
    expect(h.suggestions.some((s) => s.includes('Grocery'))).toBe(true);
    expect(h.history.at(-1)?.month).toBe('2026-10');
  });

  it('uses the financial year when configured', async () => {
    await patchJson('/api/settings', { yearMode: 'fy' });
    const h = (await getJson('/api/reports/health?period=year&date=2026-02-10')).body;
    expect([h.from, h.to]).toEqual(['2025-04-01', '2026-03-31']);
    expect(h.score).toBeNull();
  });
});

describe('recurring payments', () => {
  it('detects subscriptions, survives refresh with dismissals, and goes stale on new data', async () => {
    for (const d of ['2026-06-12', '2026-07-12', '2026-08-12', '2026-09-12', '2026-10-12'])
      await txn(d, 649, 'out', 'entertainment', { counterpartyName: 'Netflix' });
    for (const d of ['2026-06-03', '2026-08-19', '2026-10-01'])
      await txn(d, 300, 'out', 'restaurants', { counterpartyName: 'Random Cafe' });

    const list = recurringListResponseSchema.parse((await getJson('/api/recurring')).body);
    expect(list.series).toHaveLength(1);
    expect(list.series[0]).toMatchObject({
      counterparty: { name: 'Netflix' },
      cadence: 'monthly',
      typicalAmountPaise: 649 * R,
      nextExpectedDate: '2026-11-12',
      categoryId: ids.entertainment,
      dismissed: false,
    });
    expect(list.monthlyTotalPaise).toBe(649 * R);

    const dismissed = await patchJson(`/api/recurring/${list.series[0]!.id}`, { dismissed: true });
    expect(dismissed.body.series[0].dismissed).toBe(true);
    expect(dismissed.body.monthlyTotalPaise).toBe(0);

    // A price rise arrives: the cache goes stale and rebuilds, keeping the dismissal.
    await txn('2026-11-12', 799, 'out', 'entertainment', { counterpartyName: 'Netflix' });
    const after = (await getJson('/api/recurring')).body.series[0];
    expect(after).toMatchObject({
      status: 'price_changed',
      lastAmountPaise: 799 * R,
      dismissed: true,
    });

    expect((await postJson('/api/recurring/refresh', {})).body.series).toHaveLength(1);
    expect((await patchJson('/api/recurring/nope', { dismissed: true })).status).toBe(404);
  });
});

describe('export', () => {
  it('pages large exports so each request stays small', async () => {
    const userId = (await getJson('/api/me')).body.id;
    const n = EXPORT_PAGE_ROWS + 10;
    await env.DB.prepare(
      `insert into transactions (id, user_id, account_id, txn_date, week_start, dow, amount_paise,
         direction, category_id, source, fingerprint, created_at, updated_at)
       select 'bulk' || value, ?1, ?2, '2026-10-05', '2026-10-05', 1, 100 + value, 'out', ?3,
         'manual', 'fp' || value, value, value
       from json_each(?4)`,
    )
      .bind(userId, acc, ids.grocery, JSON.stringify(Array.from({ length: n }, (_, i) => i)))
      .run();
    const first = exportResponseSchema.parse(
      (await getJson(`/api/export/transactions?${OCT}&withPayees=true`)).body,
    );
    expect(first.rows).toHaveLength(EXPORT_PAGE_ROWS);
    expect(first.next).toBe(EXPORT_PAGE_ROWS);
    expect(first.byCounterparty.length).toBeGreaterThan(0);
    const second = exportResponseSchema.parse(
      (await getJson(`/api/export/transactions?${OCT}&offset=${first.next}`)).body,
    );
    expect(second).toMatchObject({ next: null, truncated: false, byCounterparty: [] });
    expect(second.rows).toHaveLength(10);
    // No row is repeated or skipped across pages.
    const amounts = new Set([...first.rows, ...second.rows].map((r) => r.amountPaise));
    expect(amounts.size).toBe(n);
    expect((await getJson(`/api/export/transactions?${OCT}&offset=-1`)).status).toBe(400);
  });

  it('exports filtered rows with split parts and payee totals', async () => {
    await seedOctober();
    const res = await getJson(`/api/export/transactions?${OCT}&withPayees=true`);
    const e = exportResponseSchema.parse(res.body);
    expect(e.truncated).toBe(false);
    expect(e.rows).toHaveLength(11); // 10 transactions, the split one as 2 rows
    const split = e.rows.filter((r) => r.date === '2026-10-20');
    expect(split.map((r) => [r.category, r.amountPaise]).sort()).toEqual([
      ['Clothing', 1_000 * R],
      ['Grocery', 3_000 * R],
    ]);
    expect(e.rows.find((r) => r.category === 'Rent')).toMatchObject({
      account: 'Main',
      payee: 'Landlord',
      group: 'Household / Essentials',
      type: 'expense_need',
      direction: 'out',
    });
    expect(e.byCounterparty[0]).toEqual({ name: 'Landlord', spend: 25_000 * R, count: 1 });

    const filtered = (await getJson(`/api/export/transactions?${OCT}&direction=in`)).body;
    expect(filtered.rows).toHaveLength(3);
    expect(filtered.byCounterparty).toEqual([]);
  });
});

describe('daily jobs', () => {
  it('refreshes recurring caches and prunes audit entries older than 180 days', async () => {
    const t = await txn('2026-10-01', 100, 'out', 'grocery');
    await del(`/api/transactions/${t.id}`); // writes an audit entry
    const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
    await env.DB.prepare('update audit_log set created_at = ?1').bind(old).run();
    const summary = await runDailyJobs(env);
    expect(summary).toMatchObject({ users: 1, prunedAudit: 1 });
    expect(
      (await env.DB.prepare('select count(*) as n from audit_log').first<{ n: number }>())?.n,
    ).toBe(0);
  });
});

describe('isolation', () => {
  it("never reports another user's money", async () => {
    await seedOctober();
    await call('PUT', '/api/budgets', { categoryId: ids.grocery, amountPaise: 6_000 * R });
    await getDb(env.DB).update(users).set({ email: 'someone@else.com' });
    clearUserCache();
    expect((await getJson(`/api/reports/summary?${OCT}`)).body.totals.spend).toBe(0);
    expect((await getJson(`/api/reports/where?${OCT}`)).body.topTransactions).toEqual([]);
    expect((await getJson('/api/budgets?month=2026-10')).body.budgets).toEqual([]);
    expect((await getJson(`/api/export/transactions?${OCT}`)).body.rows).toEqual([]);
    expect((await getJson('/api/recurring')).body.series).toEqual([]);
  });
});

describe('health for a future period', () => {
  it('scores the requested month, not the current one', async () => {
    await txn('2031-03-01', 80_000, 'in', 'salary');
    await txn('2031-03-03', 20_000, 'out', 'rent');
    const h = (await getJson('/api/reports/health?period=month&date=2031-03-15')).body;
    expect(h.totals).toMatchObject({ income: 80_000 * R, spend: 20_000 * R });
  });
});
