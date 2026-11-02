import { CheckSquare, Download, List, Search, SlidersHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { periodRange, toIstDate, previousPeriodRange } from '@kharcha/shared';
import { useAccounts, useCategoryMap, useTags, useTransactions } from '@/app/queries';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Field, Input, Select } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDayHeader } from '@/lib/format';
import { errorMessage } from '@/lib/api';
import { categoryLabel } from '@/lib/categories';
import { CategoryPicker } from '@/features/categories/CategoryPicker';
import { useLabelSheet } from '@/features/categorize/LabelSheet';
import { SelectionBar } from '@/features/categorize/SelectionBar';
import { groupByDay } from './groupByDay';
import { TransactionRow } from './TransactionRow';
import { useTransactionSheet } from './TransactionSheet';
import { splitIds, useTxnFilters } from './useTxnFilters';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function TransactionsPage() {
  const { filters, params, setFilter, clearAll, activeCount } = useTxnFilters();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debounced = useDebounced(search, 300);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { openEdit } = useTransactionSheet();
  const { openLabel } = useLabelSheet();
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const runExport = async (format: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      const { downloadTransactions } = await import('@/features/reports/exporting');
      const r = await downloadTransactions(filters, format);
      toast.success(
        r.truncated
          ? `Exported the first ${r.count} rows`
          : `Exported ${r.count} row${r.count === 1 ? '' : 's'}`,
      );
      setExportOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };
  const toggle = (id: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => setFilter('q', debounced.trim() || undefined), [debounced, setFilter]);

  const list = useTransactions(filters);
  const accounts = useAccounts();
  const { byId: categoriesById } = useCategoryMap();
  const accountsById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data],
  );
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.transactions) ?? [], [list.data]);
  const days = useMemo(() => groupByDay(rows), [rows]);

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search aria-hidden className="absolute top-3 left-3 size-5 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search transactions"
          placeholder="Search narration, payee, note or amount"
          className="pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip selected={activeCount > 0} onClick={() => setFiltersOpen(true)} aria-label="Filters">
          <SlidersHorizontal aria-hidden className="size-4" />
          Filters{activeCount > 0 && ` (${activeCount})`}
        </Chip>
        <Chip
          selected={filters.direction === 'out'}
          onClick={() => setFilter('direction', filters.direction === 'out' ? undefined : 'out')}
        >
          Expenses
        </Chip>
        <Chip
          selected={filters.direction === 'in'}
          onClick={() => setFilter('direction', filters.direction === 'in' ? undefined : 'in')}
        >
          Income
        </Chip>
        <Chip
          selected={!!filters.uncategorized}
          onClick={() => setFilter('uncategorized', filters.uncategorized ? undefined : 'true')}
        >
          Uncategorized
        </Chip>
        {activeCount > 0 && (
          <Chip onClick={clearAll} aria-label="Clear filters">
            <X aria-hidden className="size-4" /> Clear
          </Chip>
        )}
        <Chip
          selected={selection !== null}
          onClick={() => setSelection(selection ? null : new Set())}
          aria-label="Select transactions"
        >
          <CheckSquare aria-hidden className="size-4" /> Select
        </Chip>
        <Chip onClick={() => setExportOpen(true)} aria-label="Export transactions">
          <Download aria-hidden className="size-4" /> Export
        </Chip>
      </div>

      {list.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading transactions">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <EmptyState icon={List} title="Couldn't load transactions">
          <Button variant="outline" onClick={() => void list.refetch()}>
            Retry
          </Button>
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={List}
          title={activeCount || filters.q ? 'No matching transactions' : 'No transactions yet'}
        >
          {activeCount || filters.q ? (
            'Try a different search or clear filters.'
          ) : (
            <>
              Tap + to add one, or{' '}
              <Link to="/import" className="font-medium text-primary underline">
                import a bank statement
              </Link>
              .
            </>
          )}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {days.map((d) => (
            <section key={d.date} aria-label={formatDayHeader(d.date)}>
              <header className="flex items-baseline justify-between px-2 pb-1 text-xs font-semibold text-muted-foreground">
                <h2>{formatDayHeader(d.date)}</h2>
                <span className="flex gap-2">
                  {d.inPaise > 0 && <Money paise={d.inPaise} direction="in" />}
                  {d.outPaise > 0 && <Money paise={d.outPaise} direction="out" />}
                </span>
              </header>
              <ul className="flex flex-col">
                {d.transactions.map((t) => (
                  <TransactionRow
                    key={t.id}
                    txn={t}
                    categoriesById={categoriesById}
                    accountsById={accountsById}
                    selectionMode={selection !== null}
                    selected={selection?.has(t.id) ?? false}
                    onOpen={(txn) => (selection ? toggle(txn.id) : openEdit(txn))}
                    onSwipe={(txn) => openLabel({ txn })}
                    onLongPress={(txn) => setSelection(new Set([txn.id]))}
                  />
                ))}
              </ul>
            </section>
          ))}
          <div ref={sentinel} className="h-8">
            {isFetchingNextPage && <Skeleton className="h-16 w-full" />}
          </div>
        </div>
      )}

      {selection && (
        <SelectionBar
          ids={[...selection]}
          direction={rows.find((r) => selection.has(r.id))?.direction ?? 'out'}
          onCancel={() => setSelection(null)}
          onDone={() => setSelection(null)}
        />
      )}

      <Sheet
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export transactions"
        description="Exports every transaction matching the current search and filters (up to 20,000)."
      >
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={exporting} onClick={() => void runExport('xlsx')}>
            Excel (.xlsx)
          </Button>
          <Button variant="outline" disabled={exporting} onClick={() => void runExport('csv')}>
            CSV
          </Button>
        </div>
      </Sheet>

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        filters={filters}
        setFilter={setFilter}
        categoryName={(id) => categoryLabel(categoriesById, id)}
      />
    </div>
  );
}

function FilterSheet({
  open,
  onOpenChange,
  filters,
  setFilter,
  categoryName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  filters: ReturnType<typeof useTxnFilters>['filters'];
  setFilter: ReturnType<typeof useTxnFilters>['setFilter'];
  categoryName: (id: string) => string;
}) {
  const accounts = useAccounts();
  const tags = useTags();
  const [pickerOpen, setPickerOpen] = useState(false);
  const today = toIstDate();
  const accountIds = splitIds(filters.accountIds);
  const categoryId = splitIds(filters.categoryIds)[0];
  const tagId = splitIds(filters.tagIds)[0];

  const presets = [
    { label: 'This month', range: periodRange('month', today) },
    { label: 'Last month', range: previousPeriodRange('month', periodRange('month', today)) },
    { label: 'This year', range: periodRange('year', today) },
  ];
  const setRange = (r?: { from: string; to: string }) => {
    setFilter('from', r?.from);
    setFilter('to', r?.to);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filters"
      footer={
        <Button className="w-full" onClick={() => onOpenChange(false)}>
          Show results
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Accounts">
          <div className="flex flex-wrap gap-2">
            {(accounts.data ?? []).map((a) => {
              const on = accountIds.includes(a.id);
              return (
                <Chip
                  key={a.id}
                  selected={on}
                  onClick={() =>
                    setFilter(
                      'accountIds',
                      on ? accountIds.filter((x) => x !== a.id) : [...accountIds, a.id],
                    )
                  }
                >
                  {a.name}
                </Chip>
              );
            })}
          </div>
        </Field>

        <Field label="Category">
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 justify-start"
              onClick={() => setPickerOpen(true)}
            >
              {categoryId ? categoryName(categoryId) : 'Any category'}
            </Button>
            {categoryId && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Clear category"
                onClick={() => setFilter('categoryIds', undefined)}
              >
                <X aria-hidden className="size-4" />
              </Button>
            )}
          </div>
        </Field>

        <Field label="Date">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Chip
                key={p.label}
                selected={filters.from === p.range.from && filters.to === p.range.to}
                onClick={() => setRange(p.range)}
              >
                {p.label}
              </Chip>
            ))}
            <Chip selected={!filters.from && !filters.to} onClick={() => setRange(undefined)}>
              All time
            </Chip>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Input
              type="date"
              aria-label="From date"
              value={filters.from ?? ''}
              onChange={(e) => setFilter('from', e.target.value || undefined)}
            />
            <Input
              type="date"
              aria-label="To date"
              value={filters.to ?? ''}
              onChange={(e) => setFilter('to', e.target.value || undefined)}
            />
          </div>
        </Field>

        {(tags.data?.length ?? 0) > 0 && (
          <Field label="Tag" htmlFor="tag-filter">
            <Select
              id="tag-filter"
              value={tagId ?? ''}
              onChange={(e) => setFilter('tagIds', e.target.value || undefined)}
            >
              <option value="">Any tag</option>
              {tags.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.name} ({t.count})
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <CategoryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        allowGroups
        selectedId={categoryId}
        title="Filter by category"
        onSelect={(c) => setFilter('categoryIds', c.id)}
      />
    </Sheet>
  );
}
