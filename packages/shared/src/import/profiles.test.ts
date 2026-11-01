import { describe, expect, it } from 'vitest';
import {
  BANK_PROFILES,
  detectProfile,
  getProfile,
  guessGenericMapping,
  normalizeHeader,
} from './profiles';

describe('profiles', () => {
  it('normalizes headers', () => {
    expect(normalizeHeader('Withdrawal Amt.')).toBe('withdrawalamt');
    expect(normalizeHeader('Amount (in Rs)')).toBe('amountinrs');
  });

  it('has unique ids and covers the five banks for savings and cards', () => {
    expect(new Set(BANK_PROFILES.map((p) => p.id)).size).toBe(BANK_PROFILES.length);
    for (const bank of ['hdfc', 'icici', 'sbi', 'axis', 'kotak']) {
      expect(
        BANK_PROFILES.filter((p) => p.bank === bank)
          .map((p) => p.accountType)
          .sort(),
      ).toEqual(['credit_card', 'savings']);
    }
    expect(getProfile('hdfc_cc_v1')?.label).toContain('HDFC');
    expect(getProfile('nope')).toBeUndefined();
  });

  it('returns null when nothing matches, and the generic guess helps the wizard', () => {
    const grid = [
      ['Some bank'],
      ['Posting Date', 'Details', 'Debit Amount', 'Credit Amount', 'Balance'],
      ['01/10/2026', 'X', '10', '', '90'],
    ];
    expect(detectProfile(grid)).toBeNull();
    const guess = guessGenericMapping(grid);
    expect(guess?.mapping).toMatchObject({
      headerRow: 1,
      dateCol: 0,
      narrationCols: [1],
      amount: { kind: 'debit_credit', debitCol: 2, creditCol: 3 },
      balanceCol: 4,
    });
    expect(guessGenericMapping([['a', 'b']])).toBeNull();
  });

  it('uses the account hint to break ties between similar layouts', () => {
    const grid = [
      ['Date', 'Transaction Details', 'Amount', 'Type'],
      ['01/10/2026', 'X', '10', 'D'],
    ];
    expect(detectProfile(grid, { bank: 'sbi', accountType: 'credit_card' })?.profile.id).toBe(
      'sbi_cc_v1',
    );
  });
});
