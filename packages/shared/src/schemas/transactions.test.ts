import { describe, expect, it } from 'vitest';
import { accountCreateSchema, accountUpdateSchema } from './accounts';
import { categoryCreateSchema, categoryUpdateSchema } from './categories';
import { MAX_AMOUNT_PAISE } from './primitives';
import {
  splitIssues,
  tagNameSchema,
  transactionCreateSchema,
  transactionListQuerySchema,
  transactionUpdateSchema,
} from './transactions';

const base = {
  accountId: 'a1',
  txnDate: '2026-11-01',
  amountPaise: 10000,
  direction: 'out' as const,
};

describe('transactionCreateSchema', () => {
  it('applies defaults', () => {
    expect(transactionCreateSchema.parse(base)).toEqual({
      ...base,
      categoryId: null,
      splits: [],
      note: null,
      counterpartyName: null,
      tags: [],
      isReimbursable: false,
      reimbursedByTxnId: null,
    });
  });

  it.each([
    [{ amountPaise: 0 }, 'greater than zero'],
    [{ amountPaise: 1.5 }, 'whole paise'],
    [{ amountPaise: MAX_AMOUNT_PAISE + 1 }, 'too large'],
    [{ txnDate: '2026-02-30' }, 'valid date'],
    [{ direction: 'sideways' }, ''],
    [{ note: 'x'.repeat(501) }, 'Too long'],
  ])('rejects %j', (patch, msg) => {
    const r = transactionCreateSchema.safeParse({ ...base, ...patch });
    expect(r.success).toBe(false);
    if (msg) expect(JSON.stringify(r.error?.issues)).toContain(msg);
  });

  it('validates splits sum to the amount', () => {
    const ok = transactionCreateSchema.safeParse({
      ...base,
      splits: [
        { categoryId: 'c1', amountPaise: 6000 },
        { categoryId: 'c2', amountPaise: 4000 },
      ],
    });
    expect(ok.success).toBe(true);

    const bad = transactionCreateSchema.safeParse({
      ...base,
      splits: [
        { categoryId: 'c1', amountPaise: 6000 },
        { categoryId: 'c2', amountPaise: 3000 },
      ],
    });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe(
      'Split parts add up to ₹90.00 but the transaction is ₹100.00',
    );
    expect(bad.error?.issues[0]?.path).toEqual(['splits']);
  });

  it('normalizes tags', () => {
    expect(
      transactionCreateSchema.parse({ ...base, tags: ['#Goa-Trip-2026', ' office '] }).tags,
    ).toEqual(['goa-trip-2026', 'office']);
  });
});

describe('splitIssues', () => {
  it.each([
    [100, undefined, null],
    [100, [], null],
    [100, [{ categoryId: 'a', amountPaise: 100 }], 'A split needs at least two parts'],
    [
      undefined,
      [
        { categoryId: 'a', amountPaise: 50 },
        { categoryId: 'b', amountPaise: 50 },
      ],
      'Amount is required when changing splits',
    ],
  ])('(%j, %j) -> %j', (amount, splits, expected) => {
    expect(splitIssues(amount, splits)).toBe(expected);
  });
});

describe('tagNameSchema', () => {
  it.each(['', '-lead', 'has space', 'x'.repeat(41), 'emoji🙂'])('rejects %j', (t) =>
    expect(tagNameSchema.safeParse(t).success).toBe(false),
  );
});

describe('transactionUpdateSchema', () => {
  it('requires at least one field', () => {
    expect(transactionUpdateSchema.safeParse({}).success).toBe(false);
    expect(transactionUpdateSchema.safeParse({ note: 'hi' }).success).toBe(true);
  });
});

describe('transactionListQuerySchema', () => {
  it('parses comma lists, coerces numbers and booleans', () => {
    expect(
      transactionListQuerySchema.parse({
        accountIds: 'a1, a2,,',
        limit: '20',
        uncategorized: 'true',
        from: '2026-10-01',
      }),
    ).toEqual({ accountIds: ['a1', 'a2'], limit: 20, uncategorized: true, from: '2026-10-01' });
  });
  it('defaults and bounds the limit', () => {
    expect(transactionListQuerySchema.parse({}).limit).toBe(50);
    expect(transactionListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('account schemas', () => {
  it('defaults optional fields and validates last4', () => {
    expect(
      accountCreateSchema.parse({
        name: ' HDFC ',
        type: 'savings',
        openingBalanceDate: '2026-01-01',
      }),
    ).toEqual({
      name: 'HDFC',
      type: 'savings',
      bank: null,
      last4: null,
      openingBalancePaise: 0,
      openingBalanceDate: '2026-01-01',
      color: null,
    });
    expect(
      accountCreateSchema.safeParse({
        name: 'x',
        type: 'savings',
        openingBalanceDate: '2026-01-01',
        last4: '12a4',
      }).success,
    ).toBe(false);
    expect(accountUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('category schemas', () => {
  it('requires a type for new groups only', () => {
    expect(categoryCreateSchema.safeParse({ name: 'Pets', parentId: null }).success).toBe(false);
    expect(
      categoryCreateSchema.safeParse({ name: 'Pets', parentId: null, type: 'expense_want' })
        .success,
    ).toBe(true);
    expect(categoryCreateSchema.safeParse({ name: 'Vet', parentId: 'g1' }).success).toBe(true);
    expect(categoryUpdateSchema.safeParse({ color: 'red' }).success).toBe(false);
  });
});
