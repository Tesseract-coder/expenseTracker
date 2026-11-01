import { describe, expect, it } from 'vitest';
import { apiErrorSchema, healthResponseSchema, meResponseSchema } from './api';
import { categoryDtoSchema } from './categories';
import { directionSchema } from './enums';

describe('api schemas', () => {
  it('parses a health response', () => {
    expect(
      healthResponseSchema.parse({ status: 'ok', version: '1', env: 'dev', db: 'ok' }),
    ).toBeTruthy();
    expect(() =>
      healthResponseSchema.parse({ status: 'down', version: '1', env: 'dev', db: 'ok' }),
    ).toThrow();
  });

  it('validates emails and errors', () => {
    expect(meResponseSchema.safeParse({ id: 'u', email: 'not-an-email' }).success).toBe(false);
    expect(apiErrorSchema.parse({ error: { code: 'x', message: 'y' } }).error.code).toBe('x');
  });

  it('rejects unknown category types', () => {
    const base = {
      id: '1',
      slug: null,
      parentId: null,
      name: 'X',
      type: 'expense_need',
      systemKey: null,
      icon: null,
      color: null,
      archived: false,
      sortOrder: 0,
    };
    expect(categoryDtoSchema.safeParse(base).success).toBe(true);
    expect(categoryDtoSchema.safeParse({ ...base, type: 'luxury' }).success).toBe(false);
    expect(directionSchema.options).toEqual(['in', 'out']);
  });
});
