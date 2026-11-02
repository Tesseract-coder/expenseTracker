import { useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  foldOther,
  pctChange,
  rollingAverage,
  weekStart,
} from '@kharcha/shared';
import { useCategoryMap, useTrends } from '@/app/queries';
import { ChartCard } from '@/components/charts/ChartCard';
import { ColumnChart, type SeriesDef } from '@/components/charts/TimeCharts';
import { OTHER_COLOR, SERIES } from '@/components/charts/tokens';
import { Money } from '@/components/Money';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { bucketLabel, formatPct } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';

type Granularity = 'week' | 'month' | 'year';

const FLOW: SeriesDef[] = [
  { key: 'income', label: 'Income', color: SERIES[0] },
  { key: 'spend', label: 'Spend', color: SERIES[1] },
  { key: 'invested', label: 'Invested', color: SERIES[2] },
];

function rangeFor(g: Granularity, end: string, yearMode: 'calendar' | 'fy') {
  if (g === 'week') return { from: addDays(weekStart(end), -7 * 11), to: end };
  // Monthly fetches 24 months: the charts show 12, the table needs a year back for YoY and 12-mo averages.
  if (g === 'month')
    return { from: `${addMonths(`${end.slice(0, 7)}-01`, -23).slice(0, 7)}-01`, to: end };
  const y = Number(end.slice(0, 4));
  return yearMode === 'fy'
    ? { from: `${y - 5}-04-01`, to: end }
    : { from: `${y - 4}-01-01`, to: end };
}

export function TrendsTab() {
  const period = usePeriod();
  const { byId } = useCategoryMap();
  const [g, setG] = useState<Granularity>('month');
  const range = rangeFor(g, period.range.to, period.yearMode);
  const trends = useTrends({
    granularity: g,
    ...range,
    yearMode: period.yearMode,
    accountIds: period.accountIds.length ? period.accountIds : undefined,
  });
  const data = trends.data;
  const shown = useMemo(
    () => (data ? (g === 'month' ? data.buckets.slice(-12) : data.buckets) : []),
    [data, g],
  );
  const label = (b: string) => bucketLabel(b);

  // Category trend: top 5 categories over the shown buckets + Other (6 slots, fixed order by total).
  const stacked = useMemo(() => {
    if (!data) return null;
    const buckets = new Set(shown.map((b) => b.bucket));
    const totals = new Map<string, number>();
    for (const c of data.categories)
      if (buckets.has(c.bucket))
        totals.set(c.categoryId, (totals.get(c.categoryId) ?? 0) + c.spend);
    const ranked = foldOther(
      [...totals].map(([id, value]) => ({ id, value })).sort((a, b) => b.value - a.value),
      5,
      (value) => ({ id: 'other', value }),
    );
    const keep = new Set(ranked.map((r) => r.id));
    const series: SeriesDef[] = ranked.map((r, i) => ({
      key: r.id,
      label: r.id === 'other' ? 'Other' : (byId.get(r.id)?.name ?? 'Category'),
      color: r.id === 'other' ? OTHER_COLOR : (SERIES[i] as string),
    }));
    const rows = shown.map((b) => {
      const row: Record<string, number | string> = { bucket: b.bucket };
      for (const s of series) row[s.key] = 0;
      for (const c of data.categories) {
        if (c.bucket !== b.bucket) continue;
        const key = keep.has(c.categoryId) ? c.categoryId : 'other';
        row[key] = (row[key] as number) + c.spend;
      }
      return row as { bucket: string } & Record<string, number>;
    });
    return { series, rows };
  }, [data, shown, byId]);

  // Month-over-month / year-over-year per category, with rolling averages (monthly view).
  const table = useMemo(() => {
    if (!data || g !== 'month') return null;
    const months = data.buckets.map((b) => b.bucket);
    const last = months.at(-1);
    if (!last) return null;
    const byCat = new Map<string, number[]>();
    for (const c of data.categories) {
      const arr = byCat.get(c.categoryId) ?? months.map(() => 0);
      const i = months.indexOf(c.bucket);
      if (i >= 0) arr[i] = c.spend;
      byCat.set(c.categoryId, arr);
    }
    return [...byCat]
      .map(([id, series]) => {
        const n = series.length;
        const cur = series[n - 1] ?? 0;
        return {
          id,
          name: byId.get(id)?.name ?? 'Category',
          cur,
          mom: pctChange(cur, series[n - 2] ?? 0),
          yoy: n >= 13 ? pctChange(cur, series[n - 13] ?? 0) : null,
          avg3: rollingAverage(series, 3)[n - 1] ?? 0,
          avg12: rollingAverage(series, 12)[n - 1] ?? 0,
        };
      })
      .filter((r) => r.avg12 !== 0 || r.cur !== 0)
      .sort((a, b) => b.avg3 - a.avg3)
      .slice(0, 12);
  }, [data, g, byId]);

  return (
    <div className={cn('flex flex-col gap-3', trends.isPlaceholderData && 'opacity-60')}>
      <div className="flex gap-2" role="radiogroup" aria-label="Granularity">
        {(['week', 'month', 'year'] as const).map((k) => (
          <Chip
            key={k}
            role="radio"
            aria-checked={g === k}
            selected={g === k}
            onClick={() => setG(k)}
          >
            {k === 'week' ? 'Weekly' : k === 'month' ? 'Monthly' : 'Yearly'}
          </Chip>
        ))}
      </div>
      {!data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <ChartCard
            title="Income, spend and investments"
            legend={FLOW.map((s) => ({ label: s.label, color: s.color }))}
            table={{
              columns: ['Period', 'Income', 'Spend', 'Invested'],
              rows: shown.map((b) => [
                bucketLabel(b.bucket, true),
                <Money key="i" paise={b.income} />,
                <Money key="s" paise={b.spend} />,
                <Money key="v" paise={b.invested} />,
              ]),
            }}
          >
            <ColumnChart data={shown} series={FLOW} labelFormatter={label} />
          </ChartCard>

          {stacked && stacked.series.length > 0 && (
            <ChartCard
              title="Spend by category"
              subtitle="Top 5 categories in this view; the rest are grouped as Other."
              legend={stacked.series.map((s) => ({ label: s.label, color: s.color }))}
              table={{
                columns: ['Period', ...stacked.series.map((s) => s.label)],
                rows: stacked.rows.map((r) => [
                  bucketLabel(r.bucket, true),
                  ...stacked.series.map((s) => <Money key={s.key} paise={r[s.key] ?? 0} />),
                ]),
              }}
            >
              <ColumnChart
                data={stacked.rows}
                series={stacked.series}
                stacked
                labelFormatter={label}
              />
            </ChartCard>
          )}

          {table && table.length > 0 && (
            <ChartCard
              title={`Categories — ${bucketLabel(data.buckets.at(-1)?.bucket ?? '', true)}`}
              subtitle="Change vs last month and the same month last year, with 3- and 12-month averages."
            >
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full min-w-[30rem] text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-1.5 pr-2 font-medium">
                        Category
                      </th>
                      <th scope="col" className="py-1.5 pr-2 text-right font-medium">
                        This month
                      </th>
                      <th scope="col" className="py-1.5 pr-2 text-right font-medium">
                        MoM
                      </th>
                      <th scope="col" className="py-1.5 pr-2 text-right font-medium">
                        YoY
                      </th>
                      <th scope="col" className="py-1.5 pr-2 text-right font-medium">
                        3-mo avg
                      </th>
                      <th scope="col" className="py-1.5 text-right font-medium">
                        12-mo avg
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular-nums">
                    {table.map((r) => (
                      <tr key={r.id}>
                        <td className="max-w-32 truncate py-1.5 pr-2">{r.name}</td>
                        <td className="py-1.5 pr-2 text-right">
                          <Money paise={r.cur} />
                        </td>
                        <td
                          className={cn(
                            'py-1.5 pr-2 text-right',
                            r.mom !== null && (r.mom > 0 ? 'text-delta-bad' : 'text-delta-good'),
                          )}
                        >
                          {r.mom === null
                            ? '—'
                            : `${r.mom > 0 ? '▲' : '▼'} ${formatPct(Math.abs(r.mom))}`}
                        </td>
                        <td
                          className={cn(
                            'py-1.5 pr-2 text-right',
                            r.yoy !== null && (r.yoy > 0 ? 'text-delta-bad' : 'text-delta-good'),
                          )}
                        >
                          {r.yoy === null
                            ? '—'
                            : `${r.yoy > 0 ? '▲' : '▼'} ${formatPct(Math.abs(r.yoy))}`}
                        </td>
                        <td className="py-1.5 pr-2 text-right">
                          <Money paise={r.avg3} />
                        </td>
                        <td className="py-1.5 text-right">
                          <Money paise={r.avg12} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          )}
        </>
      )}
    </div>
  );
}
