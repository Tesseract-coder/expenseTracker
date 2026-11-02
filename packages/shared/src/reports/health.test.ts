import { describe, expect, it } from 'vitest';
import {
  bandFor,
  computeHealth,
  DEFAULT_TARGETS,
  type HealthInput,
  type MonthlyAggregate,
  statusFor,
} from './health';

const R = 100; // paise per rupee
const month = (i: number, over: Partial<MonthlyAggregate> = {}): MonthlyAggregate => ({
  month: `2026-${String(i).padStart(2, '0')}`,
  income: 100_000 * R,
  needs: 45_000 * R,
  wants: 25_000 * R,
  unclassified: 0,
  invested: 20_000 * R,
  ...over,
});

const input = (over: Partial<HealthInput> = {}): HealthInput => ({
  history: [1, 2, 3, 4, 5, 6].map((i) => month(i)),
  periodMonths: 1,
  budgets: { total: 4, within: 4, overNames: [] },
  emergencyFundPaise: 300_000 * R,
  targets: DEFAULT_TARGETS,
  wantCategories: [],
  ...over,
});

const comp = (r: ReturnType<typeof computeHealth>, key: string) =>
  r.components.find((c) => c.key === key)!;

describe('computeHealth', () => {
  it('scores a disciplined month as excellent', () => {
    const r = computeHealth(input());
    expect(r.totals).toEqual({
      income: 100_000 * R,
      spend: 70_000 * R,
      needs: 45_000 * R,
      wants: 25_000 * R,
      invested: 20_000 * R,
      savings: 30_000 * R,
    });
    expect(comp(r, 'savings_rate')).toMatchObject({ value: '30.0%', score: 100, status: 'good' });
    expect(comp(r, 'investment_rate')).toMatchObject({ value: '20.0%', score: 100 });
    expect(comp(r, 'split')).toMatchObject({ value: '45% / 25% / 30%', score: 100 });
    expect(comp(r, 'emergency_fund')).toMatchObject({ value: '6.7 months', score: 100 });
    expect(r.score).toBe(100);
    expect(r.band).toBe('excellent');
    expect(r.drivers.every((d) => d.impact === 'positive')).toBe(true);
  });

  it('is deterministic', () => {
    expect(computeHealth(input())).toEqual(computeHealth(input()));
  });

  it('flags overspending, low investment and over-budget categories', () => {
    const bad = month(6, { needs: 70_000 * R, wants: 40_000 * R, invested: 0 });
    const r = computeHealth(
      input({
        history: [1, 2, 3, 4, 5].map((i) => month(i)).concat(bad),
        budgets: { total: 4, within: 1, overNames: ['Food delivery', 'Shopping', 'Cabs'] },
      }),
    );
    expect(comp(r, 'savings_rate')).toMatchObject({
      value: '-10.0%',
      score: 0,
      status: 'critical',
    });
    expect(comp(r, 'savings_rate').verdict).toContain('more than you earned');
    expect(comp(r, 'investment_rate').score).toBe(0);
    expect(comp(r, 'budget_adherence')).toMatchObject({ value: '1 of 4', score: 25 });
    expect(comp(r, 'budget_adherence').verdict).toContain('Food delivery, Shopping, Cabs');
    expect(r.band).toBe('off_track');
    expect(r.drivers[0]).toMatchObject({ impact: 'negative', key: 'savings_rate' });
    expect(r.suggestions.some((s) => s.includes('Review the budgets'))).toBe(true);
  });

  it('suggests trimming the biggest want with the savings-rate gain (spec example)', () => {
    const r = computeHealth(
      input({
        history: [1, 2, 3].map((i) => month(i, { income: 9_032_258 })),
        wantCategories: [
          { name: 'Food delivery', months: [680_000, 680_000, 680_000] },
          { name: 'Movies', months: [50_000, 50_000, 50_000] },
        ],
      }),
    );
    expect(r.suggestions[0]).toBe(
      'Food delivery averaged ₹6,800/month over 3 months; cutting to ₹4,000 raises your savings rate by 3.1 pts.',
    );
  });

  it('suggests the monthly gap to the savings target, emergency fund and investing', () => {
    const r = computeHealth(
      input({
        history: [month(1, { needs: 60_000 * R, wants: 30_000 * R, invested: 5_000 * R })],
        emergencyFundPaise: 60_000 * R,
      }),
    );
    expect(r.suggestions).toContain(
      'Saving ₹10,000 more per month would bring you to your 20% savings target.',
    );
    expect(
      r.suggestions.some((s) => s.startsWith('Grow your emergency fund towards ₹3,60,000')),
    ).toBe(true);

    const saver = computeHealth(input({ history: [month(1, { invested: 2_000 * R })] }));
    expect(saver.suggestions.some((s) => s.includes('SIP of ₹13,000/month'))).toBe(true);
  });

  it('measures the split deviation from 50/30/20', () => {
    const r = computeHealth(
      input({ history: [month(1, { needs: 60_000 * R, wants: 30_000 * R })] }),
    );
    // needs +10pts over, savings 10pts under → deviation 0.2 → score 60
    expect(comp(r, 'split')).toMatchObject({ value: '60% / 30% / 10%', score: 60 });
    expect(comp(r, 'split').verdict).toBe('Needs are 10% of income above the guideline.');
    const s = computeHealth(
      input({ history: [month(1, { needs: 50_000 * R, wants: 30_000 * R })] }),
    );
    expect(comp(s, 'split').verdict).toBe('Your split is within the guideline.');
    const low = computeHealth(
      input({ history: [month(1, { needs: 40_000 * R, wants: 25_000 * R, income: 85_000 * R })] }),
    );
    expect(comp(low, 'split').verdict).toBe('Your split is within the guideline.');
  });

  it('detects spending growing faster than income', () => {
    const history = [
      ...[1, 2, 3].map((i) => month(i)),
      ...[4, 5, 6].map((i) => month(i, { wants: 39_000 * R })), // spend 70k → 84k (+20%)
    ];
    const r = computeHealth(input({ history }));
    expect(comp(r, 'spending_trend')).toMatchObject({
      value: 'Spend +20% · income +0%',
      score: 0,
    });
    expect(comp(input2(), 'spending_trend').score).toBe(100);
    function input2() {
      return computeHealth(input());
    }
  });

  it('detects lifestyle creep over 3+ consecutive months', () => {
    const rising = [1, 2, 3, 4].map((i) => month(i, { wants: (20_000 + i * 2_000) * R }));
    expect(comp(computeHealth(input({ history: rising })), 'lifestyle_creep')).toMatchObject({
      value: 'Rising 3 months',
      score: 0,
      status: 'critical',
    });
    const two = [
      month(1),
      month(2),
      month(3, { wants: 26_000 * R }),
      month(4, { wants: 27_000 * R }),
    ];
    expect(comp(computeHealth(input({ history: two })), 'lifestyle_creep').score).toBe(50);
    const flat = [1, 2, 3, 4].map((i) => month(i));
    expect(comp(computeHealth(input({ history: flat })), 'lifestyle_creep').value).toBe('No rise');
    const zeroIncome = [1, 2, 3, 4, 5].map((i) => month(i, { income: i === 4 ? 0 : 100_000 * R }));
    expect(comp(computeHealth(input({ history: zeroIncome })), 'lifestyle_creep').score).toBe(100);
  });

  it('marks components without enough data as n/a and leaves them out of the score', () => {
    const r = computeHealth(
      input({
        history: [month(1)],
        budgets: { total: 0, within: 0, overNames: [] },
        emergencyFundPaise: null,
      }),
    );
    for (const key of ['budget_adherence', 'spending_trend', 'lifestyle_creep', 'emergency_fund']) {
      expect(comp(r, key)).toMatchObject({ score: null, status: 'na' });
    }
    expect(r.score).toBe(100);
  });

  it('handles a period with no income', () => {
    const r = computeHealth(
      input({
        history: [month(1, { income: 0, needs: 0, wants: 0, invested: 0 })],
        budgets: { total: 0, within: 0, overNames: [] },
        emergencyFundPaise: null,
      }),
    );
    expect(r.score).toBeNull();
    expect(r.band).toBeNull();
    expect(comp(r, 'savings_rate').verdict).toBe('No income recorded in this period.');
    expect(comp(r, 'split').score).toBeNull();
    expect(r.suggestions).toEqual([]);
  });

  it('never scores an empty history as healthy', () => {
    const empty = Array.from({ length: 12 }, (_, i) =>
      month(i + 1, { income: 0, needs: 0, wants: 0, invested: 0 }),
    );
    const r = computeHealth(
      input({
        history: empty,
        periodMonths: 12,
        budgets: { total: 0, within: 0, overNames: [] },
        emergencyFundPaise: null,
      }),
    );
    expect(r.score).toBeNull();
    expect(comp(r, 'spending_trend').score).toBeNull();
    expect(comp(r, 'lifestyle_creep').score).toBeNull();
  });

  it('reports an emergency fund with no essential spend yet', () => {
    const r = computeHealth(input({ history: [month(1, { needs: 0 })] }));
    expect(comp(r, 'emergency_fund').verdict).toBe('No essential spending recorded yet.');
  });

  it('scores a year from its 12 trailing months', () => {
    const history = Array.from({ length: 12 }, (_, i) => month(i + 1));
    const r = computeHealth(input({ history, periodMonths: 12 }));
    expect(r.totals.income).toBe(1_200_000 * R);
  });

  it('counts uncategorized outflow as spend', () => {
    const r = computeHealth(input({ history: [month(1, { unclassified: 10_000 * R })] }));
    expect(r.totals.spend).toBe(80_000 * R);
    expect(comp(r, 'savings_rate').value).toBe('20.0%');
  });
});

describe('status and band', () => {
  it.each([
    [null, 'na'],
    [95, 'good'],
    [80, 'good'],
    [60, 'warning'],
    [30, 'serious'],
    [10, 'critical'],
  ] as const)('statusFor(%s) = %s', (s, e) => expect(statusFor(s)).toBe(e));

  it.each([
    [85, 'excellent'],
    [65, 'good'],
    [45, 'needs_attention'],
    [20, 'off_track'],
  ] as const)('bandFor(%i) = %s', (s, e) => expect(bandFor(s)).toBe(e));
});
