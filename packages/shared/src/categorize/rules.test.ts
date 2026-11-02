import { describe, expect, it } from 'vitest';
import {
  compileConditions,
  parseStoredConditions,
  regexIssue,
  ruleConditionSchema,
  ruleConditionsSchema,
  type RuleConditions,
  type RuleSubject,
} from './rules';

const subject = (over: Partial<RuleSubject> = {}): RuleSubject => ({
  narration: 'UPI/DR/1234/SWIGGY LIMITED/YESB/swiggy.instamart@ybl/Payment',
  counterpartyKey: 'swiggy.instamart@ybl',
  vpa: 'swiggy.instamart@ybl',
  amountPaise: 45_000,
  direction: 'out',
  accountId: 'acc1',
  channel: 'upi',
  ...over,
});

describe('regexIssue', () => {
  it.each([
    ['swiggy|zomato', null],
    ['^upi/.*/rent', null],
    ['(swiggy|zomato) order', null],
    ['\\d{12}', null],
    ['[(+*)]+', null], // quantifier chars inside a class are literal
    ['\\(a+\\)+', null], // escaped parens are not a group
    ['(a+)+', 'Nested repetition'],
    ['(\\w*)*x', 'Nested repetition'],
    ['(a|aa)+', 'Nested repetition'],
    ['((ab)*c)+', 'Nested repetition'],
    ['(x{2,})+', 'Nested repetition'],
    ['(a)\\1', 'Backreferences'],
    ['(?<n>a)\\k<n>', 'Backreferences'],
    ['(?<=a)b', 'Lookbehind'],
    ['(unclosed', 'Not a valid'],
    ['a'.repeat(201), 'under 200'],
  ])('%s', (pattern, issue) => {
    const got = regexIssue(pattern);
    if (issue === null) expect(got).toBeNull();
    else expect(got).toContain(issue);
  });
});

describe('ruleConditionSchema', () => {
  it.each([
    [{ field: 'narration', op: 'contains', value: 'swiggy' }, true],
    [{ field: 'narration', op: 'regex', value: '(a+)+' }, false],
    [{ field: 'narration', op: 'contains', value: '  ' }, false],
    [{ field: 'counterparty_key', op: 'eq', value: 'swiggy' }, true],
    [{ field: 'vpa', op: 'regex', value: '@ybl$' }, true],
    [{ field: 'amount', op: 'between', value: [100, 200] }, true],
    [{ field: 'amount', op: 'between', value: [300, 200] }, false],
    [{ field: 'amount', op: 'gte', value: 0 }, false],
    [{ field: 'amount', op: 'contains', value: 'x' }, false],
    [{ field: 'direction', op: 'eq', value: 'in' }, true],
    [{ field: 'direction', op: 'eq', value: 'sideways' }, false],
    [{ field: 'account_id', op: 'in', value: ['a', 'b'] }, true],
    [{ field: 'account_id', op: 'in', value: [] }, false],
    [{ field: 'channel', op: 'in', value: ['upi', 'pos'] }, true],
    [{ field: 'channel', op: 'in', value: ['pigeon'] }, false],
    [{ field: 'note', op: 'contains', value: 'x' }, false],
  ])('%j valid=%s', (c, ok) => expect(ruleConditionSchema.safeParse(c).success).toBe(ok));

  it('needs 1–10 conditions', () => {
    expect(ruleConditionsSchema.safeParse({ all: [] }).success).toBe(false);
    const one = { field: 'direction', op: 'eq', value: 'out' };
    expect(ruleConditionsSchema.safeParse({ all: Array(11).fill(one) }).success).toBe(false);
  });
});

describe('compileConditions', () => {
  const t = (all: RuleConditions['all'], over: Partial<RuleSubject> = {}) =>
    compileConditions({ all })(subject(over));

  it.each<[RuleConditions['all'], Partial<RuleSubject>, boolean]>([
    [[{ field: 'narration', op: 'contains', value: 'SWIGGY limited' }], {}, true],
    [[{ field: 'narration', op: 'contains', value: 'zomato' }], {}, false],
    [[{ field: 'narration', op: 'contains', value: 'x' }], { narration: null }, false],
    [[{ field: 'narration', op: 'eq', value: 'rent' }], { narration: ' RENT ' }, true],
    [[{ field: 'narration', op: 'regex', value: '^upi/dr/\\d+/swiggy' }], {}, true],
    [[{ field: 'narration', op: 'regex', value: 'x' }], { narration: null }, false],
    [[{ field: 'counterparty_key', op: 'eq', value: 'swiggy.instamart@ybl' }], {}, true],
    [[{ field: 'counterparty_key', op: 'eq', value: 'x' }], { counterpartyKey: null }, false],
    [[{ field: 'vpa', op: 'contains', value: '@ybl' }], {}, true],
    [[{ field: 'amount', op: 'eq', value: 45_000 }], {}, true],
    [[{ field: 'amount', op: 'gte', value: 45_001 }], {}, false],
    [[{ field: 'amount', op: 'lte', value: 45_000 }], {}, true],
    [[{ field: 'amount', op: 'between', value: [40_000, 50_000] }], {}, true],
    [[{ field: 'amount', op: 'between', value: [1, 2] }], {}, false],
    [[{ field: 'direction', op: 'eq', value: 'in' }], {}, false],
    [[{ field: 'account_id', op: 'in', value: ['acc2', 'acc1'] }], {}, true],
    [[{ field: 'channel', op: 'in', value: ['pos'] }], {}, false],
    [[{ field: 'channel', op: 'in', value: ['upi'] }], { channel: null }, false],
    [
      [
        { field: 'narration', op: 'contains', value: 'swiggy' },
        { field: 'amount', op: 'lte', value: 10_000 },
      ],
      {},
      false,
    ],
  ])('%j', (all, over, expected) => expect(t(all, over)).toBe(expected));

  it('caps the text a regex sees', () => {
    const pred = compileConditions({ all: [{ field: 'narration', op: 'regex', value: 'tail$' }] });
    expect(pred(subject({ narration: `${'x'.repeat(600)}tail` }))).toBe(false);
    expect(pred(subject({ narration: 'short tail' }))).toBe(true);
  });
});

describe('parseStoredConditions', () => {
  it('parses valid JSON', () =>
    expect(parseStoredConditions('{"all":[{"field":"direction","op":"eq","value":"in"}]}')).toEqual(
      { all: [{ field: 'direction', op: 'eq', value: 'in' }] },
    ));
  it.each(['not json', '{"all":[]}', '{"all":[{"field":"x"}]}'])('rejects %s', (j) =>
    expect(parseStoredConditions(j)).toBeNull(),
  );
});
