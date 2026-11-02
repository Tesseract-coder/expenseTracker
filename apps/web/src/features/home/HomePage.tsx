import { ChevronRight, Inbox, Tags, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useAccounts, useCategoryMap, useInboxCount, useTransactions } from '@/app/queries';
import { EmptyState } from '@/components/EmptyState';
import { Money } from '@/components/Money';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AccountBalance } from '@/features/accounts/AccountsPage';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { Dashboard } from './Dashboard';
import { useTransactionSheet } from '@/features/transactions/TransactionSheet';

export function HomePage() {
  const accounts = useAccounts();
  const recent = useTransactions({}, 5);
  const { byId: categoriesById } = useCategoryMap();
  const { openEdit } = useTransactionSheet();
  const inboxCount = useInboxCount();
  const active = (accounts.data ?? []).filter((a) => a.active);
  const accountsById = useMemo(
    () => new Map((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data],
  );
  const netWorth = active.reduce((sum, a) => sum + a.balancePaise, 0);
  const recentRows = recent.data?.pages[0]?.transactions ?? [];

  return (
    <div className="flex flex-col gap-4">
      {(inboxCount.data ?? 0) > 0 && (
        <Link
          to="/inbox"
          className="flex min-h-14 items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <Tags aria-hidden className="size-5" />
          <span className="flex-1">
            {inboxCount.data} transaction{inboxCount.data === 1 ? '' : 's'} need labelling
          </span>
          <ChevronRight aria-hidden className="size-5" />
        </Link>
      )}

      <Dashboard />

      <Card>
        <CardHeader>
          <CardTitle>Net balance across accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.isPending ? (
            <Skeleton className="h-8 w-40" />
          ) : (
            <Money paise={netWorth} className="text-2xl font-semibold" />
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="accounts-heading">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="accounts-heading" className="text-sm font-semibold">
            Accounts
          </h2>
          <Link
            to="/more/accounts"
            className="inline-flex min-h-11 items-center text-sm text-primary"
          >
            Manage <ChevronRight aria-hidden className="size-4" />
          </Link>
        </div>
        {accounts.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : active.length === 0 ? (
          <EmptyState icon={Wallet} title="No accounts" />
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {active.map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/transactions?accountIds=${a.id}`}
                    className="flex min-h-14 items-center gap-3 px-4"
                  >
                    <span
                      aria-hidden
                      className="size-3 rounded-full"
                      style={{ backgroundColor: a.color ?? '#64748b' }}
                    />
                    <span className="flex-1 truncate text-sm">{a.name}</span>
                    <AccountBalance account={a} className="text-sm" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="recent-heading">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="recent-heading" className="text-sm font-semibold">
            Recent transactions
          </h2>
          <Link
            to="/transactions"
            className="inline-flex min-h-11 items-center text-sm text-primary"
          >
            See all <ChevronRight aria-hidden className="size-4" />
          </Link>
        </div>
        {recent.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : recentRows.length === 0 ? (
          <EmptyState icon={Inbox} title="No transactions yet">
            Tap + to add your first expense or income.
          </EmptyState>
        ) : (
          <ul>
            {recentRows.map((t) => (
              <TransactionRow
                key={t.id}
                txn={t}
                categoriesById={categoriesById}
                accountsById={accountsById}
                onOpen={openEdit}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
