import { describe, expect, it } from 'vitest';
import { normalizeNarration } from '../categorize/normalize';
import {
  isParsedAlert,
  MAX_ALERTS,
  type ParsedAlert,
  parseAlert,
  parseAlerts,
  splitAlerts,
} from './parse';

const TODAY = '2026-11-02';
const opts = { fallbackDate: TODAY };

type Expect = Partial<Omit<ParsedAlert, 'index' | 'raw'>>;

// Real-looking alerts (numbers and names changed). One row per bank/format we know of.
const CASES: [string, string, Expect][] = [
  [
    'HDFC UPI sent',
    'Sent Rs.500.00 From HDFC Bank A/C *1234 To SWIGGY On 01/11/26 Ref 412345678901 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808',
    {
      amountPaise: 50000,
      direction: 'out',
      txnDate: '2026-11-01',
      last4: '1234',
      bank: 'hdfc',
      channel: 'upi',
      payee: 'SWIGGY',
      refNo: '412345678901',
      narration: 'UPI/DR/412345678901/SWIGGY',
    },
  ],
  [
    'HDFC UPI debited to VPA',
    'Dear Customer, Rs.649.00 has been debited from account **1234 to VPA netflix.upi@hdfcbank NETFLIX on 30-10-26. Your UPI transaction reference number is 430312345678. If you did not authorize this transaction, please report it immediately by calling 18002586161.',
    {
      amountPaise: 64900,
      direction: 'out',
      txnDate: '2026-10-30',
      last4: '1234',
      vpa: 'netflix.upi@hdfcbank',
      payee: 'NETFLIX',
      refNo: '430312345678',
      channel: 'upi',
    },
  ],
  [
    'HDFC salary credit (NEFT info kept)',
    'Update! INR 85,000.00 deposited in HDFC Bank A/c XX1234 on 31-OCT-26 for NEFT Cr-HDFC0000123-ACME TECH PVT LTD-SALARY OCT.Avl bal INR 1,23,456.78. Cheque deposits in A/C are subject to clearing',
    {
      amountPaise: 8500000,
      direction: 'in',
      txnDate: '2026-10-31',
      last4: '1234',
      channel: 'neft',
      balancePaise: 12345678,
      narration: 'NEFT Cr-HDFC0000123-ACME TECH PVT LTD-SALARY OCT',
    },
  ],
  [
    'HDFC credit card spend',
    'Spent Rs.1,299.00 On HDFC Bank Card 5678 At AMAZON PAY IN On 2026-11-01:10:15:22.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 5678 to 7308080808',
    {
      amountPaise: 129900,
      direction: 'out',
      txnDate: '2026-11-01',
      last4: '5678',
      cardHint: 'credit',
      channel: 'card',
      payee: 'AMAZON PAY IN',
      narration: 'POS AMAZON PAY IN',
    },
  ],
  [
    'ICICI UPI debit (3-digit mask)',
    'ICICI Bank Acct XX123 debited for Rs 250.00 on 01-Nov-26; ZOMATO LTD credited. UPI:430598765432. Call 18002662 for dispute. SMS BLOCK 123 to 9215676766.',
    {
      amountPaise: 25000,
      direction: 'out',
      txnDate: '2026-11-01',
      last4: '123',
      bank: 'icici',
      payee: 'ZOMATO LTD',
      refNo: '430598765432',
      channel: 'upi',
    },
  ],
  [
    'ICICI credit card spend with limit',
    'INR 2,450.00 spent using ICICI Bank Card XX9012 on 28-Oct-26 on DMART AVENUE. Avl Limit: INR 97,550.00. If not you, call 1800 2662/SMS BLOCK 9012 to 9215676766.',
    {
      amountPaise: 245000,
      direction: 'out',
      txnDate: '2026-10-28',
      last4: '9012',
      cardHint: 'credit',
      payee: 'DMART AVENUE',
      balancePaise: null,
      channel: 'card',
    },
  ],
  [
    'SBI UPI debit (bare amount)',
    'Dear UPI user A/C X4321 debited by 120.0 on date 01Nov26 trf to CHAI POINT Refno 430611112222. If not u? call 1800111109. -SBI',
    {
      amountPaise: 12000,
      direction: 'out',
      txnDate: '2026-11-01',
      last4: '4321',
      bank: 'sbi',
      payee: 'CHAI POINT',
      refNo: '430611112222',
    },
  ],
  [
    'SBI UPI credit',
    'Dear SBI UPI User, ur A/cX4321 credited by Rs2000 on 29Oct26 by (Ref no 430233334444)',
    {
      amountPaise: 200000,
      direction: 'in',
      txnDate: '2026-10-29',
      last4: '4321',
      refNo: '430233334444',
      payee: null,
    },
  ],
  [
    'SBI ATM',
    'Dear Customer, Rs.2000 withdrawn at SBI ATM S1CN000123 from A/cX4321 on 01Nov26 Transaction Number 1234. Available Balance Rs.10,500.50. If not withdrawn by you, call 1800111109.',
    {
      amountPaise: 200000,
      direction: 'out',
      channel: 'atm',
      last4: '4321',
      balancePaise: 1050050,
      payee: null,
      narration: 'ATM WDL',
    },
  ],
  [
    'Axis debit with UPI info string',
    'INR 340.00 debited A/c no. XX7788 01-11-26 10:15:22 UPI/P2M/430712345678/BLINKIT Not you? SMS BLOCKUPI Cust ID to 919951860002 Axis Bank',
    {
      amountPaise: 34000,
      direction: 'out',
      txnDate: '2026-11-01',
      last4: '7788',
      bank: 'axis',
      refNo: '430712345678',
      narration: 'UPI/P2M/430712345678/BLINKIT',
    },
  ],
  [
    'Axis credit',
    'INR 1,500.00 credited to A/c no. XX7788 on 30-10-26 at 18:02:11 IST. Info- UPI/P2A/430799990000/RAMESH K. Avl Bal- INR 22,010.00 - Axis Bank',
    {
      amountPaise: 150000,
      direction: 'in',
      txnDate: '2026-10-30',
      balancePaise: 2201000,
      narration: 'UPI/P2A/430799990000/RAMESH',
    },
  ],
  [
    'Kotak UPI sent',
    'Sent Rs.199.00 from Kotak Bank AC X5566 to spotify@axl on 31-10-26.UPI Ref 430455556666. Not you, https://kotak.com/KBANKT/Fraud',
    {
      amountPaise: 19900,
      direction: 'out',
      txnDate: '2026-10-31',
      last4: '5566',
      bank: 'kotak',
      vpa: 'spotify@axl',
      refNo: '430455556666',
      narration: 'UPI/DR/430455556666/spotify@axl',
    },
  ],
  [
    'Kotak UPI received',
    'Received Rs.750.00 in your Kotak Bank AC X5566 from mom@okhdfcbank on 30-10-26.UPI Ref:430477778888.',
    {
      amountPaise: 75000,
      direction: 'in',
      vpa: 'mom@okhdfcbank',
      payee: null,
      refNo: '430477778888',
    },
  ],
  [
    'Debit card POS',
    'Rs.860.00 spent on your HDFC Bank Debit Card ending 1234 at HP PETROL PUMP on 01-11-2026 18:20.',
    { cardHint: 'debit', last4: '1234', channel: 'card', payee: 'HP PETROL PUMP' },
  ],
  [
    'Refund on card',
    'Refund of Rs 299.00 has been credited to your ICICI Bank Credit Card XX9012 from MYNTRA on 31-Oct-26.',
    { direction: 'in', cardHint: 'credit', payee: 'MYNTRA', last4: '9012' },
  ],
  [
    'NACH SIP debit',
    'Rs.5,000.00 debited from HDFC Bank A/c XX1234 on 05-10-26 towards NACH-ZERODHA BROKING. Avl bal: INR 45,000.00',
    { direction: 'out', channel: 'nach', payee: 'NACH-ZERODHA BROKING', balancePaise: 4500000 },
  ],
  [
    'No date uses fallback',
    'Rs 45 debited from A/c XX1234 to swiggy@icici',
    { txnDate: TODAY, dateFromText: false, vpa: 'swiggy@icici' },
  ],
  [
    'Future date falls back',
    'Rs 45 debited from A/c XX1234 on 01-12-29 to BAKERY',
    { txnDate: TODAY, dateFromText: false, payee: 'BAKERY' },
  ],
  [
    'Rupee sign and lakh grouping',
    '₹1,00,000 transferred to your PPF account from A/c XX1234 on 02-11-26',
    { amountPaise: 10000000, direction: 'out' },
  ],
];

describe('parseAlert', () => {
  it.each(CASES)('%s', (_name, text, expected) => {
    const r = parseAlert(text, 0, opts);
    expect(isParsedAlert(r), JSON.stringify(r)).toBe(true);
    expect(r).toMatchObject(expected);
  });

  it.each([
    ['otp', 'Your OTP for txn of Rs 500 at AMAZON is 123456. Do not share. -HDFC Bank'],
    ['request', 'swiggy@ybl has requested money from you on Google Pay. Rs 150. Approve in app'],
    ['reminder', 'Rs.649 will be debited from your A/c XX1234 on 05-11-26 for NETFLIX e-mandate'],
    ['reminder', 'Your HDFC Bank Credit Card statement generated. Total Amt Due Rs 12,345'],
    ['failed', 'Txn of Rs 500 on HDFC Bank Card 5678 at AMAZON declined due to incorrect PIN'],
    ['promo', 'Pre-approved loan of Rs 5,00,000 credited instantly! Apply now. T&C'],
    ['no_amount', 'Your A/c XX1234 has been debited. Thank you for banking with us.'],
    ['no_direction', 'Rs 500 at AMAZON on 01-11-26 A/c XX1234'],
  ])('skips %s', (reason, text) => {
    const r = parseAlert(text, 3, opts);
    expect(r).toEqual({ index: 3, raw: text, reason });
  });

  it('builds narrations the statement normalizer understands', () => {
    const r = parseAlert(CASES[0]?.[1] as string, 0, opts) as ParsedAlert;
    expect(normalizeNarration(r.narration)).toMatchObject({
      channel: 'upi',
      payee: 'Swiggy',
      counterpartyKey: 'swiggy',
      refNo: '412345678901',
    });
    const v = parseAlert(CASES[11]?.[1] as string, 0, opts) as ParsedAlert;
    expect(normalizeNarration(v.narration).counterpartyKey).toBe('spotify@axl');
  });

  it('falls back to generic narrations', () => {
    expect((parseAlert('Rs 10 credited to A/c XX1234', 0, opts) as ParsedAlert).narration).toBe(
      'CREDIT ALERT',
    );
    expect((parseAlert('Rs 10 spent on Card XX1234', 0, opts) as ParsedAlert).narration).toBe(
      'POS CARD PURCHASE',
    );
    expect(
      (parseAlert('Rs 10 sent via IMPS from A/c XX1234', 0, opts) as ParsedAlert).narration,
    ).toBe('IMPS DR');
  });
});

describe('splitAlerts / parseAlerts', () => {
  it('splits on blank lines and joins wrapped lines', () => {
    expect(splitAlerts('Sent Rs.5 From A/C *1\nTo X On 01/11/26\n\n\nhello\n')).toEqual([
      'Sent Rs.5 From A/C *1 To X On 01/11/26',
      'hello',
    ]);
  });

  it('splits one message per line when each line is an alert', () => {
    const text = [
      'Sent Rs.10 From A/C *1234 To A On 01/11/26',
      'Received Rs.20 in your AC X1234 from B on 01-11-26',
      'continued text',
      'Rs 30 debited from A/c XX1234',
    ].join('\n');
    expect(splitAlerts(text)).toEqual([
      'Sent Rs.10 From A/C *1234 To A On 01/11/26',
      'Received Rs.20 in your AC X1234 from B on 01-11-26 continued text',
      'Rs 30 debited from A/c XX1234',
    ]);
  });

  it('separates parsed and skipped messages, keeping indices', () => {
    const r = parseAlerts(`${CASES[0]?.[1]}\n\nYour OTP is 123456\n\n${CASES[4]?.[1]}`, opts);
    expect(r.alerts.map((a) => a.index)).toEqual([0, 2]);
    expect(r.skipped).toEqual([{ index: 1, raw: 'Your OTP is 123456', reason: 'otp' }]);
  });

  it('caps the number of messages', () => {
    const many = Array.from({ length: MAX_ALERTS + 5 }, (_, i) => `msg ${i}`).join('\n\n');
    expect(splitAlerts(many)).toHaveLength(MAX_ALERTS);
  });
});
