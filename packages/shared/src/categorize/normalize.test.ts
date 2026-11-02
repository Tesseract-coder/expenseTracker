import { describe, expect, it } from 'vitest';
import type { AccountType } from '../schemas/enums';
import { detectChannel, keywordWords, normalizeNarration } from './normalize';

type Row = [
  narration: string,
  expected: {
    channel: string;
    payee: string | null;
    key: string | null;
    vpa?: string | null;
    ifsc?: string | null;
    ref?: string | null;
    remark?: string | null;
  },
  accountType?: AccountType,
];

// Real-looking narrations for every supported bank (and the fixtures in /fixtures).
const CASES: Row[] = [
  // ---- UPI, slash formats (SBI / ICICI / Axis / Kotak)
  [
    'UPI/DR/412345678901/SWIGGY LIMITED/YESB/swiggy.instamart@ybl/Payment',
    {
      channel: 'upi',
      payee: 'Swiggy',
      key: 'swiggy.instamart@ybl',
      vpa: 'swiggy.instamart@ybl',
      ifsc: 'YESB',
      ref: '412345678901',
      remark: null,
    },
  ],
  [
    'UPI/P2A/427512340000/MOM/HDFC/mom@okhdfcbank/gift',
    { channel: 'upi', payee: 'Mom', key: 'mom@okhdfcbank', ifsc: 'HDFC', remark: 'GIFT' },
  ],
  [
    'TO TRANSFER-UPI/DR/427512345678/RAMESH K/SBIN/ramesh.k@okaxis/veg',
    { channel: 'upi', payee: 'Ramesh K', key: 'ramesh.k@okaxis', ifsc: 'SBIN', remark: 'VEG' },
  ],
  [
    'UPI/427512340001/ZEPTO/zepto.payu@hdfcbank/Payment',
    { channel: 'upi', payee: 'Zepto', key: 'zepto.payu@hdfcbank', ref: '427512340001' },
  ],
  [
    'UPI/chaiwala@paytm/Payment/CHAI POINT',
    { channel: 'upi', payee: 'Chai Point', key: 'chaiwala@paytm', ref: null },
  ],
  [
    'UPI/P2M/427598765432/BLINKIT/Paytm Payments',
    { channel: 'upi', payee: 'Blinkit', key: 'blinkit', vpa: null, remark: 'PAYTM PAYMENTS' },
  ],
  // ---- UPI, HDFC dash format
  [
    'UPI-SWIGGY LIMITED-SWIGGY.INSTAMART@YBL-YESB0YBLUPI-427512345678- PAYMENT FROM PHONE',
    {
      channel: 'upi',
      payee: 'Swiggy',
      key: 'swiggy.instamart@ybl',
      vpa: 'swiggy.instamart@ybl',
      ifsc: 'YESB',
      ref: '427512345678',
    },
  ],
  [
    'UPI-CHAI POINT-CHAIWALA@PAYTM-PYTM0123456-427512345600-UPI',
    { channel: 'upi', payee: 'Chai Point', key: 'chaiwala@paytm', ifsc: 'PYTM' },
  ],
  // Gateway VPAs are shared by many merchants, so the key falls back to the name.
  [
    'UPI/DR/427500000001/BOOKMYSHOW/HDFC/razorpay@hdfcbank/Payment',
    { channel: 'upi', payee: 'Bookmyshow', key: 'bookmyshow', vpa: 'razorpay@hdfcbank' },
  ],
  // ---- NEFT / RTGS / IMPS
  [
    'NEFT CR-HDFC0000123-ACME TECH PVT LTD-SALARY OCT',
    { channel: 'neft', payee: 'Acme Tech', key: 'acme tech', ifsc: 'HDFC', remark: 'SALARY OCT' },
  ],
  [
    'NEFT-HDFCN52026100112345-ACME TECH PVT LTD-SALARY',
    { channel: 'neft', payee: 'Acme Tech', key: 'acme tech', ref: 'HDFCN52026100112345' },
  ],
  [
    'BY TRANSFER-NEFT*HDFC0000123*N274262626*ACME TECH PVT LTD-',
    { channel: 'neft', payee: 'Acme Tech', key: 'acme tech', ifsc: 'HDFC' },
  ],
  [
    'RTGS CR-SBIN0001234-GLOBAL CORP SOLUTIONS-UTR SBINR52026101500001',
    { channel: 'rtgs', payee: 'Global', key: 'global', ifsc: 'SBIN' },
  ],
  [
    'IMPS-427511112222-SELF-HDFC XX1234',
    { channel: 'imps', payee: 'Self', key: 'self', ifsc: 'HDFC', ref: '427511112222' },
  ],
  [
    'IMPS-427598761234-SELF-KKBK0000123-XXXXXX5678-TO KOTAK',
    { channel: 'imps', payee: 'Self', key: 'self', ifsc: 'KKBK', remark: 'TO KOTAK' },
  ],
  [
    'MMT/IMPS/427512349999/RENT/LANDLORD',
    { channel: 'imps', payee: 'Rent', key: 'rent', remark: 'LANDLORD' },
  ],
  // ---- ACH / NACH / ECS mandates
  [
    'ACH/GROWW-SIP/ICIC7012345678901',
    { channel: 'ach', payee: 'Groww', key: 'groww', remark: 'SIP' },
  ],
  [
    'DEBIT-ACHDr NACH00000000012345 ZERODHA BROKING LTD',
    { channel: 'nach', payee: 'Zerodha Broking', key: 'zerodha broking' },
  ],
  [
    'ECS/HDFC LIFE INSURANCE/000123',
    { channel: 'ecs', payee: 'Hdfc Life Insurance', key: 'hdfc life insurance' },
  ],
  // ---- Card / POS
  [
    'POS 416021XXXXXX1234 DMART AVENUE SUPE',
    { channel: 'pos', payee: 'Dmart Avenue Supe', key: 'dmart avenue supe' },
  ],
  [
    'POS 4111XXXX1234 AMAZON PAY IN GROCE',
    { channel: 'pos', payee: 'Amazon Pay In Groce', key: 'amazon pay in groce' },
  ],
  [
    'ECOM PUR/TATA POWER DDL/081026',
    { channel: 'card', payee: 'Tata Power Ddl', key: 'tata power ddl' },
  ],
  ['SWIGGY BANGALORE', { channel: 'card', payee: 'Swiggy', key: 'swiggy' }, 'credit_card'],
  [
    'UBER INDIA SYSTEMS PVT BANGALORE IN',
    { channel: 'card', payee: 'Uber', key: 'uber' },
    'credit_card',
  ],
  ['NETFLIX.COM MUMBAI', { channel: 'card', payee: 'Netflix.com', key: 'netflix' }, 'credit_card'],
  [
    'IRCTC WEB NEW DELHI IN',
    { channel: 'card', payee: 'Irctc Web', key: 'irctc web' },
    'credit_card',
  ],
  [
    'AMAZON PAY INDIA PRIVATE LI MUMBAI (REFUND)',
    { channel: 'card', payee: 'Amazon Pay', key: 'amazon pay' },
    'credit_card',
  ],
  ['ZOMATO GURGAON IN', { channel: 'card', payee: 'Zomato', key: 'zomato' }, 'credit_card'],
  [
    'THE BOMBAY CANTEEN MUMBAI',
    { channel: 'card', payee: 'Bombay Canteen', key: 'bombay canteen' },
    'credit_card',
  ],
  // ---- No counterparty
  ['ATM WDL-ATM CASH 1234 PUNE CAMP', { channel: 'atm', payee: null, key: null }],
  ['NWD-416021XXXXXX1234-S1AN1234-PUNE', { channel: 'atm', payee: null, key: null }],
  ['CREDIT INTEREST', { channel: 'interest', payee: null, key: null }],
  ['INTEREST PAID TILL 31-OCT-2026', { channel: 'interest', payee: null, key: null }],
  ['INT.PD:01-07-2026 TO 30-09-2026', { channel: 'interest', payee: null, key: null }],
  ['SMS CHARGES QTR SEP-26 INCL GST', { channel: 'charges', payee: null, key: null }],
  ['ATM WDL CHARGES', { channel: 'charges', payee: null, key: null }],
  ['BBPS PAYMENT RECEIVED', { channel: 'card', payee: null, key: null }, 'credit_card'],
  ['PAYMENT RECEIVED, THANK YOU', { channel: 'card', payee: null, key: null }, 'credit_card'],
  ['', { channel: 'other', payee: null, key: null }],
  // ---- Misc formats
  [
    'BIL/ONL/000123456789/MSEDCL/ELECTRICITY',
    { channel: 'other', payee: 'Msedcl', key: 'msedcl', remark: 'ELECTRICITY' },
  ],
  [
    'CHQ PAID-MICR CLG-SOCIETY MAINTENANCE',
    { channel: 'other', payee: 'Society Maintenance', key: 'society maintenance' },
  ],
  [
    'JIO PREPAID RECHARGE',
    { channel: 'other', payee: 'Jio Prepaid Recharge', key: 'jio prepaid recharge' },
  ],
];

describe('normalizeNarration', () => {
  it.each(CASES)('%s', (narration, e, accountType) => {
    const r = normalizeNarration(narration, accountType ?? 'savings');
    expect(r.channel).toBe(e.channel);
    expect(r.payee).toBe(e.payee);
    expect(r.counterpartyKey).toBe(e.key);
    if (e.vpa !== undefined) expect(r.vpa).toBe(e.vpa);
    if (e.ifsc !== undefined) expect(r.ifscPrefix).toBe(e.ifsc);
    if (e.ref !== undefined) expect(r.refNo).toBe(e.ref);
    if (e.remark !== undefined) expect(r.remark).toBe(e.remark);
  });

  it('handles null and collapses whitespace', () => {
    expect(normalizeNarration(null).channel).toBe('other');
    expect(normalizeNarration('  SWIGGY    BANGALORE ', 'credit_card').payee).toBe('Swiggy');
  });

  it('uses the VPA as display name when no name is present', () => {
    const r = normalizeNarration('UPI/DR/427511110000/ramesh.k@okaxis');
    expect(r.payee).toBe('ramesh.k@okaxis');
    expect(r.counterpartyKey).toBe('ramesh.k@okaxis');
  });

  it('caps long payee names', () => {
    const r = normalizeNarration(`POS 4111XXXX1234 ${'VERYLONGMERCHANT '.repeat(10)}`);
    expect(r.payee?.length).toBeLessThanOrEqual(80);
  });

  it('is deterministic for the same input', () => {
    const n = 'UPI/DR/412345678901/SWIGGY LIMITED/YESB/swiggy.instamart@ybl/Payment';
    expect(normalizeNarration(n)).toEqual(normalizeNarration(n));
  });
});

describe('detectChannel', () => {
  it.each([
    ['UPI/123', 'upi'],
    ['NEFT CR', 'neft'],
    ['RTGS DR', 'rtgs'],
    ['IMPS P2A', 'imps'],
    ['MMT/IMPS', 'imps'],
    ['NACH DR', 'nach'],
    ['ACH D- X', 'ach'],
    ['ACHDR X', 'ach'],
    ['ECS/X', 'ecs'],
    ['ANNUAL FEE', 'charges'],
    ['GST ON FEES', 'charges'],
    ['FUEL SURCHARGE WAIVER', 'other'],
    ['CASH WITHDRAWAL', 'atm'],
    ['PCD/1234/SHOP', 'pos'],
    ['ECOM SHOP', 'card'],
    ['SB INT CR', 'interest'],
    ['SOMETHING', 'other'],
  ] as const)('%s -> %s', (text, ch) => expect(detectChannel(text)).toBe(ch));

  it('defaults to card for credit-card accounts', () =>
    expect(detectChannel('SWIGGY', 'credit_card')).toBe('card'));
});

describe('keywordWords', () => {
  it('splits on non-alphanumerics and lower-cases', () =>
    expect(keywordWords('UPI/swiggy.instamart@ybl', null, 'H&M Store')).toEqual([
      'upi',
      'swiggy',
      'instamart',
      'ybl',
      'h',
      'm',
      'store',
    ]));
});
