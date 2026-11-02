import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { CategoryDto, LabelScope, TransactionDto } from '@kharcha/shared';
import {
  useAccounts,
  useCategoryMap,
  useLabelImpact,
  useLabelTransaction,
  useUndo,
} from '@/app/queries';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { CategoryPicker } from '@/features/categories/CategoryPicker';

export interface LabelTarget {
  txn: TransactionDto;
  /** Preselected category (e.g. a suggestion chip); otherwise the picker opens first. */
  categoryId?: string | null;
  /** The category was already saved on this transaction (edit sheet); only offer learning. */
  alreadyApplied?: boolean;
}

interface LabelApi {
  openLabel: (target: LabelTarget) => void;
  showUndo: (message: string, token: string | null) => void;
}
const Ctx = createContext<LabelApi | null>(null);

export function useLabelSheet(): LabelApi {
  const ctx = use(Ctx);
  if (!ctx) throw new Error('useLabelSheet must be used inside LabelSheetProvider');
  return ctx;
}

/**
 * Undo toast shared by every categorization action. The undo mutation lives in the app-level
 * provider, so its callbacks still fire after the component that showed the toast unmounts.
 */
export function useUndoToast() {
  const ctx = use(Ctx);
  if (!ctx) throw new Error('useUndoToast must be used inside LabelSheetProvider');
  return ctx.showUndo;
}

type Step =
  | { kind: 'closed' }
  | { kind: 'pick'; target: LabelTarget }
  | { kind: 'scope'; target: LabelTarget; categoryId: string };

export function LabelSheetProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const label = useLabelTransaction();
  const undo = useUndo();
  const { byId } = useCategoryMap();
  const showUndo = useCallback(
    (message: string, token: string | null) =>
      toast.success(message, {
        action: token
          ? {
              label: 'Undo',
              onClick: () =>
                undo.mutate(token, {
                  onSuccess: () => toast('Undone'),
                  onError: (e) => toast.error(errorMessage(e)),
                }),
            }
          : undefined,
      }),
    [undo],
  );

  const apply = useCallback(
    async (
      target: LabelTarget,
      categoryId: string,
      scope: LabelScope,
      matchDirection = true,
      matchAccount = false,
    ) => {
      try {
        const r = await label.mutateAsync({
          id: target.txn.id,
          body: { categoryId, scope, matchDirection, matchAccount },
        });
        const name = byId.get(categoryId)?.name ?? 'category';
        const more = r.applied > 0 ? ` and ${r.applied} more` : '';
        const learned = scope === 'this' ? '' : ' · will remember';
        showUndo(`Categorized as ${name}${more}${learned}`, r.undoToken);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    [label, byId, showUndo],
  );

  const choose = useCallback(
    (target: LabelTarget, categoryId: string) => {
      if (target.txn.counterparty && !target.txn.isSplit) {
        setStep({ kind: 'scope', target, categoryId });
      } else if (!target.alreadyApplied) {
        setStep({ kind: 'closed' });
        void apply(target, categoryId, 'this');
      } else {
        setStep({ kind: 'closed' });
      }
    },
    [apply],
  );

  const openLabel = useCallback(
    (target: LabelTarget) => {
      if (target.categoryId) choose(target, target.categoryId);
      else setStep({ kind: 'pick', target });
    },
    [choose],
  );
  const api = useMemo(() => ({ openLabel, showUndo }), [openLabel, showUndo]);

  return (
    <Ctx value={api}>
      {children}
      <CategoryPicker
        nested={false}
        open={step.kind === 'pick'}
        onOpenChange={(open) =>
          !open && setStep((s) => (s.kind === 'pick' ? { kind: 'closed' } : s))
        }
        direction={step.kind === 'pick' ? step.target.txn.direction : 'out'}
        selectedId={step.kind === 'pick' ? step.target.txn.categoryId : null}
        title="Categorize as"
        onSelect={(c: CategoryDto) => step.kind === 'pick' && choose(step.target, c.id)}
      />
      {step.kind === 'scope' && (
        <ScopeSheet
          key={`${step.target.txn.id}:${step.categoryId}`}
          target={step.target}
          categoryId={step.categoryId}
          busy={label.isPending}
          onClose={() => setStep({ kind: 'closed' })}
          onApply={(scope, matchDirection, matchAccount) => {
            const { target, categoryId } = step;
            setStep({ kind: 'closed' });
            if (scope === 'this' && target.alreadyApplied) return;
            void apply(target, categoryId, scope, matchDirection, matchAccount);
          }}
        />
      )}
    </Ctx>
  );
}

function ScopeSheet({
  target,
  categoryId,
  busy,
  onClose,
  onApply,
}: {
  target: LabelTarget;
  categoryId: string;
  busy: boolean;
  onClose: () => void;
  onApply: (scope: LabelScope, matchDirection: boolean, matchAccount: boolean) => void;
}) {
  const { txn } = target;
  const { byId } = useCategoryMap();
  const accounts = useAccounts();
  const [scope, setScope] = useState<LabelScope>('future');
  const [matchDirection, setMatchDirection] = useState(true);
  const [matchAccount, setMatchAccount] = useState(false);
  const impact = useLabelImpact(txn.id, categoryId, matchDirection, matchAccount, true);
  const category = byId.get(categoryId);
  const payee = txn.counterparty?.name ?? 'this payee';
  const accountName = accounts.data?.find((a) => a.id === txn.accountId)?.name ?? 'this account';
  const count = impact.data?.count;

  const options: { value: LabelScope; title: string; detail: string }[] = [
    {
      value: 'this',
      title: target.alreadyApplied ? 'No, just this one' : 'This one only',
      detail: 'Nothing is remembered.',
    },
    {
      value: 'future',
      title: 'All future',
      detail: `New transactions from ${payee} get ${category?.name ?? 'this category'}.`,
    },
    {
      value: 'past_and_future',
      title: 'All past + future',
      detail:
        count === undefined
          ? 'Also updates past transactions…'
          : count === 0
            ? 'No other past transactions to update.'
            : `Also updates ${count} past transaction${count === 1 ? '' : 's'} (not ones you set by hand).`,
    },
  ];

  return (
    <Sheet
      open
      nested={false}
      onOpenChange={(o) => !o && onClose()}
      title="Remember this?"
      footer={
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => onApply(scope, matchDirection, matchAccount)}
        >
          {scope === 'this'
            ? target.alreadyApplied
              ? 'Done'
              : 'Categorize'
            : 'Categorize and remember'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
          <CategoryIcon icon={category?.icon} color={category?.color} className="size-9" />
          <p className="min-w-0 flex-1 text-sm">
            Always categorize <strong className="break-words">{payee}</strong> as{' '}
            <strong>{category?.name ?? '…'}</strong>?
          </p>
        </div>

        <div role="radiogroup" aria-label="Apply to" className="flex flex-col gap-2">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={scope === o.value}
              onClick={() => setScope(o.value)}
              className={cn(
                'flex min-h-14 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left',
                scope === o.value ? 'border-primary bg-accent' : 'border-border',
              )}
            >
              <span className="text-sm font-medium">{o.title}</span>
              <span className="text-xs text-muted-foreground">{o.detail}</span>
            </button>
          ))}
        </div>

        {scope !== 'this' && (
          <div className="flex flex-col">
            <Switch
              label={`Only money ${txn.direction === 'out' ? 'going out' : 'coming in'}`}
              checked={matchDirection}
              onCheckedChange={setMatchDirection}
            />
            <Switch
              label={`Only in ${accountName}`}
              checked={matchAccount}
              onCheckedChange={setMatchAccount}
            />
          </div>
        )}
      </div>
    </Sheet>
  );
}
