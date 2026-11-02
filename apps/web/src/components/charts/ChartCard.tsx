import { Table2, BarChart3 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface LegendItem {
  label: string;
  color: string;
}

/** Legend: colored mark beside text-token text (text never wears the series color). */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul
      className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
      aria-label="Legend"
    >
      {items.map((i) => (
        <li key={i.label} className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: i.color }}
          />
          <span className="truncate">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

export interface TableView {
  columns: string[];
  rows: ReactNode[][];
}

/**
 * Chart container: title, optional legend, and a table-view twin (every chart has one, so no value
 * is gated behind hover or color).
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  className,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: LegendItem[];
  table?: TableView;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1" data-print-hide>
          {action}
          {table && (
            <button
              type="button"
              onClick={() => setAsTable(!asTable)}
              aria-pressed={asTable}
              aria-label={asTable ? `Show ${title} as chart` : `Show ${title} as table`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              {asTable ? (
                <BarChart3 aria-hidden className="size-4" />
              ) : (
                <Table2 aria-hidden className="size-4" />
              )}
            </button>
          )}
        </div>
      </div>
      {legend && legend.length > 1 && !asTable && <Legend items={legend} />}
      {asTable && table ? (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                {table.columns.map((c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={cn('py-1.5 pr-2 font-medium', i > 0 && 'text-right')}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border tabular-nums">
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j} className={cn('py-1.5 pr-2', j > 0 && 'text-right')}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </Card>
  );
}
