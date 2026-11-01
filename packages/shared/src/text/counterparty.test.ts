import { describe, expect, it } from 'vitest';
import { cleanDisplayName, counterpartyKey } from './counterparty';

describe('counterpartyKey', () => {
  it.each([
    ['Swiggy', 'swiggy'],
    ['SWIGGY PVT. LTD.', 'swiggy'],
    ['Swiggy Limited', 'swiggy'],
    ['  Ramesh   Kirana Store ', 'ramesh kirana store'],
    ['The Bombay Canteen', 'bombay canteen'],
    ['Acme Tech Pvt Ltd - Salary', 'acme tech salary'],
    ['swiggy.instamart@ybl', 'swiggy.instamart@ybl'],
    ['Paytm-QR@PAYTM', 'paytm-qr@paytm'],
    ['7-Eleven', 'eleven'],
    ['123', '123'],
    ['Ltd', 'ltd'],
  ])('%j -> %j', (input, key) => expect(counterpartyKey(input)).toBe(key));
});

describe('cleanDisplayName', () => {
  it('collapses whitespace', () =>
    expect(cleanDisplayName('  Ramesh   Kirana ')).toBe('Ramesh Kirana'));
});
