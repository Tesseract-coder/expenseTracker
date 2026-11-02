import { reportSheets, type SummaryResponse, toCsv, transactionRows } from '@kharcha/shared';
import { fetchExport, type TxnFilters } from '@/app/queries';

function download(data: BlobPart, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const filters = (f: TxnFilters) =>
  Object.fromEntries(
    Object.entries(f).map(([k, v]) => [
      k,
      Array.isArray(v) ? v.join(',') : v === undefined ? undefined : String(v),
    ]),
  ) as Record<string, string | undefined>;

/** Report workbook (Summary, By category, By counterparty, Transactions), built in the browser. */
export async function downloadReportXlsx(input: {
  title: string;
  fileName: string;
  from: string;
  to: string;
  accountIds: string[];
  summary: SummaryResponse;
  categoryName: (id: string) => string;
}): Promise<{ truncated: boolean }> {
  const [data, { writeXlsx }] = await Promise.all([
    fetchExport({
      from: input.from,
      to: input.to,
      accountIds: input.accountIds.length ? input.accountIds.join(',') : undefined,
      withPayees: 'true',
    }),
    import('@kharcha/shared/spreadsheet'),
  ]);
  const sheets = reportSheets({ ...input, byCounterparty: data.byCounterparty, rows: data.rows });
  download(writeXlsx(sheets), XLSX_TYPE, input.fileName);
  return { truncated: data.truncated };
}

/** The current transaction list (with its filters) as CSV or XLSX. */
export async function downloadTransactions(
  f: TxnFilters,
  format: 'csv' | 'xlsx',
): Promise<{ count: number; truncated: boolean }> {
  const data = await fetchExport(filters(f));
  const rows = transactionRows(data.rows);
  const name = `kharcha-transactions-${new Date().toISOString().slice(0, 10)}`;
  if (format === 'csv') {
    download(toCsv(rows), 'text/csv;charset=utf-8', `${name}.csv`);
  } else {
    const { writeXlsx } = await import('@kharcha/shared/spreadsheet');
    download(
      writeXlsx([{ name: 'Transactions', rows, moneyColumns: [8, 9] }]),
      XLSX_TYPE,
      `${name}.xlsx`,
    );
  }
  return { count: data.rows.length, truncated: data.truncated };
}
