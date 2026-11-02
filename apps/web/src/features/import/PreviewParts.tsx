import type { PreviewRow } from '@kharcha/shared';
import { useCategoryMap } from '@/app/queries';
import { Money } from '@/components/Money';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Building blocks of the import preview, shared by statement files and pasted SMS alerts. */
export const KIND_LABEL = {
  self_transfer: 'Transfer between your accounts',
  cc_bill_payment: 'Credit card bill payment',
  atm_cash: 'Cash withdrawal → Cash account',
};

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string | undefined;
}) {
  return (
    <Card className="p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-semibold tabular-nums', tone)}>{value}</p>
    </Card>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <Card className="divide-y divide-border p-1">{children}</Card>
    </section>
  );
}

export function PreviewLine({ row }: { row: PreviewRow }) {
  const { byId } = useCategoryMap();
  const category = row.proposal ? byId.get(row.proposal.categoryId) : undefined;
  return (
    <div className="flex items-center gap-2 px-2 py-2 text-sm">
      <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
        {row.txnDate}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{row.payee ?? row.narration}</span>
        {row.status !== 'duplicate' && (
          <span
            className={cn(
              'truncate text-xs',
              category ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400',
            )}
          >
            {category ? category.name : 'Uncategorized'}
          </span>
        )}
      </span>
      <Money
        paise={row.amountPaise}
        direction={row.direction}
        className="shrink-0 text-xs font-medium"
      />
    </div>
  );
}

export function CheckRow({
  row,
  checked,
  onToggle,
  label,
  detail,
}: {
  row: PreviewRow;
  checked: boolean;
  onToggle: () => void;
  label: string;
  detail: React.ReactNode;
}) {
  return (
    <label className="flex min-h-14 cursor-pointer items-start gap-3 px-2 py-2">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={onToggle}
        className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <span className="flex justify-between gap-2">
          <span className="truncate">
            {row.txnDate} · {row.narration}
          </span>
          <Money
            paise={row.amountPaise}
            direction={row.direction}
            className="shrink-0 text-xs font-medium"
          />
        </span>
        <span className="text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
