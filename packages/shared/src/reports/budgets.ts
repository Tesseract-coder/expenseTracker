import { daysInMonth, type IsoDate } from '../dates';

export type BudgetState = 'ok' | 'warning' | 'over';

/** Alert thresholds (spec §7.5): 80% → warning, 100% → over. */
export const BUDGET_WARNING = 0.8;

export interface BudgetStatus {
  pct: number;
  /** Projected month-end spend from the run rate; equals `spent` for past months. */
  projectedPaise: number;
  state: BudgetState;
  projectedState: BudgetState;
  remainingPaise: number;
}

const stateOf = (spent: number, amount: number): BudgetState =>
  spent >= amount ? 'over' : spent >= amount * BUDGET_WARNING ? 'warning' : 'ok';

/** Status of a monthly budget. `month` is 'YYYY-MM'; `today` decides how much of it has elapsed. */
export function budgetStatus(
  amountPaise: number,
  spentPaise: number,
  month: string,
  today: IsoDate,
): BudgetStatus {
  const total = daysInMonth(month);
  const current = today.slice(0, 7);
  let projected = spentPaise;
  if (month === current) {
    const elapsed = Number(today.slice(8, 10));
    projected = Math.round((Math.max(spentPaise, 0) / elapsed) * total);
  } else if (month > current) {
    projected = spentPaise;
  }
  return {
    pct: amountPaise > 0 ? spentPaise / amountPaise : 0,
    projectedPaise: projected,
    state: stateOf(spentPaise, amountPaise),
    projectedState: stateOf(projected, amountPaise),
    remainingPaise: amountPaise - spentPaise,
  };
}
