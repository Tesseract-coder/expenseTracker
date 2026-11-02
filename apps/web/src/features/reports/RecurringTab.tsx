import { Eye, EyeOff, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import type { RecurringDto } from '@kharcha/shared';
import { useCategoryMap, useDismissRecurring, useRecurring } from '@/app/queries';
import { StatusBadge, type Severity } from '@/components/charts/Figures';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { formatDayHeader } from '@/lib/format';
import { cn } from '@/lib/utils';

const CADENCE: Record<RecurringDto['cadence'], string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};
const STATUS: Record<RecurringDto['status'], { severity: Severity; label: string }> = {
  active: { severity: 'good', label: 'Active' },
  new: { severity: 'warning', label: 'New' },
  price_changed: { severity: 'serious', label: 'Price changed' },
  stopped: { severity: 'na', label: 'Stopped?' },
};

/** Subscriptions, rent, SIPs and EMIs detected from regular payments to the same payee. */
export function RecurringTab() {
  const recurring = useRecurring();
  const dismiss = useDismissRecurring();
  const { byId } = useCategoryMap();
  if (recurring.isPending) return <Skeleton className="h-48 w-full" />;
  const data = recurring.data;
  const all = data?.series ?? [];
  if (all.length === 0) {
    return (
      <EmptyState icon={Repeat} title="No recurring payments found yet">
        Kharcha spots subscriptions, rent, SIPs and EMIs once a payee has been paid regularly (3
        months for monthly payments).
      </EmptyState>
    );
  }
  const visible = all.filter((s) => !s.dismissed);
  const hidden = all.filter((s) => s.dismissed);

  const row = (s: RecurringDto) => (
    <li key={s.id} className={cn('flex flex-col gap-1 py-3', s.dismissed && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{s.counterparty.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {CADENCE[s.cadence]} · {byId.get(s.categoryId ?? '')?.name ?? 'Uncategorized'} ·{' '}
            {s.occurrences} payments
          </p>
        </div>
        <div className="flex flex-col items-end">
          <Money
            paise={s.lastAmountPaise ?? s.typicalAmountPaise}
            className="text-sm font-semibold"
          />
          {s.status === 'price_changed' && (
            <span className="text-xs text-muted-foreground">
              was <Money paise={s.typicalAmountPaise} />
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={STATUS[s.status].severity} label={STATUS[s.status].label} />
        <span className="text-xs text-muted-foreground">
          {s.status === 'stopped'
            ? `Last ${formatDayHeader(s.lastDate)}`
            : s.nextExpectedDate
              ? `Next ~${formatDayHeader(s.nextExpectedDate)}`
              : ''}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            s.dismissed ? `Show ${s.counterparty.name} again` : `Hide ${s.counterparty.name}`
          }
          onClick={() =>
            dismiss.mutate(
              { id: s.id, dismissed: !s.dismissed },
              { onError: (e) => toast.error(errorMessage(e)) },
            )
          }
        >
          {s.dismissed ? (
            <Eye aria-hidden className="size-4" />
          ) : (
            <EyeOff aria-hidden className="size-4" />
          )}
        </Button>
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex items-baseline justify-between gap-2 p-4">
        <span className="text-sm text-muted-foreground">Recurring per month</span>
        <Money
          paise={data?.monthlyTotalPaise ?? 0}
          className="text-xl font-semibold proportional-nums"
        />
      </Card>
      <Card className="px-4">
        <ul className="divide-y divide-border">{visible.map(row)}</ul>
      </Card>
      {hidden.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted-foreground">
            Hidden ({hidden.length})
          </summary>
          <Card className="px-4">
            <ul className="divide-y divide-border">{hidden.map(row)}</ul>
          </Card>
        </details>
      )}
    </div>
  );
}
