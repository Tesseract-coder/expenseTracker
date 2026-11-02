import { Bot, CheckCheck, CheckSquare, MoreHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AI_BATCH, type TransactionDto } from '@kharcha/shared';
import {
  useAccounts,
  useAiSuggest,
  useCategoryMap,
  useInbox,
  useMe,
  useRunCategorization,
} from '@/app/queries';
import { CategoryIcon } from '@/components/CategoryIcon';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { formatDayHeader } from '@/lib/format';
import { cn } from '@/lib/utils';
import { transactionTitle } from '@/features/transactions/TransactionRow';
import { useLabelSheet, useUndoToast } from './LabelSheet';
import { SelectionBar } from './SelectionBar';

/** "Needs labelling": uncategorized transactions with one-tap category suggestions. */
export function InboxPage() {
  const inbox = useInbox();
  const accounts = useAccounts();
  const { byId } = useCategoryMap();
  const { openLabel } = useLabelSheet();
  const run = useRunCategorization();
  const me = useMe();
  const ai = useAiSuggest();
  const showUndo = useUndoToast();
  const [selection, setSelection] = useState<Set<string> | null>(null);

  const pages = useMemo(() => inbox.data?.pages ?? [], [inbox.data]);
  const rows = useMemo(() => pages.flatMap((p) => p.transactions), [pages]);
  const suggestions = useMemo(
    () => Object.assign({}, ...pages.map((p) => p.suggestions)) as Record<string, string[]>,
    [pages],
  );
  const total = pages[0]?.total ?? 0;
  const accountName = (id: string) => accounts.data?.find((a) => a.id === id)?.name;

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = inbox;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggle = (id: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const autoCategorize = () =>
    run.mutate('uncategorized', {
      onSuccess: (r) =>
        r.changed
          ? showUndo(`Categorized ${r.changed} with your rules and labels`, r.batchId)
          : toast('Nothing new matched your rules, labels or keywords'),
      onError: (e) => toast.error(errorMessage(e)),
    });

  const askAi = () => {
    const ids = rows
      .filter((r) => !r.aiSuggestion)
      .slice(0, AI_BATCH)
      .map((r) => r.id);
    if (ids.length === 0) {
      toast('Every transaction shown already has an AI suggestion');
      return;
    }
    ai.mutate(ids, {
      onSuccess: (r) => {
        const pending = r.suggestions.length - r.applied;
        const msg =
          r.suggestions.length === 0
            ? "The AI wasn't confident about any of these"
            : `${r.applied ? `Applied ${r.applied} confident suggestion${r.applied === 1 ? '' : 's'}. ` : ''}${pending ? `${pending} suggestion${pending === 1 ? '' : 's'} to review.` : ''}`;
        if (r.undoToken) showUndo(msg, r.undoToken);
        else toast(msg);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  if (inbox.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }
  if (inbox.isError) {
    return (
      <EmptyState icon={CheckCheck} title="Couldn't load the inbox">
        <Button variant="outline" onClick={() => void inbox.refetch()}>
          Retry
        </Button>
      </EmptyState>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState icon={CheckCheck} title="All caught up">
        Every transaction has a category.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          <strong className="text-foreground">{total}</strong> need{total === 1 ? 's' : ''}{' '}
          labelling
        </p>
        <div className="flex gap-2">
          <Chip
            selected={selection !== null}
            onClick={() => setSelection(selection ? null : new Set())}
          >
            <CheckSquare aria-hidden className="size-4" /> Select
          </Chip>
          <Chip onClick={autoCategorize} disabled={run.isPending} aria-label="Auto-categorize">
            <Sparkles aria-hidden className="size-4" /> {run.isPending ? 'Working…' : 'Auto'}
          </Chip>
          {me.data?.features.ai && (
            <Chip onClick={askAi} disabled={ai.isPending} aria-label="Ask AI for suggestions">
              <Bot aria-hidden className="size-4" /> {ai.isPending ? 'Asking…' : 'Ask AI'}
            </Chip>
          )}
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((t) => (
          <InboxItem
            key={t.id}
            txn={t}
            account={accountName(t.accountId)}
            suggestionIds={suggestions[t.id] ?? []}
            byId={byId}
            selectionMode={selection !== null}
            selected={selection?.has(t.id) ?? false}
            onToggle={() => toggle(t.id)}
            onPick={(categoryId) => openLabel({ txn: t, categoryId })}
            onMore={() => openLabel({ txn: t })}
          />
        ))}
      </ul>
      <div ref={sentinel} className="h-8">
        {isFetchingNextPage && <Skeleton className="h-28 w-full" />}
      </div>

      {selection && (
        <SelectionBar
          ids={[...selection]}
          direction={rows.find((r) => selection.has(r.id))?.direction ?? 'out'}
          onCancel={() => setSelection(null)}
          onDone={() => setSelection(null)}
        />
      )}
    </div>
  );
}

function InboxItem({
  txn,
  account,
  suggestionIds,
  byId,
  selectionMode,
  selected,
  onToggle,
  onPick,
  onMore,
}: {
  txn: TransactionDto;
  account: string | undefined;
  suggestionIds: string[];
  byId: ReturnType<typeof useCategoryMap>['byId'];
  selectionMode: boolean;
  selected: boolean;
  onToggle: () => void;
  onPick: (categoryId: string) => void;
  onMore: () => void;
}) {
  const title = transactionTitle(txn, undefined);
  const aiSuggestion = txn.aiSuggestion;
  const aiCategory = aiSuggestion ? byId.get(aiSuggestion.categoryId) : undefined;
  return (
    <li>
      <Card className={cn('flex flex-col gap-2 p-3', selected && 'border-primary bg-accent')}>
        <div className="flex items-start gap-3">
          {selectionMode && (
            <input
              type="checkbox"
              aria-label={`Select ${title}`}
              checked={selected}
              onChange={onToggle}
              className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{title}</span>
            <span className="truncate text-xs text-muted-foreground">
              {formatDayHeader(txn.txnDate)}
              {account ? ` · ${account}` : ''}
            </span>
            {txn.rawNarration && txn.counterparty && (
              <span className="truncate text-xs text-muted-foreground">{txn.rawNarration}</span>
            )}
          </div>
          <Money
            paise={txn.amountPaise}
            direction={txn.direction}
            className="shrink-0 text-sm font-semibold"
          />
        </div>
        {!selectionMode && (
          <div
            className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1"
            role="group"
            aria-label={`Categories for ${title}`}
          >
            {aiSuggestion && aiCategory && (
              <Chip
                onClick={() => onPick(aiSuggestion.categoryId)}
                className="pl-1.5"
                aria-label={`AI suggested: ${aiCategory.name}`}
              >
                <Bot aria-hidden className="size-4 text-primary" />
                {aiCategory.name}
                {aiSuggestion.confidence !== null && (
                  <span className="text-xs text-muted-foreground">
                    AI · {Math.round(aiSuggestion.confidence * 100)}%
                  </span>
                )}
              </Chip>
            )}
            {suggestionIds
              .filter((id) => id !== txn.aiSuggestion?.categoryId)
              .map((id) => {
                const c = byId.get(id);
                if (!c) return null;
                return (
                  <Chip key={id} onClick={() => onPick(id)} className="pl-1.5">
                    <CategoryIcon icon={c.icon} color={c.color} className="size-7" />
                    {c.name}
                  </Chip>
                );
              })}
            <Chip onClick={onMore} aria-label={`More categories for ${title}`}>
              <MoreHorizontal aria-hidden className="size-4" /> Other
            </Chip>
          </div>
        )}
      </Card>
    </li>
  );
}
