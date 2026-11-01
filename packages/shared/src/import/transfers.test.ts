import { describe, expect, it } from 'vitest';
import { findTransferPairs, singleLegHint, type TransferCandidate } from './transfers';

const t = (key: string, o: Partial<TransferCandidate>): TransferCandidate => ({
  key,
  accountId: 'hdfc',
  accountType: 'savings',
  txnDate: '2026-10-05',
  amountPaise: 1850000,
  direction: 'out',
  narration: null,
  ...o,
});

describe('findTransferPairs', () => {
  it('pairs a bank debit with a card credit as a card bill payment', () => {
    const pairs = findTransferPairs(
      [
        t('d', { narration: 'CC 000485498XXXXXX4321 AUTOPAY SI-TAD' }),
        t('c', {
          accountId: 'card',
          accountType: 'credit_card',
          direction: 'in',
          txnDate: '2026-10-07',
          narration: 'PAYMENT RECEIVED, THANK YOU',
        }),
      ],
      { card: '4321' },
    );
    expect(pairs).toEqual([
      expect.objectContaining({
        outKey: 'd',
        inKey: 'c',
        kind: 'cc_bill_payment',
        confidence: 'high',
      }),
    ]);
    expect(pairs[0]?.reason).toContain('2 days apart');
  });

  it('pairs savings → savings as a self transfer, medium confidence without evidence', () => {
    const pairs = findTransferPairs([
      t('d', { amountPaise: 2000000, txnDate: '2026-10-15' }),
      t('c', { accountId: 'kotak', amountPaise: 2000000, direction: 'in', txnDate: '2026-10-16' }),
    ]);
    expect(pairs).toEqual([
      expect.objectContaining({ kind: 'self_transfer', confidence: 'medium' }),
    ]);
  });

  it.each([
    ['same account', t('c', { direction: 'in' })],
    ['different amount', t('c', { accountId: 'kotak', direction: 'in', amountPaise: 1 })],
    ['too far apart', t('c', { accountId: 'kotak', direction: 'in', txnDate: '2026-10-08' })],
  ])('does not pair %s', (_n, credit) => {
    expect(findTransferPairs([t('d', {}), credit])).toEqual([]);
  });

  it('never treats card debits as transfers out', () => {
    expect(
      findTransferPairs([
        t('d', { accountType: 'credit_card' }),
        t('c', { accountId: 'kotak', direction: 'in' }),
      ]),
    ).toEqual([]);
  });

  it('assigns one-to-one, preferring evidence, then closer dates', () => {
    const pairs = findTransferPairs(
      [
        t('d1', { txnDate: '2026-10-05' }),
        t('d2', { txnDate: '2026-10-06', narration: 'IMPS SELF KOTAK XX5678' }),
        t('c', { accountId: 'kotak', direction: 'in', txnDate: '2026-10-05' }),
      ],
      { kotak: '5678' },
    );
    expect(pairs).toEqual([
      expect.objectContaining({ outKey: 'd2', inKey: 'c', confidence: 'high' }),
    ]);
  });
});

describe('singleLegHint', () => {
  const own = [
    { last4: '1234', accountType: 'savings' as const },
    { last4: '4321', accountType: 'credit_card' as const },
  ];
  it.each([
    [t('x', { narration: 'INB HDFC CREDIT CARD BILL PAYMENT' }), 'cc_bill_payment'],
    [t('x', { narration: 'CRED CLUB PAYMENT' }), 'cc_bill_payment'],
    [t('x', { narration: 'CC 000485498XXXXXX4321 AUTOPAY SI-TAD' }), 'cc_bill_payment'],
    [t('x', { narration: 'BILLPAY XXXXXXXX4321' }), 'cc_bill_payment'],
    [
      t('x', { accountType: 'credit_card', direction: 'in', narration: 'BBPS PAYMENT RECEIVED' }),
      'cc_bill_payment',
    ],
    [t('x', { narration: 'IMPS-427511112222-SELF-HDFC XX1234' }), 'self_transfer'],
    [t('x', { direction: 'in', narration: 'IMPS FROM XX1234' }), 'self_transfer'],
  ])('%#: hints %s', (c, kind) => {
    expect(singleLegHint(c, own)?.kind).toBe(kind);
  });

  it.each([
    t('x', { narration: 'SWIGGY LIMITED' }),
    t('x', { accountType: 'credit_card', direction: 'in', narration: 'REFUND AMAZON' }),
    t('x', { accountType: 'credit_card', narration: 'MERCHANT 1234' }),
    t('x', { narration: 'REF 51234 ORDER' }),
  ])('no hint for %#', (c) => expect(singleLegHint(c, own)).toBeNull());
});
