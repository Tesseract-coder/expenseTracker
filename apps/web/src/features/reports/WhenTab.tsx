import { useWhen } from '@/app/queries';
import { ChartCard } from '@/components/charts/ChartCard';
import { CalendarHeatmap } from '@/components/charts/Heatmap';
import { ColumnChart } from '@/components/charts/TimeCharts';
import { SERIES } from '@/components/charts/tokens';
import { Money } from '@/components/Money';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { bucketLabel, formatDayHeader } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK = ['1–7', '8–14', '15–21', '22–28', '29–31'];
const ONE = (label: string) => [{ key: 'v', label, color: SERIES[0] }];

/** "When did I spend more?" — heatmap, weekday and week-of-month patterns, biggest days. */
export function WhenTab() {
  const period = usePeriod();
  const when = useWhen({
    from: period.range.from,
    to: period.range.to,
    accountIds: period.accountIds.length ? period.accountIds : undefined,
  });
  const w = when.data;
  if (!w) return <Skeleton className="h-64 w-full" />;

  const dow = w.byDow.map((d) => ({ bucket: DOW[d.dow - 1] as string, v: d.average }));
  const wom = w.byWeekOfMonth.map((d) => ({ bucket: WEEK[d.week - 1] as string, v: d.spend }));

  return (
    <div className={cn('flex flex-col gap-3', when.isPlaceholderData && 'opacity-60')}>
      <ChartCard
        title="Daily spend"
        subtitle="Darker means more spent that day."
        table={{
          columns: ['Day', 'Spend'],
          rows: w.daily.map((d) => [formatDayHeader(d.date), <Money key="m" paise={d.spend} />]),
        }}
      >
        <CalendarHeatmap from={period.range.from} to={period.range.to} daily={w.daily} />
      </ChartCard>

      <ChartCard
        title="Average spend by day of week"
        table={{
          columns: ['Day', 'Average', 'Total'],
          rows: w.byDow.map((d) => [
            DOW[d.dow - 1],
            <Money key="a" paise={d.average} />,
            <Money key="t" paise={d.spend} />,
          ]),
        }}
      >
        <ColumnChart
          data={dow}
          series={ONE('Average spend')}
          height={180}
          labelFormatter={(b) => b}
        />
      </ChartCard>

      <ChartCard
        title="Spend by week of month"
        subtitle="Spikes after salary day show up in the first weeks."
        table={{
          columns: ['Days', 'Spend'],
          rows: w.byWeekOfMonth.map((d) => [WEEK[d.week - 1], <Money key="m" paise={d.spend} />]),
        }}
      >
        <ColumnChart data={wom} series={ONE('Spend')} height={180} labelFormatter={(b) => b} />
      </ChartCard>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Highest-spend days</h2>
        {w.topDays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No spending in this period.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {w.topDays.map((d) => (
              <li key={d.date} className="py-2">
                <div className="flex items-baseline justify-between gap-2 text-sm font-medium">
                  <span>{formatDayHeader(d.date)}</span>
                  <Money paise={d.spend} />
                </div>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {d.top.map((t) => (
                    <li key={t.id} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">{t.title}</span>
                      <Money paise={t.amountPaise} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        {(w.topWeeks.length > 1 || w.topMonths.length > 1) && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Top weeks</h3>
              <ol className="flex flex-col gap-1">
                {w.topWeeks.map((x) => (
                  <li key={x.weekStart} className="flex justify-between gap-2">
                    <span className="truncate">w/c {bucketLabel(x.weekStart)}</span>
                    <Money paise={x.spend} />
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">Top months</h3>
              <ol className="flex flex-col gap-1">
                {w.topMonths.map((x) => (
                  <li key={x.month} className="flex justify-between gap-2">
                    <span className="truncate">{bucketLabel(x.month, true)}</span>
                    <Money paise={x.spend} />
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
