import { describe, expect, it } from 'vitest';
import { type PdfTextItem, pdfPagesToGrid } from './pdfLayout';

/** One text item; width ≈ 4.4pt per character (8pt Helvetica-ish). */
const t = (str: string, x: number, y: number, align: 'left' | 'right' = 'left'): PdfTextItem => {
  const width = str.length * 4.4;
  return { str, x: align === 'right' ? x - width : x, y, width, height: 8 };
};

const HEADER = (y: number) => [
  t('Date', 40, y),
  t('Narration', 90, y),
  t('Debit', 380, y, 'right'),
  t('Credit', 450, y, 'right'),
  t('Balance', 540, y, 'right'),
];
const row = (y: number, date: string, narr: string, dr: string, cr: string, bal: string) => [
  t(date, 40, y),
  t(narr, 90, y),
  ...(dr ? [t(dr, 380, y, 'right')] : []),
  ...(cr ? [t(cr, 450, y, 'right')] : []),
  t(bal, 540, y, 'right'),
];

describe('pdfPagesToGrid', () => {
  it('maps cells to header columns and keeps preamble lines as single cells', () => {
    const grid = pdfPagesToGrid([
      {
        items: [
          t('SAMPLE BANK', 40, 40),
          ...HEADER(80),
          ...row(95, '01/10/2026', 'UPI/SWIGGY', '450.00', '', '9,550.00'),
          ...row(107, '02/10/2026', 'SALARY', '', '50,000.00', '59,550.00'),
          t('Page 1 of 2', 280, 820),
        ],
      },
    ]);
    expect(grid).toEqual([
      ['SAMPLE BANK', '', '', '', ''],
      ['Date', 'Narration', 'Debit', 'Credit', 'Balance'],
      ['01/10/2026', 'UPI/SWIGGY', '450.00', '', '9,550.00'],
      ['02/10/2026', 'SALARY', '', '50,000.00', '59,550.00'],
    ]);
  });

  it('reuses the columns on pages without a header and keeps repeated headers', () => {
    const grid = pdfPagesToGrid([
      { items: [...HEADER(80), ...row(95, '01/10/2026', 'ONE', '1.00', '', '9.00')] },
      { items: [...row(40, '02/10/2026', 'TWO', '2.00', '', '7.00')] },
      { items: [...HEADER(40), ...row(55, '03/10/2026', 'THREE', '3.00', '', '4.00')] },
    ]);
    expect(grid.map((r) => r[1])).toEqual(['Narration', 'ONE', 'TWO', 'Narration', 'THREE']);
  });

  it('joins word-wrapped narrations with a space', () => {
    const grid = pdfPagesToGrid([
      {
        items: [
          ...HEADER(80),
          ...row(95, '01/10/2026', 'NEFT CR ACME TECH', '', '100.00', '100.00'),
          t('PRIVATE LIMITED', 90, 104),
          ...row(116, '02/10/2026', 'POS DMART', '5.00', '', '95.00'),
        ],
      },
    ]);
    expect(grid[1]?.[1]).toBe('NEFT CR ACME TECH PRIVATE LIMITED');
    expect(grid).toHaveLength(3);
  });

  it('joins fixed-width (mid-word) wraps without a space', () => {
    const items = [...HEADER(80)];
    const narrs = [
      ['UPI-SWIGGY LIMITED-SWIG', 'GY@YBL-427512345678'],
      ['UPI-ZOMATO LIMITED-ZOMA', 'TO@HDFCBANK'],
      ['UPI-CHAI POINT-CHAIWAL', 'A@PAYTM'], // 22 chars: ended on a (trimmed) space
    ];
    let y = 95;
    narrs.forEach(([a, b], i) => {
      items.push(...row(y, `0${i + 1}/10/2026`, a as string, '1.00', '', '9.00'));
      items.push(t(b as string, 90, y + 9));
      y += 22;
    });
    const grid = pdfPagesToGrid([{ items }]);
    expect(grid.slice(1).map((r) => r[1])).toEqual([
      'UPI-SWIGGY LIMITED-SWIGGY@YBL-427512345678',
      'UPI-ZOMATO LIMITED-ZOMATO@HDFCBANK',
      'UPI-CHAI POINT-CHAIWAL A@PAYTM',
    ]);
  });

  it('does not treat a distant text line as a wrapped cell', () => {
    const grid = pdfPagesToGrid([
      {
        items: [
          ...HEADER(80),
          ...row(95, '01/10/2026', 'ONE', '1.00', '', '9.00'),
          t('Computer generated statement', 90, 160),
        ],
      },
    ]);
    expect(grid.at(-1)?.[1]).toBe('Computer generated statement');
    expect(grid[1]?.[1]).toBe('ONE');
  });

  it('merges a two-line header and splits tight labels pdf.js merged into one item', () => {
    const grid = pdfPagesToGrid([
      {
        items: [
          t('S No. Transaction', 40, 80),
          t('Remarks', 150, 80),
          t('Value Dt Withdrawal Amt.', 300, 80),
          t('Balance', 540, 80, 'right'),
          t('Date', 63, 89),
          t('(INR)', 540, 89, 'right'),
          t('1', 40, 104),
          t('01/10/2026', 63, 104),
          t('UPI/ZOMATO', 150, 104),
          // value date and amount merged by pdf.js into one item
          { str: '01/10/2026 612.00', x: 300, y: 104, width: 105, height: 8 },
          t('9,388.00', 540, 104, 'right'),
        ],
      },
    ]);
    expect(grid[0]).toEqual([
      'S No.',
      'Transaction Date',
      'Remarks',
      'Value Dt',
      'Withdrawal Amt.',
      'Balance (INR)',
    ]);
    expect(grid[1]).toEqual(['1', '01/10/2026', 'UPI/ZOMATO', '01/10/2026', '612.00', '9,388.00']);
  });

  it('splits merged amount cells but keeps narration text together', () => {
    const grid = pdfPagesToGrid([
      {
        items: [
          ...HEADER(80),
          t('01/10/2026', 40, 95),
          { str: 'UPI/LONG MERCHANT NAME PAID VIA APP', x: 90, y: 95, width: 260, height: 8 },
          { str: '450.00 9,550.00', x: 352, y: 95, width: 190, height: 8 },
        ],
      },
    ]);
    expect(grid[1]).toEqual([
      '01/10/2026',
      'UPI/LONG MERCHANT NAME PAID VIA APP',
      '450.00',
      '',
      '9,550.00',
    ]);
  });

  it('falls back to column gaps when there is no header', () => {
    const items: PdfTextItem[] = [t('Statement', 40, 40)];
    let y = 80;
    for (const [d, n, a] of [
      ['01/10/2026', 'UPI SWIGGY', '450.00'],
      ['02/10/2026', 'POS DMART', '1,200.00'],
      ['03/10/2026', 'NEFT SALARY', '50,000.00'],
    ] as const) {
      items.push(t(d, 40, y), t(n, 120, y), t(a, 400, y, 'right'));
      y += 12;
    }
    const grid = pdfPagesToGrid([{ items }]);
    expect(grid.slice(1)).toEqual([
      ['01/10/2026', 'UPI SWIGGY', '450.00'],
      ['02/10/2026', 'POS DMART', '1,200.00'],
      ['03/10/2026', 'NEFT SALARY', '50,000.00'],
    ]);
  });

  it('returns plain lines when neither a header nor columns can be found', () => {
    expect(pdfPagesToGrid([{ items: [t('Hello', 40, 40), t(' ', 80, 40)] }])).toEqual([['Hello']]);
    expect(pdfPagesToGrid([])).toEqual([]);
  });
});
