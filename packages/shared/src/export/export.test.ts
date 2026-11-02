import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { ExportRow, SummaryResponse } from '../reports/schemas';
import { writeXlsx } from '../spreadsheet';
import { reportSheets, safeCell, toCsv, transactionRows } from './index';

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  date: '2026-10-05',
  account: 'HDFC',
  payee: 'DMart',
  narration: 'POS 4111 DMART',
  category: 'Grocery',
  group: 'Household / Essentials',
  type: 'expense_need',
  direction: 'out',
  amountPaise: 156050,
  tags: 'home',
  note: null,
  ...over,
});

const totals = {
  income: 10_000_000,
  spend: 3_750_000,
  needs: 3_300_000,
  wants: 350_000,
  unclassified: 100_000,
  invested: 1_000_000,
  netSavings: 6_250_000,
  savingsRate: 0.625,
  uncategorizedIncome: 0,
};
const summary: SummaryResponse = {
  totals,
  previous: null,
  byGroup: [],
  byCategory: [{ categoryId: 'c1', groupId: 'g1', spend: 800_000, previous: 0 }],
  trend: { granularity: 'day', points: [] },
};

describe('safeCell', () => {
  it.each([
    ['=HYPERLINK("x")', `'=HYPERLINK("x")`],
    ['+91 98', `'+91 98`],
    ['-cmd', `'-cmd`],
    ['@SUM(A1)', `'@SUM(A1)`],
    ['\tx', `'\tx`],
    ['DMart', 'DMart'],
  ])('%j', (v, e) => expect(safeCell(v)).toBe(e));
  it('leaves numbers and null alone', () => {
    expect(safeCell(-5)).toBe(-5);
    expect(safeCell(null)).toBeNull();
  });
});

describe('toCsv', () => {
  it('quotes, escapes, guards formulas and adds a BOM', () => {
    expect(toCsv([['a,b', 'say "hi"', null, 12.5, '=1+1']])).toBe(
      '﻿"a,b","say ""hi""",,12.5,\'=1+1\r\n',
    );
  });
});

describe('transactionRows', () => {
  it('converts paise to rupees with a signed column', () => {
    const rows = transactionRows([row(), row({ direction: 'in', amountPaise: 50_000 })]);
    expect(rows[0]?.[8]).toBe('Amount (₹)');
    expect(rows[1]?.slice(8, 10)).toEqual([1560.5, -1560.5]);
    expect(rows[2]?.slice(8, 10)).toEqual([500, 500]);
  });
});

describe('reportSheets + writeXlsx', () => {
  it('builds the four report sheets and a readable workbook', () => {
    const sheets = reportSheets({
      title: 'Kharcha report — October 2026',
      from: '2026-10-01',
      to: '2026-10-31',
      summary,
      categoryName: () => 'Grocery',
      byCounterparty: [{ name: '=evil', spend: 100, count: 1 }],
      rows: [row()],
    });
    expect(sheets.map((s) => s.name)).toEqual([
      'Summary',
      'By category',
      'By counterparty',
      'Transactions',
    ]);
    expect(sheets[0]?.rows).toContainEqual(['Savings rate', '62.5%', null]);

    const wb = XLSX.read(writeXlsx(sheets), { type: 'array', cellNF: true });
    expect(wb.SheetNames).toEqual(['Summary', 'By category', 'By counterparty', 'Transactions']);
    const cp = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['By counterparty']!);
    expect(cp[0]).toMatchObject({ Payee: "'=evil", 'Spend (₹)': 1 });
    const tx = wb.Sheets.Transactions!;
    expect(tx.I2?.v).toBe(1560.5);
    expect(tx.I2?.z).toBe('#,##0.00');
    expect(
      reportSheets({
        title: 't',
        from: 'a',
        to: 'b',
        summary: { ...summary, previous: { ...totals, savingsRate: null } },
        categoryName: () => 'x',
        byCounterparty: [],
        rows: [],
      })[0]?.rows,
    ).toContainEqual(['Savings rate', '62.5%', null]);
  });
});
