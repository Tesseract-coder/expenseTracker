import { describe, expect, it } from 'vitest';
import { type AlertAccount, alertToRow, matchAlertAccount } from './match';
import { parseAlert, type ParsedAlert } from './parse';

const acc = (
  id: string,
  last4: string | null,
  bank: AlertAccount['bank'],
  type: AlertAccount['type'],
  active = true,
): AlertAccount => ({ id, last4, bank, type, active });

const ACCOUNTS = [
  acc('hdfc-sav', '1234', 'hdfc', 'savings'),
  acc('hdfc-cc', '5678', 'hdfc', 'credit_card'),
  acc('icici-sav', '0123', 'icici', 'savings'),
  acc('icici-cc', '9123', 'icici', 'credit_card'),
  acc('sbi-sav', '1234', 'sbi', 'savings'),
  acc('old', '7777', 'axis', 'savings', false),
  acc('cash', null, 'other', 'cash'),
];

describe('matchAlertAccount', () => {
  it.each([
    ['no digits', { last4: null, bank: 'hdfc', cardHint: null }, null],
    ['unique last4', { last4: '5678', bank: null, cardHint: 'credit' }, 'hdfc-cc'],
    [
      'same last4 at two banks → bank decides',
      { last4: '1234', bank: 'sbi', cardHint: null },
      'sbi-sav',
    ],
    ['same last4, bank unknown → ambiguous', { last4: '1234', bank: null, cardHint: null }, null],
    [
      '3-digit ICICI mask, card hint picks the card',
      { last4: '123', bank: 'icici', cardHint: 'credit' },
      'icici-cc',
    ],
    [
      '3-digit ICICI mask, account alert picks savings',
      { last4: '123', bank: 'icici', cardHint: null },
      'icici-sav',
    ],
    [
      'debit card spends hit the bank account',
      { last4: '1234', bank: 'hdfc', cardHint: 'debit' },
      'hdfc-sav',
    ],
    ['inactive accounts ignored', { last4: '7777', bank: 'axis', cardHint: null }, null],
    ['unknown digits', { last4: '4444', bank: 'hdfc', cardHint: null }, null],
  ] as const)('%s', (_n, alert, expected) => {
    expect(matchAlertAccount(alert, ACCOUNTS)).toBe(expected);
  });
});

describe('alertToRow', () => {
  it('maps to the statement-row shape with a 1-based source row', () => {
    const a = parseAlert(
      'Sent Rs.5.50 From HDFC Bank A/C *1234 To CHAI On 01/11/26 Ref 412345678901',
      4,
      {
        fallbackDate: '2026-11-02',
      },
    ) as ParsedAlert;
    expect(alertToRow(a)).toEqual({
      txnDate: '2026-11-01',
      valueDate: null,
      narration: 'UPI/DR/412345678901/CHAI',
      refNo: '412345678901',
      amountPaise: 550,
      direction: 'out',
      balancePaise: null,
      sourceRow: 5,
    });
  });
});
