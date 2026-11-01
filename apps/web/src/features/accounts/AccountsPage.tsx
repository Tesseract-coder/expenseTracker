import { ChevronRight, Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import {
  ACCOUNT_TYPES,
  BANKS,
  type AccountDto,
  type AccountType,
  type Bank,
  accountCreateSchema,
  parseRupeesToPaise,
  toIstDate,
} from '@kharcha/shared';
import { useAccounts, useDeleteAccount, useSaveAccount } from '@/app/queries';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { ACCOUNT_TYPE_LABELS, BANK_LABELS, DEFAULT_COLOR, PALETTE } from '@/lib/format';
import { cn } from '@/lib/utils';

export function AccountBalance({
  account,
  className,
}: {
  account: AccountDto;
  className?: string;
}) {
  if (account.type === 'credit_card') {
    return account.balancePaise < 0 ? (
      <span className={cn('flex flex-col items-end', className)}>
        <Money paise={-account.balancePaise} className="font-semibold text-expense" />
        <span className="text-xs text-muted-foreground">outstanding</span>
      </span>
    ) : (
      <Money paise={account.balancePaise} className={cn('font-semibold', className)} />
    );
  }
  return (
    <Money
      paise={account.balancePaise}
      className={cn('font-semibold', account.balancePaise < 0 && 'text-expense', className)}
    />
  );
}

export function AccountsPage() {
  const accounts = useAccounts();
  const [editing, setEditing] = useState<{
    open: boolean;
    account: AccountDto | null;
    key: number;
  }>({
    open: false,
    account: null,
    key: 0,
  });
  const open = (account: AccountDto | null) =>
    setEditing((s) => ({ open: true, account, key: s.key + 1 }));
  const active = (accounts.data ?? []).filter((a) => a.active);
  const archived = (accounts.data ?? []).filter((a) => !a.active);

  return (
    <div className="flex flex-col gap-4">
      {accounts.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : active.length === 0 && archived.length === 0 ? (
        <EmptyState icon={Wallet} title="No accounts yet" />
      ) : (
        <>
          <AccountList accounts={active} onEdit={open} />
          {archived.length > 0 && (
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted-foreground">
                Archived ({archived.length})
              </summary>
              <AccountList accounts={archived} onEdit={open} />
            </details>
          )}
        </>
      )}
      <Button onClick={() => open(null)}>
        <Plus aria-hidden className="size-4" /> Add account
      </Button>

      <Sheet
        open={editing.open}
        onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))}
        title={editing.account ? 'Edit account' : 'Add account'}
      >
        {editing.open && (
          <AccountForm
            key={editing.key}
            account={editing.account}
            onDone={() => setEditing((s) => ({ ...s, open: false }))}
          />
        )}
      </Sheet>
    </div>
  );
}

function AccountList({
  accounts,
  onEdit,
}: {
  accounts: AccountDto[];
  onEdit: (a: AccountDto) => void;
}) {
  return (
    <Card>
      <ul className="divide-y divide-border">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center gap-2 pr-2">
            <button
              type="button"
              onClick={() => onEdit(a)}
              className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-4 text-left"
            >
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: a.color ?? '#64748b' }}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{a.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {[
                    ACCOUNT_TYPE_LABELS[a.type],
                    a.bank && BANK_LABELS[a.bank],
                    a.last4 && `••${a.last4}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <AccountBalance account={a} className="text-sm" />
            </button>
            <Link
              to={`/transactions?accountIds=${a.id}`}
              aria-label={`${a.name} transactions`}
              className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <ChevronRight aria-hidden className="size-5" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AccountForm({ account, onDone }: { account: AccountDto | null; onDone: () => void }) {
  const save = useSaveAccount();
  const remove = useDeleteAccount();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'savings');
  const [bank, setBank] = useState<Bank | ''>(account?.bank ?? '');
  const [last4, setLast4] = useState(account?.last4 ?? '');
  const isCard = type === 'credit_card';
  const initialOpening = account ? Math.abs(account.openingBalancePaise) / 100 : 0;
  const [opening, setOpening] = useState(initialOpening ? String(initialOpening) : '');
  const [openingDate, setOpeningDate] = useState(account?.openingBalanceDate ?? toIstDate());
  const [color, setColor] = useState(account?.color ?? DEFAULT_COLOR);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    const openingPaise = opening.trim() === '' ? 0 : parseRupeesToPaise(opening);
    if (openingPaise === null) return setErrors({ openingBalancePaise: 'Enter a valid amount' });
    const body = {
      name,
      type,
      bank: bank || null,
      last4: last4 || null,
      // Card balances are entered as a positive "outstanding" amount and stored as negative.
      openingBalancePaise: isCard ? -Math.abs(openingPaise) : openingPaise,
      openingBalanceDate: openingDate,
      color,
    };
    const parsed = accountCreateSchema.safeParse(body);
    if (!parsed.success) {
      return setErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
    }
    try {
      await save.mutateAsync({ id: account?.id, body: parsed.data });
      toast.success(account ? 'Account updated' : 'Account added');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function toggleArchive() {
    if (!account) return;
    try {
      await save.mutateAsync({ id: account.id, body: { active: !account.active } });
      toast.success(account.active ? 'Account archived' : 'Account restored');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function onDelete() {
    if (!account) return;
    try {
      await remove.mutateAsync(account.id);
      toast.success('Account deleted');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Name" htmlFor="acct-name" error={errors.name}>
        <Input
          id="acct-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus={!account}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor="acct-type">
          <Select
            id="acct-type"
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bank" htmlFor="acct-bank">
          <Select
            id="acct-bank"
            value={bank}
            onChange={(e) => setBank(e.target.value as Bank | '')}
          >
            <option value="">None</option>
            {BANKS.map((b) => (
              <option key={b} value={b}>
                {BANK_LABELS[b]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Last 4 digits (optional)" htmlFor="acct-last4" error={errors.last4}>
        <Input
          id="acct-last4"
          inputMode="numeric"
          maxLength={4}
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={isCard ? 'Outstanding on' : 'Opening balance'}
          htmlFor="acct-opening"
          error={errors.openingBalancePaise}
        >
          <Input
            id="acct-opening"
            inputMode="decimal"
            placeholder="0"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
        </Field>
        <Field label="As of" htmlFor="acct-opening-date" error={errors.openingBalanceDate}>
          <Input
            id="acct-opening-date"
            type="date"
            value={openingDate}
            onChange={(e) => setOpeningDate(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Color">
        <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={cn(
                'size-11 rounded-full border-4',
                color === c ? 'border-foreground' : 'border-transparent',
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </Field>
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-card px-4 pt-3 pb-1">
        <Button type="submit" disabled={save.isPending}>
          {account ? 'Save changes' : 'Add account'}
        </Button>
        {account && (
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => void toggleArchive()}>
              {account.active ? 'Archive' : 'Restore'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-expense"
              disabled={account.txnCount > 0}
              title={
                account.txnCount > 0 ? 'Accounts with transactions can only be archived' : undefined
              }
              onClick={() => void onDelete()}
            >
              Delete
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
