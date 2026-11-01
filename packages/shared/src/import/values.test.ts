import { describe, expect, it } from 'vitest';
import { detectDateOrder, parseStatementAmount, parseStatementDate, parseTypeCell } from './values';

describe('parseStatementDate', () => {
  it.each([
    ['01/10/26', '2026-10-01'],
    ['1/10/2026', '2026-10-01'],
    ['01-10-2026', '2026-10-01'],
    ['01.10.2026', '2026-10-01'],
    ['31/12/99', '1999-12-31'],
    ['01/01/70', '1970-01-01'],
    ['01/01/69', '2069-01-01'],
    ['1 Oct 2026', '2026-10-01'],
    ['01-OCT-2026', '2026-10-01'],
    ['01 Oct 26', '2026-10-01'],
    ['01Oct2026', '2026-10-01'],
    ['01 Sept 2026', '2026-09-01'],
    ['Oct 01, 2026', '2026-10-01'],
    ['01/10/2026 10:15:32', '2026-10-01'],
    ['2026-10-01', '2026-10-01'],
    ['2026-10-01T00:00:00', '2026-10-01'],
    ['2026/10/01', '2026-10-01'],
    ['46296', '2026-10-01'],
    ['  01/10/26 ', '2026-10-01'],
  ])('%j -> %s', (raw, iso) => expect(parseStatementDate(raw)).toBe(iso));

  it.each([
    '',
    'Narration',
    '31/02/2026',
    '13/13/2026',
    '01 Foo 2026',
    'Foo 01, 2026',
    '12345',
    '1234567',
    '50,000.00',
    '********',
  ])('rejects %j', (raw) => expect(parseStatementDate(raw)).toBeNull());

  it('honours month-first and year-first orders', () => {
    expect(parseStatementDate('10/01/2026', 'mdy')).toBe('2026-10-01');
    expect(parseStatementDate('26/10/01', 'ymd')).toBe('2026-10-01');
  });
});

describe('detectDateOrder', () => {
  it('prefers day-first and falls back when impossible', () => {
    expect(detectDateOrder(['01/10/2026', '13/10/2026'])).toBe('dmy');
    expect(detectDateOrder(['10/13/2026', '10/01/2026'])).toBe('mdy');
    expect(detectDateOrder(['26/10/31'])).toBe('dmy');
    expect(detectDateOrder(['99/99/99'])).toBe('dmy');
    expect(detectDateOrder([])).toBe('dmy');
  });
});

describe('parseStatementAmount', () => {
  it.each([
    ['1,23,456.78', { paise: 12345678, sign: null }],
    ['450.5', { paise: 45050, sign: null }],
    ['20', { paise: 2000, sign: null }],
    ['0.00', { paise: 0, sign: null }],
    ['-500.00', { paise: 50000, sign: 'negative' }],
    ['(500.00)', { paise: 50000, sign: 'negative' }],
    ['1,859.00 Cr', { paise: 185900, sign: 'cr' }],
    ['1,859.00CR', { paise: 185900, sign: 'cr' }],
    ['250.00 Dr.', { paise: 25000, sign: 'dr' }],
    ['Dr 250.00', { paise: 25000, sign: 'dr' }],
    ['₹ 1,000', { paise: 100000, sign: null }],
    ['INR 99.99', { paise: 9999, sign: null }],
    ['1234.5000000001', { paise: 123450, sign: null }],
    ['+12.00', { paise: 1200, sign: null }],
  ])('%j', (raw, expected) => expect(parseStatementAmount(raw)).toEqual(expected));

  it.each(['', '-', '--', 'abc', '12a', 'Cr', '1.2.3', '9'.repeat(25)])('rejects %j', (raw) =>
    expect(parseStatementAmount(raw)).toBeNull(),
  );
});

describe('parseTypeCell', () => {
  it.each([
    ['Dr', 'out'],
    ['DEBIT', 'out'],
    ['D', 'out'],
    ['cr', 'in'],
    ['Credit', 'in'],
    ['C', 'in'],
    ['', null],
    ['X', null],
  ])('%j -> %j', (raw, dir) => expect(parseTypeCell(raw)).toBe(dir));
});
