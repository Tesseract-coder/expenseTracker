import { formatINR } from '../money';

/**
 * Financial health score (spec §7.6). Pure and deterministic: the API passes aggregated figures
 * (≈ 12 monthly rows), never transactions. All money is integer paise, net of refunds.
 */
export interface MonthlyAggregate {
  month: string; // 'YYYY-MM'
  income: number;
  needs: number;
  wants: number;
  /** Uncategorized outflow: counted as spend, but in neither needs nor wants. */
  unclassified: number;
  invested: number;
}

export interface HealthTargets {
  savingsRate: number; // 0.2
  investmentRate: number; // 0.15
  needs: number; // 0.5
  wants: number; // 0.3
  savings: number; // 0.2
  emergencyMonths: number; // 6
}

export const DEFAULT_TARGETS: HealthTargets = {
  savingsRate: 0.2,
  investmentRate: 0.15,
  needs: 0.5,
  wants: 0.3,
  savings: 0.2,
  emergencyMonths: 6,
};

export interface WantCategoryHistory {
  name: string;
  /** Spend per month for the last 3 complete-or-current months (paise). */
  months: number[];
}

export interface HealthInput {
  /** Chronological history ending at the last month of the scored period (≥ 1 row). */
  history: MonthlyAggregate[];
  /** How many trailing months of `history` form the scored period (1 = a month, 12 = a year). */
  periodMonths: number;
  budgets: { total: number; within: number; overNames: string[] };
  emergencyFundPaise: number | null;
  targets: HealthTargets;
  wantCategories: WantCategoryHistory[];
}

export type HealthStatus = 'good' | 'warning' | 'serious' | 'critical' | 'na';
export type HealthBand = 'excellent' | 'good' | 'needs_attention' | 'off_track';
export type HealthComponentKey =
  | 'savings_rate'
  | 'investment_rate'
  | 'split'
  | 'budget_adherence'
  | 'spending_trend'
  | 'lifestyle_creep'
  | 'emergency_fund';

export interface HealthComponent {
  key: HealthComponentKey;
  label: string;
  /** Display value, e.g. "18.4%", "3.2 months", "Needs 55% · Wants 28% · Savings 17%". */
  value: string;
  target: string;
  /** 0–100, or null when there isn't enough data (excluded from the score). */
  score: number | null;
  weight: number;
  status: HealthStatus;
  verdict: string;
}

export interface HealthResult {
  score: number | null;
  band: HealthBand | null;
  components: HealthComponent[];
  drivers: { key: HealthComponentKey; impact: 'positive' | 'negative'; text: string }[];
  suggestions: string[];
  totals: {
    income: number;
    spend: number;
    needs: number;
    wants: number;
    invested: number;
    savings: number;
  };
}

const WEIGHTS: Record<HealthComponentKey, number> = {
  savings_rate: 30,
  investment_rate: 15,
  split: 15,
  budget_adherence: 15,
  spending_trend: 10,
  lifestyle_creep: 10,
  emergency_fund: 10,
};

const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const round1 = (x: number) => Math.round(x * 10) / 10;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const spendOf = (m: MonthlyAggregate) => m.needs + m.wants + m.unclassified;
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
/** Rounds paise to a friendly rupee step (₹500 under ₹20k, ₹1,000 above). */
const friendly = (paise: number) => {
  const step = paise >= 20_000_00 ? 1_000_00 : 500_00;
  return Math.max(step, Math.round(paise / step) * step);
};
/** Whole rupees for advice text ("₹7,997", not "₹7,996.57"). */
const inr = (p: number) => formatINR(Math.round(p / 100) * 100, { compactZeroPaise: true });

export function statusFor(score: number | null): HealthStatus {
  if (score === null) return 'na';
  if (score >= 80) return 'good';
  if (score >= 50) return 'warning';
  if (score >= 25) return 'serious';
  return 'critical';
}

export function bandFor(score: number): HealthBand {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'needs_attention';
  return 'off_track';
}

/** Linear score: ≥ target → 100, ≤ floor → 0. */
const linear = (value: number, floor: number, target: number) =>
  clamp(((value - floor) / (target - floor)) * 100);

export function computeHealth(input: HealthInput): HealthResult {
  const { history, targets } = input;
  const period = history.slice(-Math.max(1, input.periodMonths));
  const income = sum(period.map((m) => m.income));
  const needs = sum(period.map((m) => m.needs));
  const wants = sum(period.map((m) => m.wants));
  const spend = sum(period.map(spendOf));
  const invested = sum(period.map((m) => m.invested));
  const savings = income - spend;
  const hasIncome = income > 0;
  const components: HealthComponent[] = [];
  const add = (c: Omit<HealthComponent, 'weight' | 'status'>) =>
    components.push({ ...c, weight: WEIGHTS[c.key], status: statusFor(c.score) });

  // 1. Savings rate = (income − needs − wants) / income.
  const savingsRate = hasIncome ? savings / income : null;
  add({
    key: 'savings_rate',
    label: 'Savings rate',
    value: savingsRate === null ? '—' : pct(savingsRate),
    target: `≥ ${pct(targets.savingsRate, 0)}`,
    score: savingsRate === null ? null : linear(savingsRate, 0, targets.savingsRate),
    verdict:
      savingsRate === null
        ? 'No income recorded in this period.'
        : savingsRate >= targets.savingsRate
          ? `You kept ${pct(savingsRate)} of your income. On target.`
          : savingsRate >= 0
            ? `You kept ${pct(savingsRate)} of your income; the target is ${pct(targets.savingsRate, 0)}.`
            : `You spent ${inr(-savings)} more than you earned.`,
  });

  // 2. Investment rate = invested / income.
  const investmentRate = hasIncome ? invested / income : null;
  add({
    key: 'investment_rate',
    label: 'Investment rate',
    value: investmentRate === null ? '—' : pct(investmentRate),
    target: `≥ ${pct(targets.investmentRate, 0)}`,
    score: investmentRate === null ? null : linear(investmentRate, 0, targets.investmentRate),
    verdict:
      investmentRate === null
        ? 'No income recorded in this period.'
        : investmentRate >= targets.investmentRate
          ? `${pct(investmentRate)} of income went into investments.`
          : `${pct(investmentRate)} of income was invested; aim for ${pct(targets.investmentRate, 0)}.`,
  });

  // 3. Needs / wants / savings vs the 50/30/20 guideline. Deviation of 0.5 (summed) scores 0.
  if (hasIncome) {
    const n = needs / income;
    const w = wants / income;
    const s = savings / income;
    const deviation =
      Math.max(0, n - targets.needs) +
      Math.max(0, w - targets.wants) +
      Math.max(0, targets.savings - s);
    const worst = [
      { k: 'Needs', over: n - targets.needs },
      { k: 'Wants', over: w - targets.wants },
    ].sort((a, b) => b.over - a.over)[0] as { k: string; over: number };
    add({
      key: 'split',
      label: 'Needs / wants / savings',
      value: `${pct(n, 0)} / ${pct(w, 0)} / ${pct(s, 0)}`,
      target: `${pct(targets.needs, 0)} / ${pct(targets.wants, 0)} / ${pct(targets.savings, 0)}`,
      score: clamp(100 - deviation * 200),
      verdict:
        deviation < 0.02
          ? 'Your split is within the guideline.'
          : worst.over > 0
            ? `${worst.k} are ${pct(worst.over, 0)} of income above the guideline.`
            : 'Savings are below the guideline share.',
    });
  } else {
    add({
      key: 'split',
      label: 'Needs / wants / savings',
      value: '—',
      target: `${pct(targets.needs, 0)} / ${pct(targets.wants, 0)} / ${pct(targets.savings, 0)}`,
      score: null,
      verdict: 'No income recorded in this period.',
    });
  }

  // 4. Budget adherence = budgets kept / budgets set.
  const { total, within, overNames } = input.budgets;
  add({
    key: 'budget_adherence',
    label: 'Budget adherence',
    value: total ? `${within} of ${total}` : '—',
    target: 'All within budget',
    score: total ? (within / total) * 100 : null,
    verdict: !total
      ? 'Set budgets to track this.'
      : within === total
        ? 'Every budget was kept.'
        : `Over budget: ${overNames.slice(0, 3).join(', ')}${overNames.length > 3 ? '…' : ''}.`,
  });

  // 5. Spending trend: 3-month average spend growing faster than income is negative.
  const last3 = history.slice(-3);
  const prev3 = history.slice(-6, -3);
  if (history.length >= 6 && avg(prev3.map(spendOf)) > 0 && avg(prev3.map((m) => m.income)) > 0) {
    const growth = (a: number, b: number) => (b > 0 ? (a - b) / b : 0);
    const spendGrowth = growth(avg(last3.map(spendOf)), avg(prev3.map(spendOf)));
    const incomeGrowth = growth(avg(last3.map((m) => m.income)), avg(prev3.map((m) => m.income)));
    const gap = spendGrowth - incomeGrowth;
    add({
      key: 'spending_trend',
      label: 'Spending trend',
      value: `Spend ${spendGrowth >= 0 ? '+' : ''}${pct(spendGrowth, 0)} · income ${incomeGrowth >= 0 ? '+' : ''}${pct(incomeGrowth, 0)}`,
      target: 'Spend grows no faster than income',
      score: clamp(100 - (gap / 0.2) * 100),
      verdict:
        gap <= 0
          ? 'Spending is growing no faster than income (3-month averages).'
          : `Spending is growing ${pct(gap, 0)} faster than income (3-month averages).`,
    });
  } else {
    add({
      key: 'spending_trend',
      label: 'Spending trend',
      value: '—',
      target: 'Spend grows no faster than income',
      score: null,
      verdict: 'Needs 6 months of income and spending history.',
    });
  }

  // 6. Lifestyle creep: wants' share of income rising for 3+ consecutive months.
  if (history.filter((m) => m.income > 0).length >= 4) {
    const shares = history.map((m) => (m.income > 0 ? m.wants / m.income : null));
    let streak = 0;
    for (let i = shares.length - 1; i > 0; i--) {
      const cur = shares[i];
      const prev = shares[i - 1];
      if (cur === null || cur === undefined || prev === null || prev === undefined || cur <= prev)
        break;
      streak++;
    }
    add({
      key: 'lifestyle_creep',
      label: 'Lifestyle creep',
      value: streak === 0 ? 'No rise' : `Rising ${streak} month${streak === 1 ? '' : 's'}`,
      target: 'Wants share not rising 3+ months',
      score: streak >= 3 ? 0 : streak === 2 ? 50 : 100,
      verdict:
        streak >= 3
          ? `Wants have taken a bigger share of income for ${streak} months in a row.`
          : streak === 2
            ? 'Wants share rose two months in a row; keep an eye on it.'
            : 'Wants share is stable.',
    });
  } else {
    add({
      key: 'lifestyle_creep',
      label: 'Lifestyle creep',
      value: '—',
      target: 'Wants share not rising 3+ months',
      score: null,
      verdict: 'Needs 4 months with income.',
    });
  }

  // 7. Emergency fund coverage = fund / average monthly needs (last 3–6 months).
  const recentNeeds = history.slice(-6).map((m) => m.needs);
  const monthlyNeeds = avg(recentNeeds);
  const coverage =
    input.emergencyFundPaise !== null && monthlyNeeds > 0
      ? input.emergencyFundPaise / monthlyNeeds
      : null;
  add({
    key: 'emergency_fund',
    label: 'Emergency fund',
    value: coverage === null ? '—' : `${round1(coverage)} months`,
    target: `${targets.emergencyMonths} months of essentials`,
    score: coverage === null ? null : linear(coverage, 0, targets.emergencyMonths),
    verdict:
      input.emergencyFundPaise === null
        ? 'Enter your emergency fund in Targets to track this.'
        : coverage === null
          ? 'No essential spending recorded yet.'
          : coverage >= targets.emergencyMonths
            ? `Covers ${round1(coverage)} months of essentials.`
            : `Covers ${round1(coverage)} months of essentials; the target is ${targets.emergencyMonths}.`,
  });

  // Weighted score over components with data.
  const scored = components.filter((c) => c.score !== null);
  const weightSum = sum(scored.map((c) => c.weight));
  const score =
    weightSum > 0
      ? Math.round(sum(scored.map((c) => (c.score as number) * c.weight)) / weightSum)
      : null;

  // Drivers: the components moving the score most, each way.
  const impact = (c: HealthComponent) => ((c.score as number) - 60) * c.weight;
  const negatives = scored
    .filter((c) => (c.score as number) < 60)
    .sort((a, b) => impact(a) - impact(b))
    .slice(0, 2)
    .map((c) => ({ key: c.key, impact: 'negative' as const, text: `${c.label}: ${c.verdict}` }));
  const positives = scored
    .filter((c) => (c.score as number) >= 80)
    .sort((a, b) => impact(b) - impact(a))
    .slice(0, Math.max(1, 3 - negatives.length))
    .map((c) => ({ key: c.key, impact: 'positive' as const, text: `${c.label}: ${c.verdict}` }));

  return {
    score,
    band: score === null ? null : bandFor(score),
    components,
    drivers: [...negatives, ...positives].slice(0, 3),
    suggestions: suggest(input, {
      income,
      spend,
      savingsRate,
      investmentRate,
      monthlyNeeds,
      coverage,
    }),
    totals: { income, spend, needs, wants, invested, savings },
  };
}

function suggest(
  input: HealthInput,
  f: {
    income: number;
    spend: number;
    savingsRate: number | null;
    investmentRate: number | null;
    monthlyNeeds: number;
    coverage: number | null;
  },
): string[] {
  const { targets } = input;
  const out: string[] = [];
  const months = Math.max(1, input.periodMonths);
  const monthlyIncome = f.income / months;
  const incomeBase = avg(input.history.slice(-3).map((m) => m.income));

  // Biggest want: trim to ~60% of its 3-month average.
  const wants = input.wantCategories
    .map((c) => ({ name: c.name, avg: avg(c.months) }))
    .filter((c) => c.avg >= 1_000_00)
    .sort((a, b) => b.avg - a.avg);
  const top = wants[0];
  if (top && incomeBase > 0) {
    const to = friendly(top.avg * 0.6);
    if (to < top.avg) {
      const pts = ((top.avg - to) / incomeBase) * 100;
      out.push(
        `${top.name} averaged ${inr(Math.round(top.avg))}/month over 3 months; cutting to ${inr(to)} raises your savings rate by ${pts.toFixed(1)} pts.`,
      );
    }
  }

  if (f.savingsRate !== null && f.savingsRate < targets.savingsRate && monthlyIncome > 0) {
    const gap = friendly((targets.savingsRate - f.savingsRate) * monthlyIncome);
    out.push(
      `Saving ${inr(gap)} more per month would bring you to your ${Math.round(targets.savingsRate * 100)}% savings target.`,
    );
  }

  if (input.budgets.overNames.length > 0) {
    out.push(
      `Review the budgets you went over: ${input.budgets.overNames.slice(0, 3).join(', ')}.`,
    );
  }

  if (
    f.investmentRate !== null &&
    f.investmentRate < targets.investmentRate &&
    f.savingsRate !== null &&
    f.savingsRate >= targets.investmentRate &&
    monthlyIncome > 0
  ) {
    const more = friendly((targets.investmentRate - f.investmentRate) * monthlyIncome);
    out.push(
      `You're saving but not investing much: a SIP of ${inr(more)}/month would reach your investment target.`,
    );
  }

  if (f.coverage !== null && f.coverage < targets.emergencyMonths && f.monthlyNeeds > 0) {
    const goal = Math.round(f.monthlyNeeds * targets.emergencyMonths);
    out.push(
      `Grow your emergency fund towards ${inr(friendly(goal))} (${targets.emergencyMonths} months of essentials).`,
    );
  }
  return out.slice(0, 4);
}
