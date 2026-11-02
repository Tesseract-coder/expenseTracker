import { useSearchParams } from 'react-router';
import { Chip } from '@/components/ui/chip';
import { BudgetsTab } from './BudgetsTab';
import { HealthTab } from './HealthTab';
import { PeriodBar } from './PeriodBar';
import { RecurringTab } from './RecurringTab';
import { ReportTab } from './ReportTab';
import { TrendsTab } from './TrendsTab';
import { WhenTab } from './WhenTab';
import { WhereTab } from './WhereTab';

const TABS = [
  { id: 'health', label: 'Health', el: <HealthTab /> },
  { id: 'trends', label: 'Trends', el: <TrendsTab /> },
  { id: 'when', label: 'When', el: <WhenTab /> },
  { id: 'where', label: 'Where', el: <WhereTab /> },
  { id: 'budgets', label: 'Budgets', el: <BudgetsTab /> },
  { id: 'recurring', label: 'Recurring', el: <RecurringTab /> },
  { id: 'report', label: 'Report', el: <ReportTab /> },
] as const;

/** Reports: one filter row (period + accounts) above every tab; the tab lives in the URL. */
export function ReportsPage() {
  const [sp, setSp] = useSearchParams();
  const current = TABS.find((t) => t.id === sp.get('tab')) ?? TABS[0];
  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Reports"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        data-print-hide
      >
        {TABS.map((t) => (
          <Chip
            key={t.id}
            role="tab"
            aria-selected={current.id === t.id}
            selected={current.id === t.id}
            onClick={() =>
              setSp(
                (prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('tab', t.id);
                  return next;
                },
                { replace: true },
              )
            }
          >
            {t.label}
          </Chip>
        ))}
      </div>
      {current.id !== 'recurring' && <PeriodBar />}
      <div role="tabpanel" aria-label={current.label}>
        {current.el}
      </div>
    </div>
  );
}
