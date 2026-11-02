import { Plus, Trash2, X } from 'lucide-react';
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  formatINR,
  parseRupeesToPaise,
  toIstDate,
  type Direction,
  type TransactionDto,
  transactionCreateSchema,
} from '@kharcha/shared';
import {
  useAccounts,
  useCategoryMap,
  useCounterparties,
  useCreateTransaction,
  useDeleteTransaction,
  useTags,
  useTransactions,
  useUndo,
  useUpdateTransaction,
} from '@/app/queries';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Field, Input, Select, Switch } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { categoryLabel } from '@/lib/categories';
import { cn } from '@/lib/utils';
import { CategoryPicker } from '@/features/categories/CategoryPicker';
import { explainCategorization } from '@/features/categorize/explain';
import { useLabelSheet } from '@/features/categorize/LabelSheet';

const LAST_ACCOUNT_KEY = 'kharcha.lastAccountId';

// ---------------------------------------------------------------------------- context

interface TransactionSheetApi {
  openAdd: () => void;
  openEdit: (txn: TransactionDto) => void;
}
const Ctx = createContext<TransactionSheetApi | null>(null);

export function useTransactionSheet(): TransactionSheetApi {
  const ctx = use(Ctx);
  if (!ctx) throw new Error('useTransactionSheet must be used inside TransactionSheetProvider');
  return ctx;
}

export function TransactionSheetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; txn: TransactionDto | null; key: number }>({
    open: false,
    txn: null,
    key: 0,
  });
  const openAdd = useCallback(
    () => setState((s) => ({ open: true, txn: null, key: s.key + 1 })),
    [],
  );
  const openEdit = useCallback(
    (txn: TransactionDto) => setState((s) => ({ open: true, txn, key: s.key + 1 })),
    [],
  );
  const api = useMemo(() => ({ openAdd, openEdit }), [openAdd, openEdit]);

  return (
    <Ctx value={api}>
      {children}
      <Sheet
        open={state.open}
        onOpenChange={(open) => setState((s) => ({ ...s, open }))}
        title={state.txn ? 'Edit transaction' : 'Add transaction'}
      >
        {state.open && (
          <TransactionForm
            key={state.key}
            txn={state.txn}
            onDone={() => setState((s) => ({ ...s, open: false }))}
          />
        )}
      </Sheet>
    </Ctx>
  );
}

// ---------------------------------------------------------------------------- form

interface SplitDraft {
  key: number;
  categoryId: string | null;
  amount: string;
}

const paiseToInput = (p: number) => (p / 100).toFixed(2).replace(/\.00$/, '');

function TransactionForm({ txn, onDone }: { txn: TransactionDto | null; onDone: () => void }) {
  const accounts = useAccounts();
  const { byId: categoriesById } = useCategoryMap();
  const tagsQuery = useTags();
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const remove = useDeleteTransaction();
  const undo = useUndo();
  const { openLabel } = useLabelSheet();

  const activeAccounts = (accounts.data ?? []).filter((a) => a.active || a.id === txn?.accountId);
  const rememberedAccount = localStorage.getItem(LAST_ACCOUNT_KEY);
  const defaultAccount =
    activeAccounts.find((a) => a.id === rememberedAccount)?.id ?? activeAccounts[0]?.id ?? '';

  const uncategorized = [...categoriesById.values()].find((c) => c.systemKey === 'uncategorized');
  const initialCategory = txn && txn.categoryId !== uncategorized?.id ? txn.categoryId : null;

  const [direction, setDirection] = useState<Direction>(txn?.direction ?? 'out');
  const [amount, setAmount] = useState(txn ? paiseToInput(txn.amountPaise) : '');
  const [accountId, setAccountId] = useState(txn?.accountId ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initialCategory);
  const [split, setSplit] = useState(txn?.isSplit ?? false);
  const [splits, setSplits] = useState<SplitDraft[]>(
    txn?.isSplit
      ? txn.splits.map((s, i) => ({
          key: i,
          categoryId: s.categoryId,
          amount: paiseToInput(s.amountPaise),
        }))
      : [
          { key: 0, categoryId: null, amount: '' },
          { key: 1, categoryId: null, amount: '' },
        ],
  );
  const [txnDate, setTxnDate] = useState(txn?.txnDate ?? toIstDate());
  const [note, setNote] = useState(txn?.note ?? '');
  const [counterpartyName, setCounterpartyName] = useState(txn?.counterparty?.name ?? '');
  const [tags, setTags] = useState<string[]>(txn?.tags.map((t) => t.name) ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [isReimbursable, setIsReimbursable] = useState(txn?.isReimbursable ?? false);
  const [reimbursedBy, setReimbursedBy] = useState<string | null>(txn?.reimbursedByTxnId ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [picker, setPicker] = useState<{ open: boolean; target: 'main' | number }>({
    open: false,
    target: 'main',
  });

  const counterparties = useCounterparties(counterpartyName.length >= 2 ? counterpartyName : '');
  const incoming = useTransactions({ direction: 'in', from: txnDate }, 20);
  const effectiveAccount = accountId || defaultAccount;
  const amountPaise = parseRupeesToPaise(amount);
  const splitTotal = splits.reduce((acc, s) => acc + (parseRupeesToPaise(s.amount) ?? 0), 0);

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagDraft('');
  };

  function buildPayload() {
    return {
      accountId: effectiveAccount,
      txnDate,
      amountPaise: amountPaise ?? Number.NaN,
      direction,
      categoryId: split ? null : categoryId,
      splits: split
        ? splits.map((s) => ({
            categoryId: s.categoryId ?? '',
            amountPaise: parseRupeesToPaise(s.amount) ?? Number.NaN,
          }))
        : [],
      note: note.trim() || null,
      counterpartyName: counterpartyName.trim() || null,
      tags: tagDraft.trim() ? [...tags, tagDraft] : tags,
      isReimbursable: direction === 'out' && isReimbursable,
      reimbursedByTxnId: direction === 'out' && isReimbursable ? reimbursedBy : null,
    };
  }

  async function save() {
    const payload = buildPayload();
    const parsed = transactionCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key] ??=
          key === 'amountPaise' && amount.trim() === '' ? 'Enter an amount' : issue.message;
      }
      if (split && payload.splits.some((s) => !s.categoryId))
        next.splits = 'Choose a category for every part';
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      if (txn) {
        const categoryChanged =
          split !== txn.isSplit ||
          (!split && categoryId !== initialCategory) ||
          (split &&
            JSON.stringify(payload.splits) !==
              JSON.stringify(
                txn.splits.map((s) => ({ categoryId: s.categoryId, amountPaise: s.amountPaise })),
              ));
        const { categoryId: cat, splits: sp, ...rest } = parsed.data;
        const { transaction: saved } = await update.mutateAsync({
          id: txn.id,
          patch: { ...rest, ...(categoryChanged ? { categoryId: cat, splits: sp } : {}) },
        });
        toast.success('Transaction updated');
        // Offer to remember the new category for this payee (spec §6.3).
        if (categoryChanged && !split && cat && saved.counterparty) {
          onDone();
          openLabel({ txn: saved, categoryId: cat, alreadyApplied: true });
          return;
        }
      } else {
        await create.mutateAsync(parsed.data);
        localStorage.setItem(LAST_ACCOUNT_KEY, parsed.data.accountId);
        toast.success(`Saved ${formatINR(parsed.data.amountPaise, { compactZeroPaise: true })}`);
      }
      onDone();
    } catch (err) {
      if (err instanceof ApiRequestError && err.issues.length) {
        setErrors(
          Object.fromEntries(err.issues.map((i) => [i.path.split('.')[0] ?? 'form', i.message])),
        );
      } else {
        toast.error(errorMessage(err));
      }
    }
  }

  async function onDelete() {
    if (!txn) return;
    onDone();
    try {
      const { undoToken } = await remove.mutateAsync(txn.id);
      toast('Transaction deleted', {
        action: {
          label: 'Undo',
          onClick: () => undo.mutate(undoToken, { onError: (e) => toast.error(errorMessage(e)) }),
        },
      });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const selectedCategory = categoryId ? categoriesById.get(categoryId) : undefined;
  const pickerSelected =
    picker.target === 'main' ? categoryId : (splits[picker.target]?.categoryId ?? null);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div
        role="radiogroup"
        aria-label="Direction"
        className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1"
      >
        {(['out', 'in'] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={direction === d}
            onClick={() => setDirection(d)}
            className={cn(
              'min-h-11 rounded-md text-sm font-semibold',
              direction === d
                ? d === 'out'
                  ? 'bg-card text-expense shadow'
                  : 'bg-card text-income shadow'
                : 'text-muted-foreground',
            )}
          >
            {d === 'out' ? 'Expense' : 'Income'}
          </button>
        ))}
      </div>

      <Field label="Amount" htmlFor="amount" error={errors.amountPaise}>
        <div className="relative">
          <span
            aria-hidden
            className="absolute top-1/2 left-3 -translate-y-1/2 text-2xl text-muted-foreground"
          >
            ₹
          </span>
          <Input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            autoFocus={!txn}
            placeholder="0"
            value={amount}
            aria-invalid={!!errors.amountPaise}
            onChange={(e) => setAmount(e.target.value)}
            className="min-h-14 pl-9 text-3xl font-semibold tabular-nums"
          />
        </div>
      </Field>

      {!split ? (
        <Field label="Category" error={errors.categoryId}>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPicker({ open: true, target: 'main' })}
              className="flex min-h-12 flex-1 items-center gap-3 rounded-md border border-border px-3 text-left"
            >
              <CategoryIcon
                icon={selectedCategory?.icon ?? 'circle-help'}
                color={selectedCategory?.color}
                className="size-8"
              />
              <span className={cn('text-sm', !selectedCategory && 'text-muted-foreground')}>
                {selectedCategory
                  ? categoryLabel(categoriesById, categoryId)
                  : 'Uncategorized — tap to choose'}
              </span>
            </button>
            <Button type="button" variant="outline" onClick={() => setSplit(true)}>
              Split
            </Button>
          </div>
          {txn && categoryId === initialCategory && explainCategorization(txn) && (
            <p className="text-xs text-muted-foreground">Why: {explainCategorization(txn)}</p>
          )}
        </Field>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 flex w-full items-center justify-between text-sm font-medium">
            Split
            <button
              type="button"
              className="min-h-11 text-sm text-primary"
              onClick={() => setSplit(false)}
            >
              Remove split
            </button>
          </legend>
          {splits.map((s, i) => {
            const c = s.categoryId ? categoriesById.get(s.categoryId) : undefined;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPicker({ open: true, target: i })}
                  className="flex min-h-11 flex-1 items-center gap-2 truncate rounded-md border border-border px-2 text-left text-sm"
                  aria-label={`Part ${i + 1} category`}
                >
                  <CategoryIcon
                    icon={c?.icon ?? 'circle-help'}
                    color={c?.color}
                    className="size-7"
                  />
                  <span className={cn('truncate', !c && 'text-muted-foreground')}>
                    {c?.name ?? 'Category'}
                  </span>
                </button>
                <Input
                  aria-label={`Part ${i + 1} amount`}
                  inputMode="decimal"
                  className="w-28 tabular-nums"
                  placeholder="0"
                  value={s.amount}
                  onChange={(e) =>
                    setSplits(
                      splits.map((x) => (x.key === s.key ? { ...x, amount: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove part ${i + 1}`}
                  disabled={splits.length <= 2}
                  onClick={() => setSplits(splits.filter((x) => x.key !== s.key))}
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </div>
            );
          })}
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1 text-primary"
              onClick={() =>
                setSplits([...splits, { key: Date.now(), categoryId: null, amount: '' }])
              }
            >
              <Plus aria-hidden className="size-4" /> Add part
            </button>
            {amountPaise !== null && (
              <span
                className={cn(
                  'tabular-nums',
                  splitTotal === amountPaise ? 'text-income' : 'text-muted-foreground',
                )}
              >
                {splitTotal === amountPaise
                  ? 'Balanced'
                  : `${formatINR(amountPaise - splitTotal)} left`}
              </span>
            )}
          </div>
          {errors.splits && (
            <p role="alert" className="text-sm text-expense">
              {errors.splits}
            </p>
          )}
        </fieldset>
      )}

      <Field label="Account" error={errors.accountId}>
        <div
          role="radiogroup"
          aria-label="Account"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          {activeAccounts.map((a) => (
            <Chip
              key={a.id}
              role="radio"
              aria-checked={effectiveAccount === a.id}
              selected={effectiveAccount === a.id}
              onClick={() => setAccountId(a.id)}
            >
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{ backgroundColor: a.color ?? '#64748b' }}
              />
              {a.name}
            </Chip>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="txnDate" error={errors.txnDate}>
          <Input
            id="txnDate"
            type="date"
            value={txnDate}
            max="2099-12-31"
            onChange={(e) => setTxnDate(e.target.value)}
          />
        </Field>
        <Field
          label={direction === 'out' ? 'Paid to' : 'Received from'}
          htmlFor="counterparty"
          error={errors.counterpartyName}
        >
          <Input
            id="counterparty"
            list="counterparty-options"
            autoComplete="off"
            value={counterpartyName}
            onChange={(e) => setCounterpartyName(e.target.value)}
          />
          <datalist id="counterparty-options">
            {(counterparties.data ?? []).map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="Note" htmlFor="note" error={errors.note}>
        <Input id="note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <Field label="Tags" htmlFor="tags" error={errors.tags}>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-accent py-1 pr-1 pl-2.5 text-xs text-accent-foreground"
            >
              #{t}
              <button
                type="button"
                aria-label={`Remove tag ${t}`}
                className="rounded-full p-1"
                onClick={() => setTags(tags.filter((x) => x !== t))}
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <Input
          id="tags"
          list="tag-options"
          placeholder="Add a tag and press Enter"
          value={tagDraft}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',') || v.endsWith(' ')) addTag(v.slice(0, -1));
            else setTagDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag(tagDraft);
            }
          }}
        />
        <datalist id="tag-options">
          {(tagsQuery.data ?? []).map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </Field>

      {direction === 'out' && (
        <div className="flex flex-col gap-2">
          <Switch
            label="Reimbursable (e.g. office expense)"
            checked={isReimbursable}
            onCheckedChange={setIsReimbursable}
          />
          {isReimbursable && (
            <Field label="Reimbursed by" htmlFor="reimbursedBy" error={errors.reimbursedByTxnId}>
              <Select
                id="reimbursedBy"
                value={reimbursedBy ?? ''}
                onChange={(e) => setReimbursedBy(e.target.value || null)}
              >
                <option value="">Not reimbursed yet</option>
                {(incoming.data?.pages.flatMap((p) => p.transactions) ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.txnDate} · {t.counterparty?.name ?? t.note ?? 'Credit'} ·{' '}
                    {formatINR(t.amountPaise)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}

      {errors.form && (
        <p role="alert" className="text-sm text-expense">
          {errors.form}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-card px-4 pt-3 pb-1">
        {txn && (
          <Button
            type="button"
            variant="outline"
            aria-label="Delete transaction"
            onClick={() => void onDelete()}
          >
            <Trash2 aria-hidden className="size-4 text-expense" />
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={create.isPending || update.isPending}>
          {txn ? 'Save changes' : 'Save'}
        </Button>
      </div>

      <CategoryPicker
        open={picker.open}
        onOpenChange={(open) => setPicker((p) => ({ ...p, open }))}
        direction={direction}
        selectedId={pickerSelected}
        onSelect={(c) => {
          if (picker.target === 'main') setCategoryId(c.id);
          else
            setSplits(splits.map((s, i) => (i === picker.target ? { ...s, categoryId: c.id } : s)));
        }}
      />
    </form>
  );
}
