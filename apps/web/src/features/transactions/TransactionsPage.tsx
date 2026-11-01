import { List } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';

export function TransactionsPage() {
  return (
    <EmptyState icon={List} title="No transactions">
      Your transactions, grouped by day, will appear here.
    </EmptyState>
  );
}
