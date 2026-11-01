import { useEffect } from 'react';
import { Navigate } from 'react-router';
import { useTransactionSheet } from '@/features/transactions/TransactionSheet';

/** Deep link (e.g. PWA shortcut): open the add sheet over the transaction list. */
export function AddPage() {
  const { openAdd } = useTransactionSheet();
  useEffect(() => openAdd(), [openAdd]);
  return <Navigate to="/transactions" replace />;
}
