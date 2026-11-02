import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { AddPage } from '@/features/add/AddPage';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { CategoriesPage } from '@/features/categories/CategoriesPage';
import { InboxPage } from '@/features/categorize/InboxPage';
import { HomePage } from '@/features/home/HomePage';
import { MorePage } from '@/features/more/MorePage';
import { TransactionsPage } from '@/features/transactions/TransactionsPage';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './NotFoundPage';

// Import screens are code-split; the spreadsheet parser loads only when a file is chosen.
const ImportPage = lazy(() =>
  import('@/features/import/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const ImportsHistoryPage = lazy(() =>
  import('@/features/import/ImportsHistoryPage').then((m) => ({ default: m.ImportsHistoryPage })),
);
// Reports (and Recharts) load only when opened.
const ReportsPage = lazy(() =>
  import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const RulesPage = lazy(() =>
  import('@/features/categorize/RulesPage').then((m) => ({ default: m.RulesPage })),
);
const PayeesPage = lazy(() =>
  import('@/features/categorize/PayeesPage').then((m) => ({ default: m.PayeesPage })),
);
const lazyPage = (el: React.ReactNode) => (
  <Suspense fallback={<Skeleton className="h-40 w-full" />}>{el}</Suspense>
);

export const routes = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage />, handle: { title: 'Kharcha' } },
      { path: 'transactions', element: <TransactionsPage />, handle: { title: 'Transactions' } },
      { path: 'add', element: <AddPage />, handle: { title: 'Add transaction' } },
      { path: 'reports', element: lazyPage(<ReportsPage />), handle: { title: 'Reports' } },
      { path: 'more', element: <MorePage />, handle: { title: 'More' } },
      { path: 'more/accounts', element: <AccountsPage />, handle: { title: 'Accounts' } },
      { path: 'more/categories', element: <CategoriesPage />, handle: { title: 'Categories' } },
      { path: 'inbox', element: <InboxPage />, handle: { title: 'Needs labelling' } },
      {
        path: 'more/rules',
        element: lazyPage(<RulesPage />),
        handle: { title: 'Rules & learned labels' },
      },
      { path: 'more/payees', element: lazyPage(<PayeesPage />), handle: { title: 'Payees' } },
      { path: 'import', element: lazyPage(<ImportPage />), handle: { title: 'Import statement' } },
      {
        path: 'more/imports',
        element: lazyPage(<ImportsHistoryPage />),
        handle: { title: 'Import history' },
      },
      { path: '*', element: <NotFoundPage />, handle: { title: 'Not found' } },
    ],
  },
];

export const router = createBrowserRouter(routes);
