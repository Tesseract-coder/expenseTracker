import { describe, expect, it } from 'vitest';
import { formatINR, formatINRCompact, parseRupeesToPaise, signedPaise } from './money';

describe('parseRupeesToPaise', () => {
  it.each([
    ['0', 0],
    ['1', 100],
    ['1.5', 150],
    ['1.05', 105],
    ['.5', 50],
    ['1,23,456.78', 12345678],
    ['123456.78', 12345678],
    ['₹ 99', 9900],
    ['Rs. 12.50', 1250],
    ['rs 7', 700],
    ['INR 1,000', 100000],
    ['-250.25', -25025],
    ['  42  ', 4200],
    ['10.', 1000],
  ])('parses %j -> %d', (input, expected) => {
    expect(parseRupeesToPaise(input)).toBe(expected);
  });

  it.each(['', 'abc', '1.234', '1..2', '₹', '.', '12a', '9'.repeat(20)])('rejects %j', (input) => {
    expect(parseRupeesToPaise(input)).toBeNull();
  });
});

describe('formatINR', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [100, '₹1.00'],
    [99999, '₹999.99'],
    [100000, '₹1,000.00'],
    [12345678, '₹1,23,456.78'],
    [1234567890, '₹1,23,45,678.90'],
    [-12345678, '-₹1,23,456.78'],
  ])('formats %d -> %s', (paise, expected) => {
    expect(formatINR(paise)).toBe(expected);
  });

  it('supports compact zero paise and no symbol', () => {
    expect(formatINR(150000, { compactZeroPaise: true })).toBe('₹1,500');
    expect(formatINR(150050, { compactZeroPaise: true })).toBe('₹1,500.50');
    expect(formatINR(150000, { symbol: false })).toBe('1,500.00');
  });

  it('rejects non-integers', () => {
    expect(() => formatINR(1.5)).toThrow(RangeError);
  });
});

describe('formatINRCompact', () => {
  it.each([
    [95000, '₹950'],
    [1230000, '₹12.3K'],
    [45000000, '₹4.5L'],
    [1200000000, '₹1.2Cr'],
    [-45000000, '-₹4.5L'],
    [100000, '₹1K'],
  ])('formats %d -> %s', (paise, expected) => {
    expect(formatINRCompact(paise)).toBe(expected);
  });
});

describe('signedPaise', () => {
  it('signs by direction', () => {
    expect(signedPaise(500, 'in')).toBe(500);
    expect(signedPaise(500, 'out')).toBe(-500);
  });
});
