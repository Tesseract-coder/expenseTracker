import { Check, Tags } from 'lucide-react';
import type { AccountDto, CategoryDto, TransactionDto } from '@kharcha/shared';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Money } from '@/components/Money';
import { cn } from '@/lib/utils';
import { useRowGestures } from './useRowGestures';

export function transactionTitle(t: TransactionDto, category: CategoryDto | undefined): string {
  return (
    t.counterparty?.name ??
    t.note ??
    t.rawNarration ??
    (t.isSplit ? 'Split transaction' : (category?.name ?? 'Transaction'))
  );
}

export function TransactionRow({
  txn,
  categoriesById,
  accountsById,
  onOpen,
  onSwipe,
  onLongPress,
  selectionMode = false,
  selected = false,
}: {
  txn: TransactionDto;
  categoriesById: Map<string, CategoryDto>;
  accountsById: Map<string, AccountDto>;
  /** Tap: open (or toggle selection in selection mode). */
  onOpen: (t: TransactionDto) => void;
  /** Swipe left: recategorize. */
  onSwipe?: (t: TransactionDto) => void;
  /** Long-press: start multi-select. */
  onLongPress?: (t: TransactionDto) => void;
  selectionMode?: boolean;
  selected?: boolean;
}) {
  const category = txn.categoryId ? categoriesById.get(txn.categoryId) : undefined;
  const uncategorized = category?.systemKey === 'uncategorized';
  const subtitle = [
    txn.isSplit ? `Split · ${txn.splits.length} parts` : (category?.name ?? 'Uncategorized'),
    accountsById.get(txn.accountId)?.name,
  ]
    .filter(Boolean)
    .join(' · ');
  const { offset, handlers, shouldHandleClick, triggered } = useRowGestures({
    onSwipe: onSwipe && !selectionMode && !txn.isSplit ? () => onSwipe(txn) : undefined,
    onLongPress: onLongPress && !selectionMode ? () => onLongPress(txn) : undefined,
  });

  return (
    <li className="relative overflow-hidden rounded-lg">
      {offset < 0 && (
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 flex items-center justify-end gap-2 rounded-lg px-4 text-sm font-medium',
            triggered ? 'bg-primary text-primary-foreground' : 'bg-accent text-accent-foreground',
          )}
        >
          <Tags className="size-5" /> Categorize
        </div>
      )}
      <button
        type="button"
        {...handlers}
        onClick={() => shouldHandleClick() && onOpen(txn)}
        aria-pressed={selectionMode ? selected : undefined}
        style={{
          transform: offset ? `translateX(${offset}px)` : undefined,
          touchAction: 'pan-y',
        }}
        className={cn(
          'relative flex min-h-16 w-full items-center gap-3 rounded-lg bg-background px-2 py-2 text-left select-none hover:bg-muted',
          selected && 'bg-accent hover:bg-accent',
          offset === 0 && 'transition-transform',
        )}
      >
        {selectionMode ? (
          <span
            aria-hidden
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full border-2',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
            )}
          >
            {selected && <Check className="size-5" />}
          </span>
        ) : (
          <CategoryIcon icon={category?.icon} color={category?.color} split={txn.isSplit} />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{transactionTitle(txn, category)}</span>
          <span
            className={cn(
              'truncate text-xs',
              uncategorized ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
            )}
          >
            {subtitle}
          </span>
          {txn.tags.length > 0 && (
            <span className="mt-0.5 truncate text-xs text-primary">
              {txn.tags.map((t) => `#${t.name}`).join(' ')}
            </span>
          )}
        </span>
        <Money
          paise={txn.amountPaise}
          direction={txn.direction}
          className="text-sm font-semibold"
        />
      </button>
    </li>
  );
}
