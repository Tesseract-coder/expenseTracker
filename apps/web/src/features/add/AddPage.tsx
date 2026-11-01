import { Plus } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';

export function AddPage() {
  return (
    <EmptyState icon={Plus} title="Quick add">
      The one-hand add-transaction sheet arrives in Phase 1.
    </EmptyState>
  );
}
