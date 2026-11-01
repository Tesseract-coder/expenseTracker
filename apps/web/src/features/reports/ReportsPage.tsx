import { ChartPie } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';

export function ReportsPage() {
  return (
    <EmptyState icon={ChartPie} title="Reports">
      Trends, heatmaps and your financial health score arrive in Phase 4.
    </EmptyState>
  );
}
