import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatINR } from '@kharcha/shared';
import { useCategoryMap, useWhere } from '@/app/queries';
import { ChartCard } from '@/components/charts/ChartCard';
import { RankedBars } from '@/components/charts/RankedBars';
import { Money } from '@/components/Money';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDayHeader, formatPct } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';
import { VS_LABEL } from '@/features/home/Dashboard';

/** "Where did I spend more?" — top categories, payees and transactions, and what changed. */
export function WhereTab() {
  const period = usePeriod();
  const { byId } = useCategoryMap();
  const where = useWhere(period.params);
  const w = where.data;
  if (!w) return <Skeleton className="h-64 w-full" />;
  const vs = VS_LABEL[period.kind];
  const txnLink = (categoryIds: string) =>
    `/transactions?${new URLSearchParams({ categoryIds, from: period.range.from, to: period.range.to })}`;

  return (
    <div className={cn('flex flex-col gap-3', where.isPlaceholderData && 'opacity-60')}>
      {w.changes.length > 0 && (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold">What changed vs {vs}</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {w.changes.slice(0, 5).map((c) => {
              const name = byId.get(c.categoryId)?.name ?? 'A category';
              const up = c.delta > 0;
              const Icon = up ? TrendingUp : TrendingDown;
              return (
                <li key={c.categoryId} className="flex items-start gap-2">
                  <Icon
                    aria-hidden
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      up ? 'text-delta-bad' : 'text-delta-good',
                    )}
                  />
                  <span data-money>
                    <strong className="font-medium">{name}</strong> {up ? 'up' : 'down'}
                    {c.pct !== null ? ` ${formatPct(Math.abs(c.pct))}` : ''} vs {vs},{' '}
                    {formatINR(Math.abs(c.delta), { compactZeroPaise: true })}{' '}
                    {up ? 'more' : 'less'}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ChartCard
        title="Top categories"
        table={{
          columns: ['Category', 'Spend', 'Transactions'],
          rows: w.topCategories.map((c) => [
            byId.get(c.categoryId)?.name ?? '—',
            <Money key="m" paise={c.spend} />,
            c.count,
          ]),
        }}
      >
        {w.topCategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No spending in this period.</p>
        ) : (
          <RankedBars
            items={w.topCategories.map((c) => ({
              key: c.categoryId,
              label: byId.get(c.categoryId)?.name ?? 'Category',
              value: c.spend,
              detail: `${c.count} transaction${c.count === 1 ? '' : 's'}`,
              href: txnLink(c.categoryId),
            }))}
          />
        )}
      </ChartCard>

      <ChartCard
        title="Top payees"
        table={{
          columns: ['Payee', 'Spend', 'Transactions'],
          rows: w.topCounterparties.map((c) => [
            c.name,
            <Money key="m" paise={c.spend} />,
            c.count,
          ]),
        }}
      >
        {w.topCounterparties.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payees in this period.</p>
        ) : (
          <RankedBars
            items={w.topCounterparties.map((c) => ({
              key: c.id,
              label: c.name,
              value: c.spend,
              detail: `${c.count} transaction${c.count === 1 ? '' : 's'}`,
            }))}
          />
        )}
      </ChartCard>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-sm font-semibold">Biggest single spends</h2>
        <ol className="flex flex-col divide-y divide-border">
          {w.topTransactions.map((t) => (
            <li key={t.id} className="flex min-h-12 items-center gap-2 py-1.5 text-sm">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{t.title}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDayHeader(t.txnDate)} · {byId.get(t.categoryId ?? '')?.name ?? 'Split'}
                </span>
              </span>
              <Money paise={t.amountPaise} className="font-medium" />
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
