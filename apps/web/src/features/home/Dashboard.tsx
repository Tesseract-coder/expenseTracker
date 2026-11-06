import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { CategoryDto } from '@kharcha/shared';
import { useCategories, useSummary } from '@/app/queries';
import { ChartCard } from '@/components/charts/ChartCard';
import { Delta, SegmentedBar, StatTile } from '@/components/charts/Figures';
import { OTHER_COLOR, SERIES } from '@/components/charts/tokens';
import { Money } from '@/components/Money';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { WhenVisible } from '@/components/WhenVisible';
import { bucketLabel, formatPct } from '@/lib/format';
import { type PeriodKind, usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';
import { PeriodBar } from '@/features/reports/PeriodBar';

const TrendArea = lazy(() =>
  import('@/components/charts/TimeCharts').then((m) => ({ default: m.TrendArea })),
);

export const VS_LABEL: Record<PeriodKind, string> = {
  week: 'last week',
  month: 'last month',
  year: 'last year',
  custom: 'previous period',
};

/**
 * Stable color per spending group: groups in their sort order take categorical slots 1–6, so a
 * group keeps its color whatever the period or filter (color follows the entity, not its rank).
 */
export function useGroupColors() {
  const categories = useCategories();
  return useMemo(() => {
    const groups = (categories.data ?? [])
      .filter(
        (c) => c.parentId === null && (c.type === 'expense_need' || c.type === 'expense_want'),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const colors = new Map<string, string>();
    groups.forEach((g, i) => colors.set(g.id, SERIES[i] ?? OTHER_COLOR));
    const byId = new Map((categories.data ?? []).map((c) => [c.id, c] as const));
    return { colors, byId };
  }, [categories.data]);
}

export function Dashboard() {
  const period = usePeriod();
  const summary = useSummary(period.params);
  const { colors, byId } = useGroupColors();
  const [open, setOpen] = useState<string | null>(null);
  const vs = VS_LABEL[period.kind];
  const s = summary.data;
  const t = s?.totals;
  const p = s?.previous ?? null;

  const linkFor = (categoryIds: string) => {
    const q = new URLSearchParams({ categoryIds, from: period.range.from, to: period.range.to });
    if (period.accountIds.length) q.set('accountIds', period.accountIds.join(','));
    return `/transactions?${q}`;
  };

  return (
    <section
      aria-label="Dashboard"
      className={cn('flex flex-col gap-3', summary.isPlaceholderData && 'opacity-60')}
    >
      <PeriodBar />

      {!t ? (
        <DashboardSkeleton />
      ) : (
        <>
          <Card className="flex flex-col gap-1 p-4">
            <span className="text-sm text-muted-foreground">Spent</span>
            <Money paise={t.spend} className="text-5xl font-semibold proportional-nums" />
            <Delta current={t.spend} previous={p?.spend} upIsGood={false} vs={vs} />
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Income"
              paise={t.income}
              delta={<Delta current={t.income} previous={p?.income} upIsGood vs={vs} />}
            />
            <StatTile
              label="Invested"
              paise={t.invested}
              delta={<Delta current={t.invested} previous={p?.invested} upIsGood vs={vs} />}
            />
            <StatTile
              label="Net savings"
              paise={t.netSavings}
              delta={<Delta current={t.netSavings} previous={p?.netSavings} upIsGood vs={vs} />}
            />
            <StatTile
              label="Savings rate"
              text={formatPct(t.savingsRate, 1)}
              delta={
                <Delta current={t.savingsRate} previous={p?.savingsRate} upIsGood vs={vs} points />
              }
            />
          </div>

          {t.uncategorizedIncome > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                <Money paise={t.uncategorizedIncome} /> of money received is uncategorized and not
                counted as income.{' '}
                <Link to="/inbox" className="font-medium text-primary underline">
                  Label it
                </Link>
              </span>
            </p>
          )}

          <ChartCard
            title={WHERE_TITLE}
            subtitle={WHERE_SUBTITLE}
            table={{
              columns: ['Group', 'Spend', 'Share'],
              rows: s.byGroup.map((g) => [
                byId.get(g.groupId)?.name ?? 'Other',
                <Money key="m" paise={g.spend} />,
                t.spend > 0 ? formatPct(g.spend / t.spend) : '—',
              ]),
            }}
          >
            {s.byGroup.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No spending in this period.
              </p>
            ) : (
              <>
                <SegmentedBar
                  label="Spend by group"
                  parts={s.byGroup.map((g) => ({
                    key: g.groupId,
                    label: byId.get(g.groupId)?.name ?? 'Other',
                    value: g.spend,
                    color: colors.get(g.groupId) ?? OTHER_COLOR,
                  }))}
                />
                <ul className="divide-y divide-border">
                  {s.byGroup.map((g) => (
                    <GroupRow
                      key={g.groupId}
                      group={byId.get(g.groupId)}
                      color={colors.get(g.groupId) ?? OTHER_COLOR}
                      spend={g.spend}
                      share={t.spend > 0 ? g.spend / t.spend : 0}
                      open={open === g.groupId}
                      onToggle={() => setOpen(open === g.groupId ? null : g.groupId)}
                      categories={s.byCategory
                        .filter((c) => c.groupId === g.groupId && c.spend !== 0)
                        .map((c) => ({ ...c, category: byId.get(c.categoryId) }))}
                      linkFor={linkFor}
                    />
                  ))}
                </ul>
              </>
            )}
          </ChartCard>

          <ChartCard
            title={`Spending per ${s.trend.granularity}`}
            table={{
              columns: [
                s.trend.granularity === 'day'
                  ? 'Day'
                  : s.trend.granularity === 'week'
                    ? 'Week of'
                    : 'Month',
                'Spend',
              ],
              rows: s.trend.points.map((pt) => [
                bucketLabel(pt.bucket, true),
                <Money key="m" paise={pt.spend} />,
              ]),
            }}
          >
            <WhenVisible placeholder={<Skeleton className="h-40 w-full" />}>
              <Suspense fallback={<Skeleton className="h-40 w-full" />}>
                <TrendArea
                  data={s.trend.points}
                  series={{ key: 'spend', label: 'Spend', color: SERIES[0] }}
                  labelFormatter={(b) => bucketLabel(b, s.trend.granularity === 'month')}
                  height={160}
                />
              </Suspense>
            </WhenVisible>
          </ChartCard>
        </>
      )}
    </section>
  );
}

const WHERE_TITLE = 'Where it went';
const WHERE_SUBTITLE = 'Spend by group, net of refunds. Tap a group for its categories.';

/** Same shape and height as the loaded dashboard, so nothing below it jumps (CLS). */
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading dashboard">
      <Skeleton className="h-[126px] w-full" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[94px] w-full" />
        ))}
      </div>
      {/* The card's own heading renders right away; only its numbers wait for data. */}
      <ChartCard title={WHERE_TITLE} subtitle={WHERE_SUBTITLE}>
        <Skeleton className="h-[150px] w-full" />
      </ChartCard>
      <Skeleton className="h-[250px] w-full" />
    </div>
  );
}

function GroupRow({
  group,
  color,
  spend,
  share,
  open,
  onToggle,
  categories,
  linkFor,
}: {
  group: CategoryDto | undefined;
  color: string;
  spend: number;
  share: number;
  open: boolean;
  onToggle: () => void;
  categories: {
    categoryId: string;
    spend: number;
    previous: number;
    category: CategoryDto | undefined;
  }[];
  linkFor: (ids: string) => string;
}) {
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-12 w-full items-center gap-2 text-left text-sm"
      >
        <span
          aria-hidden
          className="size-3 shrink-0 rounded-sm"
          style={{ backgroundColor: color }}
        />
        <span className="min-w-0 flex-1 truncate">{group?.name ?? 'Other'}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{formatPct(share)}</span>
        <Money paise={spend} className="w-24 text-right font-medium" />
        {open ? (
          <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <ul className="mb-2 ml-5 flex flex-col">
          {categories.map((c) => (
            <li key={c.categoryId}>
              <Link
                to={linkFor(c.categoryId)}
                className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate">{c.category?.name ?? 'Category'}</span>
                <Money paise={c.spend} className="text-right" />
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
          {group && (
            <li>
              <Link
                to={linkFor(group.id)}
                className="flex min-h-11 items-center px-2 text-xs font-medium text-primary"
              >
                All {group.name} transactions →
              </Link>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
