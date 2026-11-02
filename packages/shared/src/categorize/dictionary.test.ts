import { describe, expect, it } from 'vitest';
import { flattenCategorySeed } from '../categories';
import type { AccountType } from '../schemas/enums';
import {
  builtinDictionary,
  compileDictionary,
  KEYWORD_DICTIONARY,
  keywordDictionarySchema,
} from './dictionary';
import rawDictionary from './dictionary.json';
import { keywordWords, normalizeNarration } from './normalize';

const SEED_SLUGS = new Set(flattenCategorySeed().map((c) => c.slug));

function categorySlug(
  narration: string,
  direction: 'in' | 'out',
  accountType: AccountType = 'savings',
): string | null {
  const n = normalizeNarration(narration, accountType);
  return (
    builtinDictionary().match({
      words: keywordWords(narration),
      direction,
      channel: n.channel,
      accountType,
    })?.category ?? null
  );
}

describe('dictionary.json', () => {
  it('is valid and versioned', () => {
    expect(keywordDictionarySchema.safeParse(rawDictionary).success).toBe(true);
    expect(KEYWORD_DICTIONARY.version).toBeGreaterThanOrEqual(1);
    expect(builtinDictionary().version).toBe(KEYWORD_DICTIONARY.version);
  });

  it('only references seeded category slugs', () => {
    const unknown = KEYWORD_DICTIONARY.entries
      .map((e) => e.category)
      .filter((s) => !SEED_SLUGS.has(s));
    expect(unknown).toEqual([]);
  });

  it('has no keyword mapped to two categories under the same filters', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const e of KEYWORD_DICTIONARY.entries) {
      for (const k of e.keywords ?? []) {
        const id = `${keywordWords(k).join(' ')}|${e.direction ?? '*'}|${(e.accountTypes ?? []).join(',')}`;
        const prev = seen.get(id);
        if (prev && prev !== e.category) clashes.push(`${id}: ${prev} vs ${e.category}`);
        seen.set(id, e.category);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('rejects entries with neither keywords nor channels', () => {
    expect(
      keywordDictionarySchema.safeParse({ version: 1, entries: [{ category: 'rent' }] }).success,
    ).toBe(false);
  });
});

// Every narration in /fixtures plus common real-world shapes.
const CASES: [string, 'in' | 'out', string | null, AccountType?][] = [
  ['UPI/DR/412345678901/SWIGGY LIMITED/YESB/swiggy.instamart@ybl/Payment', 'out', 'grocery'],
  [
    'UPI-SWIGGY LIMITED-SWIGGY.INSTAMART@YBL-YESB0YBLUPI-427512345678- PAYMENT FROM PHONE',
    'out',
    'grocery',
  ],
  ['SWIGGY BANGALORE', 'out', 'food_delivery', 'credit_card'],
  ['ZOMATO GURGAON IN', 'out', 'food_delivery', 'credit_card'],
  ['UPI/427512340001/ZEPTO/zepto.payu@hdfcbank/Payment', 'out', 'grocery'],
  ['UPI/P2M/427598765432/BLINKIT/Paytm Payments', 'out', 'grocery'],
  ['BIGBASKET BANGALORE', 'out', 'grocery', 'credit_card'],
  ['DMART AVENUE SUPERMARTS PUNE', 'out', 'grocery', 'credit_card'],
  ['POS 416021XXXXXX1234 DMART AVENUE SUPE', 'out', 'grocery'],
  ['AMAZON PAY INDIA PRIVATE LI MUMBAI', 'out', 'online_shopping', 'credit_card'],
  // Refund from a merchant nets off that merchant's category (decision 2026-11-01).
  ['AMAZON PAY INDIA PRIVATE LI MUMBAI (REFUND)', 'in', 'online_shopping', 'credit_card'],
  ['REFUND FOR ORDER 123', 'in', 'refund'],
  ['MYNTRA DESIGNS BANGALORE', 'out', 'clothing', 'credit_card'],
  ['UBER INDIA SYSTEMS PVT BANGALORE IN', 'out', 'cab_auto', 'credit_card'],
  ['RAPIDO BIKE TAXI', 'out', 'cab_auto', 'credit_card'],
  ['IRCTC WEB NEW DELHI IN', 'out', 'train', 'credit_card'],
  ['MAKEMYTRIP INDIA PVT LTD', 'out', 'flight', 'credit_card'],
  ['INDIAN OIL PETROL PUMP PUNE', 'out', 'petrol', 'credit_card'],
  ['FUEL SURCHARGE WAIVER', 'in', 'bank_charges', 'credit_card'],
  ['NETFLIX.COM MUMBAI', 'out', 'entertainment', 'credit_card'],
  ['HOTSTAR MUMBAI', 'out', 'entertainment', 'credit_card'],
  ['JIO PREPAID RECHARGE', 'out', 'mobile_recharge'],
  ['JIO FIBER BROADBAND', 'out', 'internet'],
  ['JIOMART ORDER', 'out', 'grocery'],
  ['ECOM PUR/TATA POWER DDL/081026', 'out', 'electricity'],
  ['BIL/ONL/000123456789/MSEDCL/ELECTRICITY', 'out', 'electricity'],
  ['MAHANAGAR GAS LTD', 'out', 'gas'],
  ['ACH/GROWW-SIP/ICIC7012345678901', 'out', 'mutual_funds'],
  ['DEBIT-ACHDr NACH00000000012345 ZERODHA BROKING LTD', 'out', 'stocks'],
  ['NEFT CR-HDFC0000123-ACME TECH PVT LTD-SALARY OCT', 'in', 'salary'],
  ['NEFT-HDFCN52026100112345-ACME TECH PVT LTD-SALARY', 'in', 'salary'],
  ['CREDIT INTEREST', 'in', 'interest'],
  ['INTEREST PAID TILL 31-OCT-2026', 'in', 'interest'],
  ['INT.PD:01-07-2026 TO 30-09-2026', 'in', 'interest'],
  ['SMS CHARGES QTR SEP-26 INCL GST', 'out', 'bank_charges'],
  ['ATM WDL-ATM CASH 1234 PUNE CAMP', 'out', 'atm_cash'],
  ['CHQ PAID-MICR CLG-SOCIETY MAINTENANCE', 'out', 'society_maintenance'],
  ['CLG/RENT OCT/LANDLORD NAME', 'out', 'rent'],
  ['CC 000485498XXXXXX4321 AUTOPAY SI-TAD', 'out', 'cc_bill_payment'],
  ['TO TRANSFER-INB HDFC CREDIT CARD BILL PAYMENT XX4321', 'out', 'cc_bill_payment'],
  ['PAYMENT RECEIVED, THANK YOU', 'in', 'cc_bill_payment', 'credit_card'],
  ['BBPS PAYMENT RECEIVED', 'in', 'cc_bill_payment', 'credit_card'],
  ['IMPS-427511112222-SELF-HDFC XX1234', 'out', 'self_transfer'],
  ['UPI/P2A/427512340000/MOM/HDFC/mom@okhdfcbank/gift', 'in', 'gift_received'],
  ['UPI/P2A/427512340000/MOM/HDFC/mom@okhdfcbank/gift', 'out', 'gifts_given'],
  ['SPOTIFY PREMIUM', 'out', 'entertainment'],
  ['LIC OF INDIA PREMIUM', 'out', 'insurance_premium'],
  // Unknowns stay Uncategorized.
  ['TO TRANSFER-UPI/DR/427512345678/RAMESH K/SBIN/ramesh.k@okaxis/veg', 'out', null],
  ['UPI/chaiwala@paytm/Payment/RAJU', 'out', null],
  // Direction filters: salary only inbound, petrol only outbound.
  ['SALARY ADVANCE RECOVERY', 'out', null],
  // Account-type filters: "payment received" means a card bill payment only on a card.
  ['PAYMENT RECEIVED', 'in', null, 'savings'],
];

describe('built-in dictionary matching', () => {
  it.each(CASES)('%s (%s) -> %s', (narration, direction, slug, accountType) =>
    expect(categorySlug(narration, direction, accountType)).toBe(slug),
  );
});

describe('compileDictionary', () => {
  const dict = compileDictionary({
    version: 7,
    entries: [
      { category: 'a', keywords: ['foo'] },
      { category: 'b', keywords: ['foo bar'] },
      { category: 'c', keywords: ['foo'] },
      { category: 'd', keywords: ['baz'], direction: 'in' },
      { category: 'e', channels: ['atm'] },
      { category: 'f', keywords: ['card thing'], accountTypes: ['credit_card'] },
      { category: 'g', keywords: ['--'] }, // normalizes to no words; ignored
    ],
  });
  const m = (text: string, extra: Partial<Parameters<typeof dict.match>[0]> = {}) =>
    dict.match({
      words: keywordWords(text),
      direction: 'out',
      channel: null,
      accountType: 'savings',
      ...extra,
    });

  it('prefers the longest keyword', () => expect(m('x foo bar y')?.category).toBe('b'));
  it('breaks ties by entry order', () => expect(m('foo')?.category).toBe('a'));
  it('requires whole consecutive words', () => {
    expect(m('foobar')).toBeNull();
    expect(m('foo x bar')?.category).toBe('a');
    expect(m('bar')).toBeNull();
  });
  it('respects direction', () => {
    expect(m('baz')).toBeNull();
    expect(m('baz', { direction: 'in' })?.category).toBe('d');
  });
  it('respects account types', () => {
    expect(m('card thing')).toBeNull();
    expect(m('card thing', { accountType: null })).toBeNull();
    expect(m('card thing', { accountType: 'credit_card' })?.category).toBe('f');
  });
  it('falls back to channel entries only when no keyword matches', () => {
    expect(m('nothing', { channel: 'atm' })).toEqual({
      category: 'e',
      keyword: 'channel:atm',
      confidence: 0.8,
    });
    expect(m('foo', { channel: 'atm' })?.category).toBe('a');
    expect(m('nothing', { channel: 'upi' })).toBeNull();
  });
  it('reports the matched keyword and version', () => {
    expect(m('foo bar')).toEqual({ category: 'b', keyword: 'foo bar', confidence: 0.8 });
    expect(dict.version).toBe(7);
  });
});
