import { createBrowserRouter } from 'react-router';
import { AddPage } from '@/features/add/AddPage';
import { HomePage } from '@/features/home/HomePage';
import { MorePage } from '@/features/more/MorePage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { TransactionsPage } from '@/features/transactions/TransactionsPage';
import { AppLayout } from './AppLayout';
import { NotFoundPage } from './NotFoundPage';

export const routes = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage />, handle: { title: 'Kharcha' } },
      { path: 'transactions', element: <TransactionsPage />, handle: { title: 'Transactions' } },
      { path: 'add', element: <AddPage />, handle: { title: 'Add transaction' } },
      { path: 'reports', element: <ReportsPage />, handle: { title: 'Reports' } },
      { path: 'more', element: <MorePage />, handle: { title: 'More' } },
      { path: '*', element: <NotFoundPage />, handle: { title: 'Not found' } },
    ],
  },
];

export const router = createBrowserRouter(routes);
