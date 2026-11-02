import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import {
  addDays,
  addMonths,
  type DateRange,
  diffDays,
  fyLabel,
  fyStartYear,
  isIsoDate,
  periodRange,
  previousPeriodRange,
  toIstDate,
  type YearMode,
} from '@kharcha/shared';
import { useSettings } from '@/app/queries';

export type PeriodKind = 'week' | 'month' | 'year' | 'custom';
export const PERIOD_KINDS: PeriodKind[] = ['week', 'month', 'year', 'custom'];

const short = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortYear = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthYear = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

export function periodLabel(kind: PeriodKind, range: DateRange, yearMode: YearMode): string {
  switch (kind) {
    case 'month':
      return monthYear.format(asDate(range.from));
    case 'year':
      return yearMode === 'fy' ? fyLabel(fyStartYear(range.from)) : range.from.slice(0, 4);
    default: {
      const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
      return `${(sameYear ? short : shortYear).format(asDate(range.from))} – ${shortYear.format(asDate(range.to))}`;
    }
  }
}

export interface Period {
  kind: PeriodKind;
  range: DateRange;
  /** The comparison period: the previous week/month/year, or the same-length span before a custom range. */
  compare: DateRange;
  label: string;
  yearMode: YearMode;
  accountIds: string[];
  /** Query params for report endpoints. */
  params: Record<string, string | string[] | undefined>;
}

/** Shift a period anchor by n periods. */
function shiftAnchor(kind: PeriodKind, anchor: string, n: number): string {
  if (kind === 'week') return addDays(anchor, 7 * n);
  if (kind === 'month') return addMonths(anchor, n);
  return addMonths(anchor, 12 * n);
}

/** Pure resolution of URL params into a period (exported for tests). */
export function resolvePeriod(
  sp: URLSearchParams,
  yearMode: YearMode,
  today = toIstDate(),
): Period {
  const rawKind = sp.get('period');
  const kind: PeriodKind = PERIOD_KINDS.includes(rawKind as PeriodKind)
    ? (rawKind as PeriodKind)
    : 'month';
  const anchor = isIsoDate(sp.get('date') ?? '') ? (sp.get('date') as string) : today;
  let range: DateRange;
  let compare: DateRange;
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const validCustom = kind === 'custom' && isIsoDate(from) && isIsoDate(to) && from <= to;
  if (validCustom) {
    range = { from, to };
    const len = diffDays(from, to) + 1;
    compare = { from: addDays(from, -len), to: addDays(from, -1) };
  } else {
    const k = kind === 'custom' ? 'month' : kind;
    range = periodRange(k, anchor, yearMode);
    compare = previousPeriodRange(k, range, yearMode);
  }
  const accountIds = (sp.get('acc') ?? '').split(',').filter(Boolean);
  return {
    kind,
    range,
    compare,
    label: periodLabel(kind === 'custom' && !validCustom ? 'month' : kind, range, yearMode),
    yearMode,
    accountIds,
    params: {
      from: range.from,
      to: range.to,
      compareFrom: compare.from,
      compareTo: compare.to,
      accountIds: accountIds.length ? accountIds : undefined,
    },
  };
}

/** Period state shared by Home and Reports, kept in the URL (?period=&date=&from=&to=&acc=). */
export function usePeriod() {
  const [sp, setSp] = useSearchParams();
  const settings = useSettings();
  const yearMode = settings.data?.yearMode ?? 'calendar';
  const period = useMemo(() => resolvePeriod(sp, yearMode), [sp, yearMode]);

  const update = useCallback(
    (patch: Record<string, string | null>) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === '') next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setSp],
  );

  const setKind = useCallback(
    (kind: PeriodKind) =>
      kind === 'custom'
        ? update({ period: 'custom', from: period.range.from, to: period.range.to })
        : update({ period: kind, from: null, to: null }),
    [update, period.range],
  );
  const shift = useCallback(
    (n: number) => {
      if (period.kind === 'custom') {
        const len = diffDays(period.range.from, period.range.to) + 1;
        update({
          from: addDays(period.range.from, len * n),
          to: addDays(period.range.to, len * n),
        });
      } else {
        update({ date: shiftAnchor(period.kind, period.range.from, n) });
      }
    },
    [update, period],
  );
  const setCustom = useCallback(
    (from: string, to: string) => update({ period: 'custom', from, to }),
    [update],
  );
  const setAccounts = useCallback(
    (ids: string[]) => update({ acc: ids.length ? ids.join(',') : null }),
    [update],
  );
  const isCurrent = period.range.from <= toIstDate() && toIstDate() <= period.range.to;

  return { ...period, setKind, shift, setCustom, setAccounts, isCurrent };
}
