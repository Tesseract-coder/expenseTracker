import { describe, expect, it } from 'vitest';
import { addMonths, addDays } from '../dates';
import { budgetStatus } from './budgets';
import { foldOther, pctChange, rollingAverage, shareChanges } from './insights';
import { detectRecurring, median, type Occurrence } from './recurring';
import {
  budgetUpsertSchema,
  reportQuerySchema,
  settingsPatchSchema,
  trendsQuerySchema,
} from './schemas';

const monthly = (start: string, n: number, amount: number, step = 1): Occurrence[] =>
  Array.from({ length: n }, (_, i) => ({ date: addMonths(start, i * step), amountPaise: amount }));

describe('detectRecurring', () => {
  const today = '2026-11-02';

  it('finds a monthly SIP and predicts the next date', () => {
    const r = detectRecurring(monthly('2026-05-05', 6, 500_000), today);
    expect(r).toMatchObject({
      cadence: 'monthly',
      typicalAmountPaise: 500_000,
      lastDate: '2026-10-05',
      nextExpectedDate: '2026-11-05',
      occurrences: 6,
      status: 'active',
    });
  });

  it('tolerates small date jitter and amount noise (utility bills)', () => {
    const occ = [
      { date: '2026-06-03', amountPaise: 140_000 },
      { date: '2026-07-06', amountPaise: 152_000 },
      { date: '2026-08-02', amountPaise: 147_000 },
      { date: '2026-09-04', amountPaise: 139_000 },
      { date: '2026-10-03', amountPaise: 150_000 },
    ];
    expect(detectRecurring(occ, today)?.cadence).toBe('monthly');
  });

  it('flags a price change on the latest payment', () => {
    const occ = [...monthly('2026-05-12', 5, 64_900), { date: '2026-10-12', amountPaise: 79_900 }];
    expect(detectRecurring(occ, today)).toMatchObject({
      status: 'price_changed',
      typicalAmountPaise: 64_900,
      lastAmountPaise: 79_900,
    });
  });

  it('marks a new subscription and a stopped one', () => {
    expect(detectRecurring(monthly('2026-08-20', 3, 19_900), today)?.status).toBe('new');
    expect(detectRecurring(monthly('2026-02-01', 5, 19_900), today)?.status).toBe('stopped');
  });

  it.each([
    [
      'weekly',
      Array.from({ length: 6 }, (_, i) => ({
        date: addDays('2026-09-01', i * 7),
        amountPaise: 30_000,
      })),
    ],
    ['quarterly', monthly('2025-11-15', 4, 1_200_000, 3)],
    ['yearly', monthly('2024-12-10', 2, 2_400_000, 12)],
  ] as const)('detects %s cadence', (cadence, occ) =>
    expect(detectRecurring([...occ], '2026-10-20')?.cadence).toBe(cadence),
  );

  it('ignores one-off outliers in amount', () => {
    const occ = [
      ...monthly('2026-04-01', 6, 100_000),
      { date: '2026-06-18', amountPaise: 2_000_000 },
    ];
    expect(detectRecurring(occ, today)).toMatchObject({ cadence: 'monthly', occurrences: 6 });
  });

  it('merges same-day payments and rejects irregular series', () => {
    const occ = [
      { date: '2026-01-03', amountPaise: 10_000 },
      { date: '2026-01-03', amountPaise: 10_000 },
      { date: '2026-02-03', amountPaise: 20_000 },
    ];
    expect(detectRecurring(occ, today)).toBeNull();
    const random = ['2026-01-02', '2026-01-19', '2026-03-30', '2026-04-04', '2026-08-15'].map(
      (date) => ({ date, amountPaise: 50_000 }),
    );
    expect(detectRecurring(random, today)).toBeNull();
    expect(detectRecurring([{ date: '2026-01-01', amountPaise: 1 }], today)).toBeNull();
    expect(detectRecurring(monthly('2026-08-01', 2, 10_000), today)).toBeNull(); // monthly needs 3
  });

  it('rejects series whose intervals are mostly irregular', () => {
    const occ = [
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-03-09',
      '2026-04-20',
      '2026-05-01',
    ].map((date) => ({ date, amountPaise: 10_000 }));
    expect(detectRecurring(occ, today)).toBeNull();
  });

  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
  });
});

describe('budgetStatus', () => {
  it('projects the current month from the run rate', () => {
    // ₹6,000 spent by Nov 10 of 30 days → ₹18,000 projected against ₹15,000.
    expect(budgetStatus(1_500_000, 600_000, '2026-11', '2026-11-10')).toEqual({
      pct: 0.4,
      projectedPaise: 1_800_000,
      state: 'ok',
      projectedState: 'over',
      remainingPaise: 900_000,
    });
  });

  it.each([
    [790_000, 'ok'],
    [800_000, 'warning'],
    [1_000_000, 'over'],
  ] as const)('a past month with %i spent is %s', (spent, state) => {
    const s = budgetStatus(1_000_000, spent, '2026-09', '2026-11-02');
    expect(s.state).toBe(state);
    expect(s.projectedPaise).toBe(spent);
  });

  it('handles future months, refunds and zero budgets', () => {
    expect(budgetStatus(1_000, 0, '2027-01', '2026-11-02').projectedPaise).toBe(0);
    expect(budgetStatus(1_000, -500, '2026-11', '2026-11-02').projectedPaise).toBe(0);
    expect(budgetStatus(0, 0, '2026-11', '2026-11-02').pct).toBe(0);
  });
});

describe('insights', () => {
  it('shareChanges sorts by absolute delta and skips noise', () => {
    const cur = new Map([
      ['food', 1_080_000],
      ['rent', 2_500_000],
      ['fuel', 100_00],
    ]);
    const prev = new Map([
      ['food', 760_000],
      ['rent', 2_500_000],
      ['cabs', 400_000],
    ]);
    expect(shareChanges(cur, prev)).toEqual([
      { id: 'cabs', current: 0, previous: 400_000, delta: -400_000, pct: -1 },
      { id: 'food', current: 1_080_000, previous: 760_000, delta: 320_000, pct: 320_000 / 760_000 },
    ]);
    expect(shareChanges(cur, prev, 5_000).at(-1)).toEqual({
      id: 'fuel',
      current: 10_000,
      previous: 0,
      delta: 10_000,
      pct: null,
    });
  });

  it('pctChange and rollingAverage', () => {
    expect(pctChange(150, 100)).toBe(0.5);
    expect(pctChange(1, 0)).toBeNull();
    expect(pctChange(-50, -100)).toBe(0.5);
    expect(rollingAverage([3, 6, 9, 12], 3)).toEqual([3, 5, 6, 9]);
  });

  it('foldOther keeps the head and sums the tail', () => {
    const items = [5, 4, 3, 2, 1].map((value, i) => ({ id: `c${i}`, value }));
    expect(foldOther(items, 2, (value, n) => ({ id: `other(${n})`, value }))).toEqual([
      { id: 'c0', value: 5 },
      { id: 'c1', value: 4 },
      { id: 'other(3)', value: 6 },
    ]);
    expect(foldOther(items.slice(0, 3), 2, (value) => ({ id: 'x', value }))).toHaveLength(3);
  });
});

describe('report schemas', () => {
  it('validates ranges and lists', () => {
    expect(
      reportQuerySchema.parse({ from: '2026-11-01', to: '2026-11-30', accountIds: 'a,b' }),
    ).toEqual({ from: '2026-11-01', to: '2026-11-30', accountIds: ['a', 'b'] });
    expect(reportQuerySchema.safeParse({ from: '2026-12-01', to: '2026-11-30' }).success).toBe(
      false,
    );
    expect(reportQuerySchema.safeParse({ from: '2010-01-01', to: '2026-11-30' }).success).toBe(
      false,
    );
    expect(trendsQuerySchema.parse({ from: '2026-01-01', to: '2026-12-31' })).toMatchObject({
      granularity: 'month',
      yearMode: 'calendar',
    });
  });

  it('validates budgets and settings', () => {
    expect(budgetUpsertSchema.parse({ categoryId: 'c', amountPaise: 100 })).toEqual({
      categoryId: 'c',
      amountPaise: 100,
      month: null,
    });
    expect(
      budgetUpsertSchema.safeParse({ categoryId: 'c', amountPaise: 1, month: '2026-13' }).success,
    ).toBe(false);
    expect(settingsPatchSchema.safeParse({}).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ targets: { savingsRate: 0.3 } }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ targets: { savingsRate: 3 } }).success).toBe(false);
  });
});
