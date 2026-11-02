import { describe, expect, it } from 'vitest';
import {
  bulkCategoryRequestSchema,
  categorizationRunRequestSchema,
  counterpartyMergeSchema,
  counterpartyUpdateSchema,
  labelImpactQuerySchema,
  labelRequestSchema,
  learnedLabelUpdateSchema,
  MAX_BULK_IDS,
  ruleCreateSchema,
  ruleReorderSchema,
  ruleTestRequestSchema,
  ruleUpdateSchema,
} from './schemas';

const conditions = { all: [{ field: 'narration', op: 'contains', value: 'rent' }] };

describe('categorization API schemas', () => {
  it('label request defaults to this-only, direction-scoped', () =>
    expect(labelRequestSchema.parse({ categoryId: 'c1' })).toEqual({
      categoryId: 'c1',
      scope: 'this',
      matchDirection: true,
      matchAccount: false,
    }));

  it('rejects unknown label scopes', () =>
    expect(labelRequestSchema.safeParse({ categoryId: 'c1', scope: 'forever' }).success).toBe(
      false,
    ));

  it('parses impact query booleans', () =>
    expect(labelImpactQuerySchema.parse({ categoryId: 'c', matchDirection: 'true' })).toEqual({
      categoryId: 'c',
      matchDirection: true,
      matchAccount: false,
    }));

  it('caps bulk relabel size', () => {
    expect(bulkCategoryRequestSchema.safeParse({ ids: [], categoryId: 'c' }).success).toBe(false);
    const ids = Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => `t${i}`);
    expect(bulkCategoryRequestSchema.safeParse({ ids, categoryId: 'c' }).success).toBe(false);
    expect(bulkCategoryRequestSchema.safeParse({ ids: ['t1'], categoryId: 'c' }).success).toBe(
      true,
    );
  });

  it('run request defaults to uncategorized', () =>
    expect(categorizationRunRequestSchema.parse({})).toEqual({ scope: 'uncategorized' }));

  it('rule create applies defaults and normalizes tags', () =>
    expect(
      ruleCreateSchema.parse({ name: ' Rent ', conditions, categoryId: 'c', setTags: ['#Home'] }),
    ).toEqual({
      name: 'Rent',
      conditions,
      categoryId: 'c',
      setTags: ['home'],
      setNote: null,
      enabled: true,
    }));

  it('rule create validates conditions', () =>
    expect(
      ruleCreateSchema.safeParse({ name: 'x', conditions: { all: [] }, categoryId: 'c' }).success,
    ).toBe(false));

  it.each([
    [ruleUpdateSchema, {}],
    [learnedLabelUpdateSchema, {}],
  ])('rejects empty updates', (schema, body) => expect(schema.safeParse(body).success).toBe(false));

  it('accepts partial updates', () => {
    expect(ruleUpdateSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(learnedLabelUpdateSchema.safeParse({ categoryId: 'c' }).success).toBe(true);
  });

  it('validates reorder, test, payee rename and merge bodies', () => {
    expect(ruleReorderSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(ruleTestRequestSchema.safeParse({ conditions }).success).toBe(true);
    expect(counterpartyUpdateSchema.safeParse({ displayName: '' }).success).toBe(false);
    expect(counterpartyMergeSchema.safeParse({ targetId: 'cp2' }).success).toBe(true);
  });
});
