import { Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useCategoryMap, useSummary, useWhere } from '@/app/queries';
import { Money } from '@/components/Money';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { formatPct } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { downloadReportXlsx } from './exporting';

/** Monthly/yearly statement: printable (browser print → PDF) and downloadable as XLSX. */
export function ReportTab() {
  const period = usePeriod();
  const summary = useSummary(period.params);
  const where = useWhere(period.params);
  const { byId } = useCategoryMap();
  const [busy, setBusy] = useState(false);
  const s = summary.data;
  const title = `Kharcha report — ${period.label}`;
  const name = (id: string) => byId.get(id)?.name ?? 'Category';

  const xlsx = async () => {
    if (!s) return;
    setBusy(true);
    try {
      const r = await downloadReportXlsx({
        title,
        fileName: `kharcha-report-${period.range.from}-to-${period.range.to}.xlsx`,
        from: period.range.from,
        to: period.range.to,
        accountIds: period.accountIds,
        summary: s,
        categoryName: name,
      });
      toast.success(
        r.truncated ? 'Report downloaded (first 20,000 transactions)' : 'Report downloaded',
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <Skeleton className="h-64 w-full" />;
  const t = s.totals;
  const rows: [string, number, number | undefined][] = [
    ['Income', t.income, s.previous?.income],
    ['Spend', t.spend, s.previous?.spend],
    ['  Needs', t.needs, s.previous?.needs],
    ['  Wants', t.wants, s.previous?.wants],
    ['  Uncategorized', t.unclassified, s.previous?.unclassified],
    ['Invested', t.invested, s.previous?.invested],
    ['Net savings', t.netSavings, s.previous?.netSavings],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2" data-print-hide>
        <Button onClick={() => void xlsx()} disabled={busy}>
          <Download aria-hidden className="size-4" /> {busy ? 'Preparing…' : 'Download XLSX'}
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" /> Print / PDF
        </Button>
      </div>

      <Card className="flex flex-col gap-4 p-4">
        <header>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">
            {period.range.from} to {period.range.to} · transfers between your accounts excluded
          </p>
        </header>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 text-left font-medium">
                Summary
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                This period
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Previous
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {rows.map(([label, cur, prev]) => (
              <tr key={label}>
                <td className="py-1.5 whitespace-pre">{label}</td>
                <td className="py-1.5 text-right">
                  <Money paise={cur} />
                </td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {prev === undefined ? '—' : <Money paise={prev} />}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-1.5">Savings rate</td>
              <td className="py-1.5 text-right" data-money>
                {formatPct(t.savingsRate, 1)}
              </td>
              <td className="py-1.5 text-right text-muted-foreground" data-money>
                {formatPct(s.previous?.savingsRate ?? null, 1)}
              </td>
            </tr>
          </tbody>
        </table>

        <section>
          <h3 className="mb-1 text-sm font-semibold">By category</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border tabular-nums">
              {s.byCategory
                .filter((c) => c.spend !== 0)
                .map((c) => (
                  <tr key={c.categoryId}>
                    <td className="max-w-40 truncate py-1.5">{name(c.categoryId)}</td>
                    <td className="py-1.5 text-right">
                      <Money paise={c.spend} />
                    </td>
                    <td className="w-14 py-1.5 text-right text-xs text-muted-foreground">
                      {t.spend > 0 ? formatPct(c.spend / t.spend) : ''}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>

        {where.data && where.data.topCounterparties.length > 0 && (
          <section data-print-break>
            <h3 className="mb-1 text-sm font-semibold">Top payees</h3>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border tabular-nums">
                {where.data.topCounterparties.map((c) => (
                  <tr key={c.id}>
                    <td className="max-w-40 truncate py-1.5">{c.name}</td>
                    <td className="py-1.5 text-right text-xs text-muted-foreground">{c.count}×</td>
                    <td className="py-1.5 text-right">
                      <Money paise={c.spend} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </Card>
    </div>
  );
}
