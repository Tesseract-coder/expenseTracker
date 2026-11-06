import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { HomePage } from '@/features/home/HomePage';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './NotFoundPage';

// Every screen except Home is code-split, so the first load only parses what Home needs
// (Phase 6 Lighthouse pass). The chunks are precached by the service worker.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const TransactionsPage = page(
  () => import('@/features/transactions/TransactionsPage'),
  'TransactionsPage',
);
const AddPage = page(() => import('@/features/add/AddPage'), 'AddPage');
const MorePage = page(() => import('@/features/more/MorePage'), 'MorePage');
const AccountsPage = page(() => import('@/features/accounts/AccountsPage'), 'AccountsPage');
const CategoriesPage = page(() => import('@/features/categories/CategoriesPage'), 'CategoriesPage');
const InboxPage = page(() => import('@/features/categorize/InboxPage'), 'InboxPage');

// Import screens are code-split; the spreadsheet parser loads only when a file is chosen.
const ImportPage = lazy(() =>
  import('@/features/import/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const PasteAlertsPage = lazy(() =>
  import('@/features/import/PasteAlertsPage').then((m) => ({ default: m.PasteAlertsPage })),
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
const BackupPage = lazy(() =>
  import('@/features/more/BackupPage').then((m) => ({ default: m.BackupPage })),
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
      {
        path: 'transactions',
        element: lazyPage(<TransactionsPage />),
        handle: { title: 'Transactions' },
      },
      { path: 'add', element: lazyPage(<AddPage />), handle: { title: 'Add transaction' } },
      { path: 'reports', element: lazyPage(<ReportsPage />), handle: { title: 'Reports' } },
      { path: 'more', element: lazyPage(<MorePage />), handle: { title: 'More' } },
      { path: 'more/accounts', element: lazyPage(<AccountsPage />), handle: { title: 'Accounts' } },
      {
        path: 'more/categories',
        element: lazyPage(<CategoriesPage />),
        handle: { title: 'Categories' },
      },
      { path: 'inbox', element: lazyPage(<InboxPage />), handle: { title: 'Needs labelling' } },
      {
        path: 'more/rules',
        element: lazyPage(<RulesPage />),
        handle: { title: 'Rules & learned labels' },
      },
      { path: 'more/payees', element: lazyPage(<PayeesPage />), handle: { title: 'Payees' } },
      { path: 'import', element: lazyPage(<ImportPage />), handle: { title: 'Import statement' } },
      {
        path: 'import/sms',
        element: lazyPage(<PasteAlertsPage />),
        handle: { title: 'Paste bank SMS' },
      },
      {
        path: 'more/imports',
        element: lazyPage(<ImportsHistoryPage />),
        handle: { title: 'Import history' },
      },
      {
        path: 'more/backup',
        element: lazyPage(<BackupPage />),
        handle: { title: 'Backup & restore' },
      },
      { path: '*', element: <NotFoundPage />, handle: { title: 'Not found' } },
    ],
  },
];

export const router = createBrowserRouter(routes);
