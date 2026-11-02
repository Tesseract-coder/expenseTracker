import type { ExportRow, SummaryResponse } from '../reports/schemas';

/**
 * Pure builders for XLSX/CSV exports. Cells are plain values; `writeXlsx` (in
 * `@kharcha/shared/spreadsheet`, browser only) turns sheets into a workbook.
 */
export type Cell = string | number | null;
export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Column indexes holding rupee amounts (formatted as numbers with 2 decimals). */
  moneyColumns?: number[];
}

/**
 * Neutralizes spreadsheet formula injection: text starting with = + - @ (or tab/CR) would be
 * executed by Excel/Sheets. Bank narrations are untrusted input, so every text cell is guarded.
 */
export function safeCell(v: Cell): Cell {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

const rupees = (paise: number) => Math.round(paise) / 100;

function csvField(v: Cell): string {
  const s = v === null ? '' : String(safeCell(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens ₹ and non-ASCII names correctly. */
export function toCsv(rows: Cell[][]): string {
  return `\uFEFF${rows.map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;
}

export const TRANSACTION_HEADER = [
  'Date',
  'Account',
  'Payee',
  'Narration',
  'Category',
  'Group',
  'Type',
  'Direction',
  'Amount (₹)',
  'Signed amount (₹)',
  'Tags',
  'Note',
];

export function transactionRows(rows: ExportRow[]): Cell[][] {
  return [
    TRANSACTION_HEADER,
    ...rows.map((r) => [
      r.date,
      r.account,
      r.payee,
      r.narration,
      r.category,
      r.group,
      r.type,
      r.direction,
      rupees(r.amountPaise),
      rupees(r.direction === 'in' ? r.amountPaise : -r.amountPaise),
      r.tags,
      r.note,
    ]),
  ];
}

export interface ReportWorkbookInput {
  title: string;
  from: string;
  to: string;
  summary: SummaryResponse;
  categoryName: (id: string) => string;
  byCounterparty: { name: string; spend: number; count: number }[];
  rows: ExportRow[];
}

/** Sheets for the monthly/yearly report (spec §7.7): Summary, By category, By counterparty, Transactions. */
export function reportSheets(input: ReportWorkbookInput): Sheet[] {
  const t = input.summary.totals;
  const p = input.summary.previous;
  const line = (label: string, cur: number, prev: number | undefined): Cell[] => [
    label,
    rupees(cur),
    prev === undefined ? null : rupees(prev),
  ];
  return [
    {
      name: 'Summary',
      moneyColumns: [1, 2],
      rows: [
        [input.title],
        [`${input.from} to ${input.to}`],
        [],
        ['', 'This period (₹)', p ? 'Previous period (₹)' : null],
        line('Income', t.income, p?.income),
        line('Spend (needs + wants)', t.spend, p?.spend),
        line('  Needs', t.needs, p?.needs),
        line('  Wants', t.wants, p?.wants),
        line('  Uncategorized spend', t.unclassified, p?.unclassified),
        line('Invested', t.invested, p?.invested),
        line('Net savings', t.netSavings, p?.netSavings),
        [
          'Savings rate',
          t.savingsRate === null ? null : `${(t.savingsRate * 100).toFixed(1)}%`,
          p?.savingsRate == null ? null : `${(p.savingsRate * 100).toFixed(1)}%`,
        ],
        [],
        ['Transfers between your own accounts are excluded.'],
      ],
    },
    {
      name: 'By category',
      moneyColumns: [1, 2],
      rows: [
        ['Category', 'Spend (₹)', 'Previous (₹)'],
        ...input.summary.byCategory.map((c) => [
          input.categoryName(c.categoryId),
          rupees(c.spend),
          rupees(c.previous),
        ]),
      ],
    },
    {
      name: 'By counterparty',
      moneyColumns: [1],
      rows: [
        ['Payee', 'Spend (₹)', 'Transactions'],
        ...input.byCounterparty.map((c) => [c.name, rupees(c.spend), c.count]),
      ],
    },
    { name: 'Transactions', moneyColumns: [8, 9], rows: transactionRows(input.rows) },
  ];
}
