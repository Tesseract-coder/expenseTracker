import { describe, expect, it } from 'vitest';
import { type ColumnMapping, columnMappingSchema, parseGrid } from './mapping';

const base: ColumnMapping = {
  headerRow: 0,
  dateCol: 0,
  valueDateCol: null,
  narrationCols: [1],
  refCol: null,
  balanceCol: null,
  amount: { kind: 'signed', amountCol: 2, negativeIs: 'out' },
  dateOrder: 'dmy',
};

describe('parseGrid', () => {
  it('parses signed amounts in either convention', () => {
    const grid = [
      ['Date', 'Desc', 'Amount'],
      ['01/10/2026', 'Coffee', '-150'],
      ['02/10/2026', 'Refund', '150'],
    ];
    expect(parseGrid(grid, base).rows.map((r) => r.direction)).toEqual(['out', 'in']);
    const flipped = parseGrid(grid, {
      ...base,
      amount: { kind: 'signed', amountCol: 2, negativeIs: 'in' },
    });
    expect(flipped.rows.map((r) => r.direction)).toEqual(['in', 'out']);
  });

  it('joins multiple narration columns, appends wrapped lines, and reports bad dates', () => {
    const grid = [
      ['Date', 'A', 'B', 'Amount'],
      ['01/10/2026', 'UPI', 'SWIGGY', '-1'],
      ['', 'continued', '', ''],
      ['garbage', 'Something', 'odd', '-5'],
    ];
    const r = parseGrid(grid, {
      ...base,
      narrationCols: [1, 2],
      amount: { kind: 'signed', amountCol: 3, negativeIs: 'out' },
    });
    expect(r.rows[0]?.narration).toBe('UPI SWIGGY continued');
    expect(r.errors).toEqual([{ sourceRow: 4, message: 'Unrecognized date "garbage"' }]);
  });

  it('uses Dr/Cr suffix when the type column is empty, else the default direction', () => {
    const grid = [
      ['Date', 'Desc', 'Amount', 'Type'],
      ['01/10/2026', 'Purchase', '100.00', ''],
      ['02/10/2026', 'Payment', '100.00 Cr', ''],
      ['03/10/2026', 'Reversal', '5.00', 'CR'],
    ];
    const r = parseGrid(grid, {
      ...base,
      amount: { kind: 'amount_with_type', amountCol: 2, typeCol: 3, defaultDirection: 'out' },
    });
    expect(r.rows.map((x) => x.direction)).toEqual(['out', 'in', 'in']);
  });

  it('reads signed balances and finds the closing balance for newest-first statements', () => {
    const grid = [
      ['Date', 'Desc', 'Dr', 'Cr', 'Bal'],
      ['03/10/2026', 'Latest', '10', '', '-90.00'],
      ['01/10/2026', 'Oldest', '', '100', '100.00 Cr'],
    ];
    const r = parseGrid(grid, {
      ...base,
      balanceCol: 4,
      amount: { kind: 'debit_credit', debitCol: 2, creditCol: 3 },
    });
    expect(r.closingBalancePaise).toBe(-9000);
    expect(r).toMatchObject({ from: '2026-10-01', to: '2026-10-03' });
  });

  it('skips rows with no amount and handles empty statements', () => {
    expect(parseGrid([['Date', 'Desc', 'Amount']], base)).toEqual({
      rows: [],
      errors: [],
      skipped: 0,
      from: null,
      to: null,
      closingBalancePaise: null,
    });
    const r = parseGrid(
      [
        ['Date', 'Desc', 'Amount'],
        ['01/10/2026', 'Opening balance', ''],
        ['', '', ''],
        ['Total', '', '-100'],
      ],
      base,
    );
    expect(r).toMatchObject({ rows: [], skipped: 2, errors: [] });
  });

  it('validates mappings', () => {
    expect(columnMappingSchema.safeParse({ ...base, narrationCols: [] }).success).toBe(false);
    expect(columnMappingSchema.safeParse(base).success).toBe(true);
  });
});
