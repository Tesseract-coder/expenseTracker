import { addDays, addMonths, diffDays, type IsoDate } from '../dates';

/**
 * Recurring payment detection (spec §7.4): same counterparty, similar amount, regular interval.
 * Pure; the API feeds one series per counterparty and caches results in `recurring_series`.
 */
export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringStatus = 'active' | 'new' | 'price_changed' | 'stopped';

export interface Occurrence {
  date: IsoDate;
  amountPaise: number;
}

export interface RecurringMatch {
  cadence: Cadence;
  typicalAmountPaise: number;
  amountTolerancePct: number;
  lastDate: IsoDate;
  lastAmountPaise: number;
  nextExpectedDate: IsoDate;
  occurrences: number;
  status: RecurringStatus;
}

const CADENCES: { cadence: Cadence; days: number; slack: number; min: number }[] = [
  { cadence: 'weekly', days: 7, slack: 2, min: 4 },
  { cadence: 'monthly', days: 30.44, slack: 5, min: 3 },
  { cadence: 'quarterly', days: 91.3, slack: 12, min: 3 },
  { cadence: 'yearly', days: 365.25, slack: 20, min: 2 },
];

/** Amounts within this fraction of the median count as "the same" payment. */
export const AMOUNT_TOLERANCE = 0.15;
/** A last amount this far from the earlier median flags a price change. */
export const PRICE_CHANGE = 0.1;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2
    ? (s[mid] as number)
    : Math.round(((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

function nextDate(last: IsoDate, cadence: Cadence): IsoDate {
  switch (cadence) {
    case 'weekly':
      return addDays(last, 7);
    case 'monthly':
      return addMonths(last, 1);
    case 'quarterly':
      return addMonths(last, 3);
    case 'yearly':
      return addMonths(last, 12);
  }
}

export function detectRecurring(input: Occurrence[], today: IsoDate): RecurringMatch | null {
  // One payment per day (two same-day charges are usually a split order, not a cadence).
  const byDay = new Map<IsoDate, number>();
  for (const o of input) byDay.set(o.date, (byDay.get(o.date) ?? 0) + o.amountPaise);
  const series = [...byDay].map(([date, amountPaise]) => ({ date, amountPaise }));
  series.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (series.length < 2) return null;

  // Keep the payments close to the median amount; a one-off big purchase doesn't break a SIP.
  const typical = median(series.map((s) => s.amountPaise));
  const recurring = series.filter(
    (s, i) =>
      Math.abs(s.amountPaise - typical) <= typical * AMOUNT_TOLERANCE ||
      // the most recent payment may be a new price
      i === series.length - 1,
  );
  if (recurring.length < 2) return null;

  const intervals = recurring
    .slice(1)
    .map((s, i) => diffDays((recurring[i] as Occurrence).date, s.date));
  const typicalInterval = median(intervals);
  const match = CADENCES.find((c) => Math.abs(typicalInterval - c.days) <= c.slack);
  if (!match || recurring.length < match.min) return null;
  const regular = intervals.filter((d) => Math.abs(d - match.days) <= match.slack).length;
  if (regular / intervals.length < 0.7) return null;

  const last = recurring[recurring.length - 1] as Occurrence;
  const earlier = median(recurring.slice(0, -1).map((s) => s.amountPaise));
  const nextExpectedDate = nextDate(last.date, match.cadence);
  const overdue = diffDays(nextExpectedDate, today);

  let status: RecurringStatus = 'active';
  if (overdue > match.days * 0.5 + match.slack) status = 'stopped';
  else if (Math.abs(last.amountPaise - earlier) > earlier * PRICE_CHANGE) status = 'price_changed';
  else if (recurring.length <= match.min) status = 'new';

  return {
    cadence: match.cadence,
    typicalAmountPaise: earlier,
    amountTolerancePct: Math.round(AMOUNT_TOLERANCE * 100),
    lastDate: last.date,
    lastAmountPaise: last.amountPaise,
    nextExpectedDate,
    occurrences: recurring.length,
    status,
  };
}
