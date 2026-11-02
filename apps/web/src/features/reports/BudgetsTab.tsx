import { Plus, Target, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { type BudgetDto, parseRupeesToPaise, toIstDate } from '@kharcha/shared';
import { useBudgets, useCategoryMap, useDeleteBudget, useSaveBudget } from '@/app/queries';
import { Meter, StatusBadge } from '@/components/charts/Figures';
import { CategoryIcon } from '@/components/CategoryIcon';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Switch } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { bucketLabel, formatPct } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';
import { CategoryPicker } from '@/features/categories/CategoryPicker';

const STATE = {
  ok: { severity: 'good', label: 'On track' },
  warning: { severity: 'warning', label: '80% used' },
  over: { severity: 'critical', label: 'Over budget' },
} as const;

/** Monthly budgets per category or group with run-rate projection and 80%/100% alerts. */
export function BudgetsTab() {
  const period = usePeriod();
  const month = period.kind === 'month' ? period.range.from.slice(0, 7) : toIstDate().slice(0, 7);
  const budgets = useBudgets(month, period.accountIds.length ? period.accountIds : undefined);
  const { byId } = useCategoryMap();
  const [editing, setEditing] = useState<BudgetDto | 'new' | null>(null);
  const data = budgets.data;
  const isCurrent = month === toIstDate().slice(0, 7);

  return (
    <div className={cn('flex flex-col gap-3', budgets.isPlaceholderData && 'opacity-60')}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Budgets for <strong className="text-foreground">{bucketLabel(month, true)}</strong>
          {period.kind !== 'month' && ' (switch to Month to see others)'}
        </p>
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden className="size-4" /> Add
        </Button>
      </div>
      {!data ? (
        <Skeleton className="h-48 w-full" />
      ) : data.budgets.length === 0 ? (
        <EmptyState icon={Target} title="No budgets yet">
          Set a monthly limit for a category (e.g. Food delivery) or a whole group (e.g. Lifestyle).
        </EmptyState>
      ) : (
        <>
          <Card className="flex flex-col gap-2 p-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Spent of budgeted</span>
              <span>
                <Money paise={data.totals.spentPaise} className="font-semibold" /> /{' '}
                <Money paise={data.totals.budgetedPaise} />
              </span>
            </div>
          </Card>
          <ul className="flex flex-col gap-2">
            {data.budgets.map((b) => {
              const c = byId.get(b.categoryId);
              return (
                <li key={b.id}>
                  <Card className="p-3">
                    <button
                      type="button"
                      onClick={() => setEditing(b)}
                      className="flex w-full flex-col gap-2 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <CategoryIcon icon={c?.icon} color={c?.color} className="size-8" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {c?.name ?? 'Category'}
                            {c?.parentId === null && ' (group)'}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            <Money paise={b.spentPaise} /> of <Money paise={b.amountPaise} />
                            {b.month ? ' · this month only' : ''}
                          </span>
                        </span>
                        <StatusBadge
                          status={STATE[b.state].severity}
                          label={STATE[b.state].label}
                        />
                      </div>
                      <Meter
                        pct={b.pct}
                        state={b.state}
                        label={`${c?.name ?? 'Budget'} ${formatPct(b.pct)} used`}
                      />
                      <span className="flex justify-between text-xs text-muted-foreground">
                        <span>
                          {b.remainingPaise >= 0 ? (
                            <>
                              <Money paise={b.remainingPaise} /> left
                            </>
                          ) : (
                            <>
                              <Money paise={-b.remainingPaise} /> over
                            </>
                          )}
                        </span>
                        {isCurrent && (
                          <span
                            className={cn(
                              b.projectedState === 'over' && 'font-medium text-delta-bad',
                            )}
                          >
                            Projected <Money paise={b.projectedPaise} />
                          </span>
                        )}
                      </span>
                    </button>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {editing && (
        <BudgetSheet
          key={editing === 'new' ? 'new' : editing.id}
          budget={editing === 'new' ? null : editing}
          month={month}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function BudgetSheet({
  budget,
  month,
  onClose,
}: {
  budget: BudgetDto | null;
  month: string;
  onClose: () => void;
}) {
  const { byId } = useCategoryMap();
  const save = useSaveBudget();
  const remove = useDeleteBudget();
  const [categoryId, setCategoryId] = useState<string | null>(budget?.categoryId ?? null);
  const [amount, setAmount] = useState(budget ? String(budget.amountPaise / 100) : '');
  const [thisMonthOnly, setThisMonthOnly] = useState(budget?.month !== null && budget !== null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = categoryId ? byId.get(categoryId) : undefined;

  const submit = () => {
    const paise = parseRupeesToPaise(amount);
    if (!categoryId) return setError('Choose a category or group');
    if (!paise || paise <= 0) return setError('Enter an amount');
    save.mutate(
      { categoryId, amountPaise: paise, month: thisMonthOnly ? month : null },
      {
        onSuccess: () => {
          toast.success('Budget saved');
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  };

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={budget ? 'Edit budget' : 'New budget'}
      footer={
        <div className="flex gap-2">
          {budget && (
            <Button
              variant="outline"
              aria-label="Delete budget"
              onClick={() =>
                remove.mutate(budget.id, {
                  onSuccess: () => {
                    toast('Budget removed');
                    onClose();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              <Trash2 aria-hidden className="size-4 text-expense" />
            </Button>
          )}
          <Button className="flex-1" disabled={save.isPending} onClick={submit}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Category or group">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex min-h-12 items-center gap-3 rounded-md border border-border px-3 text-left"
          >
            <CategoryIcon icon={c?.icon ?? 'circle-help'} color={c?.color} className="size-8" />
            <span className={cn('truncate text-sm', !c && 'text-muted-foreground')}>
              {c ? `${c.name}${c.parentId === null ? ' (whole group)' : ''}` : 'Choose'}
            </span>
          </button>
        </Field>
        <Field label="Monthly limit (₹)" htmlFor="budget-amount">
          <Input
            id="budget-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Switch
          label={`Only for ${bucketLabel(month, true)}`}
          checked={thisMonthOnly}
          onCheckedChange={setThisMonthOnly}
        />
        {error && (
          <p role="alert" className="text-sm text-expense">
            {error}
          </p>
        )}
      </div>
      <CategoryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        allowGroups
        selectedId={categoryId}
        title="Budget for"
        onSelect={(cat) => setCategoryId(cat.id)}
      />
    </Sheet>
  );
}
