import { describe, expect, it } from 'vitest';
import { explainCategorization } from './explain';

describe('explainCategorization', () => {
  it.each([
    ['manual', null, 'Set by you'],
    ['manual', 'transfer:cc_bill_payment', 'Linked as a transfer between your accounts'],
    ['rule', 'rule:Rent', 'Your rule “Rent”'],
    ['learned', 'learned:swiggy@ybl', 'You categorized this payee before'],
    ['keyword', 'keyword:swiggy', 'Matched the keyword “swiggy”'],
    ['keyword', 'keyword:channel:atm', 'ATM withdrawal'],
    ['keyword', 'keyword:channel:interest', 'Interest credit'],
    ['keyword', 'keyword:channel:charges', 'Bank charges'],
    ['ai', null, 'AI suggestion'],
    ['none', null, null],
  ] as const)('%s %s', (categorizedBy, categorizationReason, expected) =>
    expect(explainCategorization({ categorizedBy, categorizationReason })).toBe(expected),
  );
});
