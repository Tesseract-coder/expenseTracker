import type { AccountDto, CategoryDto, TransactionDto } from '@kharcha/shared';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Money } from '@/components/Money';

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
}: {
  txn: TransactionDto;
  categoriesById: Map<string, CategoryDto>;
  accountsById: Map<string, AccountDto>;
  onOpen: (t: TransactionDto) => void;
}) {
  const category = txn.categoryId ? categoriesById.get(txn.categoryId) : undefined;
  const subtitle = [
    txn.isSplit ? `Split · ${txn.splits.length} parts` : (category?.name ?? 'Uncategorized'),
    accountsById.get(txn.accountId)?.name,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(txn)}
        className="flex min-h-16 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
      >
        <CategoryIcon icon={category?.icon} color={category?.color} split={txn.isSplit} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{transactionTitle(txn, category)}</span>
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
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
