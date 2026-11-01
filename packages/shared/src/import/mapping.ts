import { z } from 'zod';
import { type DateOrder, parseStatementAmount, parseStatementDate, parseTypeCell } from './values';

export type Grid = string[][];

const col = z.number().int().min(0).max(200);

export const amountMappingSchema = z.discriminatedUnion('kind', [
  /** Separate withdrawal/deposit columns (most savings accounts). */
  z.object({ kind: z.literal('debit_credit'), debitCol: col, creditCol: col }),
  /** One amount column plus an optional Dr/Cr column; else a Cr/Dr suffix in the amount; else defaultDirection. */
  z.object({
    kind: z.literal('amount_with_type'),
    amountCol: col,
    typeCol: col.nullable(),
    defaultDirection: z.enum(['in', 'out']),
  }),
  /** One signed amount column. */
  z.object({ kind: z.literal('signed'), amountCol: col, negativeIs: z.enum(['in', 'out']) }),
]);

export const columnMappingSchema = z.object({
  headerRow: z.number().int().min(0).max(500),
  dateCol: col,
  valueDateCol: col.nullable(),
  narrationCols: z.array(col).min(1).max(5),
  refCol: col.nullable(),
  balanceCol: col.nullable(),
  amount: amountMappingSchema,
  dateOrder: z.enum(['dmy', 'mdy', 'ymd']),
});
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export interface ParsedRow {
  txnDate: string;
  valueDate: string | null;
  narration: string;
  refNo: string | null;
  amountPaise: number;
  direction: 'in' | 'out';
  balancePaise: number | null;
  /** 1-based row number in the source sheet, for error messages and audits. */
  sourceRow: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: { sourceRow: number; message: string }[];
  skipped: number;
  from: string | null;
  to: string | null;
  /** Balance after the chronologically last transaction, if the statement has a balance column. */
  closingBalancePaise: number | null;
}

const SUMMARY_WORDS =
  /(opening\s*balance|closing\s*balance|statement\s*summary|total|grand\s*total|b\/f|c\/f|brought\s*forward|carried\s*forward|generated\s*on|page\s*\d|end\s*of\s*statement|\*{3,})/i;

/** Everything after these markers is a summary block (totals, counts), never transactions. */
const FOOTER_MARKER = /^(statement\s*summary|end\s*of\s*statement|\*+\s*end\s*of)/i;

/** Dated rows that are statement furniture, not transactions (anchored to the narration start). */
const SUMMARY_NARRATION =
  /^(transaction\s*total|total\b|grand\s*total|opening\s*balance|closing\s*balance|balance\s*(b\/f|c\/f|brought|carried))/i;

/** Banks pad missing references with zeros or dashes; those must not look like real refs. */
function cleanRef(raw: string): string | null {
  const v = raw.trim();
  if (!v || /^[0\-\s.]+$/.test(v)) return null;
  return v.slice(0, 64);
}

const cell = (row: string[] | undefined, i: number | null | undefined) =>
  i === null || i === undefined ? '' : (row?.[i] ?? '').toString().trim();

function amountOf(
  row: string[],
  m: ColumnMapping,
): { paise: number; direction: 'in' | 'out' } | null {
  const a = m.amount;
  if (a.kind === 'debit_credit') {
    const dr = parseStatementAmount(cell(row, a.debitCol));
    const cr = parseStatementAmount(cell(row, a.creditCol));
    if (dr && dr.paise > 0) return { paise: dr.paise, direction: 'out' };
    if (cr && cr.paise > 0) return { paise: cr.paise, direction: 'in' };
    return null;
  }
  const parsed = parseStatementAmount(cell(row, a.amountCol));
  if (!parsed || parsed.paise === 0) return null;
  if (a.kind === 'signed') {
    const negative = parsed.sign === 'negative';
    return {
      paise: parsed.paise,
      direction: negative ? a.negativeIs : a.negativeIs === 'out' ? 'in' : 'out',
    };
  }
  const typed = a.typeCol === null ? null : parseTypeCell(cell(row, a.typeCol));
  const fromSign = parsed.sign === 'cr' ? 'in' : parsed.sign === 'dr' ? 'out' : null;
  return { paise: parsed.paise, direction: typed ?? fromSign ?? a.defaultDirection };
}

function balanceOf(row: string[], m: ColumnMapping): number | null {
  if (m.balanceCol === null) return null;
  const b = parseStatementAmount(cell(row, m.balanceCol));
  if (!b) return null;
  return b.sign === 'negative' || b.sign === 'dr' ? -b.paise : b.paise;
}

/** Apply a column mapping to a sheet. Pure and deterministic; never throws on bad rows. */
export function parseGrid(grid: Grid, m: ColumnMapping): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseResult['errors'] = [];
  let skipped = 0;
  const header = (grid[m.headerRow] ?? []).map((c) => c.trim().toLowerCase()).join('|');
  const usedCols = [m.dateCol, ...m.narrationCols, m.refCol, m.balanceCol, m.valueDateCol].filter(
    (x): x is number => x !== null,
  );

  for (let i = m.headerRow + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const sourceRow = i + 1;
    const joined = row
      .map((c) => (c ?? '').toString().trim())
      .filter(Boolean)
      .join(' ');
    if (!joined) continue; // blank line
    if (row.map((c) => c.trim().toLowerCase()).join('|') === header) continue; // repeated page header
    if (FOOTER_MARKER.test(joined)) break;

    const rawDate = cell(row, m.dateCol);
    const txnDate = parseStatementDate(rawDate, m.dateOrder);
    const narration = m.narrationCols
      .map((c) => cell(row, c))
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ');
    const amount = amountOf(row, m);

    if (!txnDate) {
      const prev = rows.at(-1);
      // Wrapped narration: no date, no amount, text in the narration column → belongs to previous row.
      if (!rawDate && !amount && narration && prev && prev.sourceRow >= sourceRow - 3) {
        prev.narration = `${prev.narration} ${narration}`.slice(0, 500);
        continue;
      }
      if (!amount || SUMMARY_WORDS.test(joined) || !usedCols.some((c) => cell(row, c))) {
        skipped++;
        continue;
      }
      errors.push({ sourceRow, message: `Unrecognized date "${rawDate.slice(0, 30)}"` });
      continue;
    }
    if (!amount || SUMMARY_NARRATION.test(narration)) {
      skipped++; // e.g. dated "Opening balance" / "Transaction total" rows
      continue;
    }
    rows.push({
      txnDate,
      valueDate: parseStatementDate(cell(row, m.valueDateCol), m.dateOrder),
      narration: narration.slice(0, 500),
      refNo: cleanRef(cell(row, m.refCol)),
      amountPaise: amount.paise,
      direction: amount.direction,
      balancePaise: balanceOf(row, m),
      sourceRow,
    });
  }

  const dates = rows.map((r) => r.txnDate).sort();
  let closing: number | null = null;
  if (rows.length > 0) {
    // Statements are either oldest-first or newest-first; the closing balance is on the latest row.
    const first = rows[0] as ParsedRow;
    const last = rows.at(-1) as ParsedRow;
    const latest = first.txnDate > last.txnDate ? first : last;
    closing = latest.balancePaise;
  }
  return {
    rows,
    errors,
    skipped,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    closingBalancePaise: closing,
  };
}

export type { DateOrder };
