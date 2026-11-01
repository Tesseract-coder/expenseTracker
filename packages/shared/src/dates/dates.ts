/**
 * Business dates are 'YYYY-MM-DD' strings in Asia/Kolkata. IST is a fixed UTC+05:30 with
 * no DST, so we use fixed-offset arithmetic instead of a timezone database.
 * Internally, a date string is represented as a UTC-midnight Date for arithmetic only.
 */

export type IsoDate = string; // YYYY-MM-DD

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

function parse(s: IsoDate): Date {
  if (!isIsoDate(s)) throw new RangeError(`invalid ISO date: ${s}`);
  return new Date(`${s}T00:00:00Z`);
}

function fmt(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** The IST calendar date for an instant (defaults to now). */
export function toIstDate(instant: Date | number = Date.now()): IsoDate {
  const ms = typeof instant === 'number' ? instant : instant.getTime();
  return fmt(new Date(ms + IST_OFFSET_MS));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fmt(new Date(parse(date).getTime() + days * DAY_MS));
}

/** Whole days from a to b (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY_MS);
}

/** ISO day of week: 1 = Monday … 7 = Sunday. */
export function isoDayOfWeek(date: IsoDate): number {
  const d = parse(date).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Monday of the week containing `date`. Weeks start Monday. */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoDayOfWeek(date));
}

/** 1-based week-of-month bucket: days 1–7 → 1, 8–14 → 2, … 29–31 → 5. */
export function weekOfMonth(date: IsoDate): number {
  return Math.ceil(Number(date.slice(8, 10)) / 7);
}

export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Indian financial year start year: 2026-03-31 → 2025 (FY 2025-26); 2026-04-01 → 2026. */
export function fyStartYear(date: IsoDate): number {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? y : y - 1;
}

/** "FY 2025-26" */
export function fyLabel(startYear: number): string {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export interface DateRange {
  from: IsoDate; // inclusive
  to: IsoDate; // inclusive
}

export type PeriodKind = 'week' | 'month' | 'year';
export type YearMode = 'calendar' | 'fy';

/** Range for the period containing `date`. */
export function periodRange(
  kind: PeriodKind,
  date: IsoDate,
  yearMode: YearMode = 'calendar',
): DateRange {
  parse(date);
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  switch (kind) {
    case 'week': {
      const from = weekStart(date);
      return { from, to: addDays(from, 6) };
    }
    case 'month': {
      const mm = String(m).padStart(2, '0');
      return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${lastDayOfMonth(y, m)}` };
    }
    case 'year': {
      if (yearMode === 'fy') {
        const s = fyStartYear(date);
        return { from: `${s}-04-01`, to: `${s + 1}-03-31` };
      }
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
  }
}

/** The same-length period immediately before `range` for a given period kind. */
export function previousPeriodRange(
  kind: PeriodKind,
  range: DateRange,
  yearMode: YearMode = 'calendar',
): DateRange {
  return periodRange(kind, addDays(range.from, -1), yearMode);
}
