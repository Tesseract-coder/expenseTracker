import { ChevronLeft, ChevronRight, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useAccounts } from '@/app/queries';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Field, Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { type PeriodKind, usePeriod } from '@/lib/period';

const KIND_LABEL: Record<PeriodKind, string> = {
  week: 'Week',
  month: 'Month',
  year: 'Year',
  custom: 'Custom',
};

/** One filter row above everything it scopes: period kind, prev/next, custom range, accounts. */
export function PeriodBar({ showAccounts = true }: { showAccounts?: boolean }) {
  const period = usePeriod();
  const accounts = useAccounts();
  const [customOpen, setCustomOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [from, setFrom] = useState(period.range.from);
  const [to, setTo] = useState(period.range.to);

  return (
    <div className="flex flex-col gap-2" data-print-hide>
      <div
        role="radiogroup"
        aria-label="Period"
        className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1"
      >
        {(Object.keys(KIND_LABEL) as PeriodKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={period.kind === k}
            onClick={() => {
              if (k === 'custom') {
                setFrom(period.range.from);
                setTo(period.range.to);
                setCustomOpen(true);
              } else period.setKind(k);
            }}
            className={cn(
              'min-h-11 rounded-md text-sm font-medium',
              period.kind === k ? 'bg-card shadow' : 'text-muted-foreground',
            )}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous period"
          onClick={() => period.shift(-1)}
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-semibold" aria-live="polite">
          {period.label}
        </p>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next period"
          disabled={period.isCurrent}
          onClick={() => period.shift(1)}
        >
          <ChevronRight aria-hidden className="size-5" />
        </Button>
        {showAccounts && (
          <Chip
            selected={period.accountIds.length > 0}
            onClick={() => setAccountsOpen(true)}
            aria-label={`${period.accountIds.length || 'All'} accounts, filter`}
          >
            <Wallet aria-hidden className="size-4" />
            {period.accountIds.length || 'All'}
          </Chip>
        )}
      </div>

      <Sheet
        open={customOpen}
        onOpenChange={setCustomOpen}
        title="Custom range"
        footer={
          <Button
            className="w-full"
            disabled={!from || !to || from > to}
            onClick={() => {
              period.setCustom(from, to);
              setCustomOpen(false);
            }}
          >
            Show
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="range-from">
            <Input
              id="range-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To" htmlFor="range-to">
            <Input id="range-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Sheet>

      <Sheet
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        title="Accounts"
        footer={
          <Button className="w-full" onClick={() => setAccountsOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Chip selected={period.accountIds.length === 0} onClick={() => period.setAccounts([])}>
            All accounts
          </Chip>
          {(accounts.data ?? []).map((a) => {
            const on = period.accountIds.includes(a.id);
            return (
              <Chip
                key={a.id}
                selected={on}
                onClick={() =>
                  period.setAccounts(
                    on ? period.accountIds.filter((x) => x !== a.id) : [...period.accountIds, a.id],
                  )
                }
              >
                {a.name}
              </Chip>
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}
