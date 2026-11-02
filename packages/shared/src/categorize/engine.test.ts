import { describe, expect, it } from 'vitest';
import { flattenCategorySeed } from '../categories';
import { compileDictionary } from './dictionary';
import {
  categorize,
  type CategorizeContext,
  type CategorizeInput,
  type CompiledRuleRef,
  type LearnedLabelRef,
  pickLearnedLabel,
} from './engine';
import { compileConditions } from './rules';

const ids = new Map(flattenCategorySeed().map((c) => [c.slug, `cat_${c.slug}`]));

const input = (over: Partial<CategorizeInput> = {}): CategorizeInput => ({
  narration: 'UPI/DR/1234/SWIGGY LIMITED/YESB/swiggy@ybl/Payment',
  counterpartyKey: 'swiggy@ybl',
  counterpartyId: 'cp_swiggy',
  vpa: 'swiggy@ybl',
  amountPaise: 45_000,
  direction: 'out',
  accountId: 'acc1',
  accountType: 'savings',
  channel: 'upi',
  ...over,
});

const rule = (over: Partial<CompiledRuleRef> & { contains?: string } = {}): CompiledRuleRef => ({
  id: 'r1',
  name: 'Swiggy is dining',
  categoryId: 'cat_restaurants',
  setTagIds: ['tag1'],
  setNote: 'auto',
  test: compileConditions({
    all: [{ field: 'narration', op: 'contains', value: over.contains ?? 'swiggy' }],
  }),
  ...over,
});

const label = (over: Partial<LearnedLabelRef> = {}): LearnedLabelRef => ({
  id: 'l1',
  counterpartyId: 'cp_swiggy',
  direction: null,
  accountId: null,
  categoryId: 'cat_grocery',
  ...over,
});

const ctx = (over: Partial<CategorizeContext> = {}): CategorizeContext => ({
  rules: [],
  learned: new Map(),
  categoryIdBySlug: (s) => ids.get(s),
  ...over,
});

describe('categorize pipeline', () => {
  it('rules win over learned labels and keywords', () => {
    const r = categorize(
      input(),
      ctx({ rules: [rule()], learned: new Map([['cp_swiggy', [label()]]]) }),
    );
    expect(r).toEqual({
      categoryId: 'cat_restaurants',
      categorizedBy: 'rule',
      ruleId: 'r1',
      learnedLabelId: null,
      confidence: 1,
      reason: 'rule:Swiggy is dining',
      setTagIds: ['tag1'],
      setNote: 'auto',
    });
  });

  it('first matching rule (priority order) wins', () => {
    const r = categorize(
      input(),
      ctx({
        rules: [
          rule({ id: 'r0', contains: 'zomato', categoryId: 'x' }),
          rule({ id: 'r1', categoryId: 'first' }),
          rule({ id: 'r2', categoryId: 'second' }),
        ],
      }),
    );
    expect(r?.ruleId).toBe('r1');
    expect(r?.categoryId).toBe('first');
  });

  it('learned labels win over keywords', () => {
    const r = categorize(input(), ctx({ learned: new Map([['cp_swiggy', [label()]]]) }));
    expect(r).toMatchObject({
      categoryId: 'cat_grocery',
      categorizedBy: 'learned',
      learnedLabelId: 'l1',
      reason: 'learned:swiggy@ybl',
      confidence: 0.95,
    });
  });

  it('falls back to the counterparty id in the reason when there is no key', () => {
    const r = categorize(
      input({ counterpartyKey: null }),
      ctx({ learned: new Map([['cp_swiggy', [label()]]]) }),
    );
    expect(r?.reason).toBe('learned:cp_swiggy');
  });

  it('uses the keyword dictionary last', () => {
    expect(categorize(input(), ctx())).toMatchObject({
      categoryId: 'cat_food_delivery',
      categorizedBy: 'keyword',
      reason: 'keyword:swiggy',
      ruleId: null,
      learnedLabelId: null,
    });
  });

  it('matches keywords in extra text (manual entries)', () => {
    const r = categorize(
      input({ narration: null, vpa: null, channel: null, extraText: 'Zomato dinner' }),
      ctx(),
    );
    expect(r?.reason).toBe('keyword:zomato');
  });

  it('records channel fallbacks', () => {
    const r = categorize(
      input({ narration: 'ATM WDL 1234', channel: 'atm', counterpartyId: null, vpa: null }),
      ctx(),
    );
    expect(r).toMatchObject({ categoryId: 'cat_atm_cash', reason: 'keyword:channel:atm' });
  });

  it('skips keyword categories the user archived', () => {
    const r = categorize(
      input(),
      ctx({ categoryIdBySlug: (s) => (s === 'food_delivery' ? undefined : ids.get(s)) }),
    );
    expect(r).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(
      categorize(
        input({ narration: 'UPI/DR/1/RAMESH/x@okaxis', vpa: 'x@okaxis', counterpartyId: 'cp_x' }),
        ctx(),
      ),
    ).toBeNull();
  });

  it('accepts a custom dictionary', () => {
    const dictionary = compileDictionary({
      version: 1,
      entries: [{ category: 'rent', keywords: ['swiggy'] }],
    });
    expect(categorize(input(), ctx({ dictionary }))?.categoryId).toBe('cat_rent');
  });
});

describe('pickLearnedLabel', () => {
  const labels = [
    label({ id: 'any' }),
    label({ id: 'out', direction: 'out' }),
    label({ id: 'acc', accountId: 'acc1' }),
    label({ id: 'acc+out', accountId: 'acc1', direction: 'out' }),
    label({ id: 'in', direction: 'in' }),
    label({ id: 'acc2', accountId: 'acc2' }),
  ];

  it.each([
    ['out', 'acc1', 'acc+out'],
    ['in', 'acc1', 'acc'],
    ['out', 'acc9', 'out'],
    ['in', 'acc9', 'in'],
  ] as const)('%s on %s -> %s', (direction, account, id) =>
    expect(pickLearnedLabel(labels, direction, account)?.id).toBe(id),
  );

  it('falls back to the unscoped label', () =>
    expect(pickLearnedLabel([label({ id: 'any' })], 'in', 'acc9')?.id).toBe('any'));

  it('returns null when nothing applies', () => {
    expect(pickLearnedLabel(undefined, 'out', 'acc1')).toBeNull();
    expect(pickLearnedLabel([label({ direction: 'in' })], 'out', 'acc1')).toBeNull();
  });
});
