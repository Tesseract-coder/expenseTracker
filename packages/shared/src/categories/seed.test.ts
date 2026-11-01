import { describe, expect, it } from 'vitest';
import { SYSTEM_CATEGORY_KEYS } from '../schemas/enums';
import { CATEGORY_SEED, flattenCategorySeed } from './seed';

describe('category seed', () => {
  const flat = flattenCategorySeed();

  it('has unique slugs', () => {
    const slugs = flat.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('slugs are snake_case', () => {
    for (const c of flat) expect(c.slug).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('defines every system key exactly once', () => {
    const keys = flat.map((c) => c.systemKey).filter(Boolean);
    expect([...keys].sort()).toEqual([...SYSTEM_CATEGORY_KEYS].sort());
  });

  it('puts parents before children and inherits type/color', () => {
    const seen = new Set<string>();
    for (const c of flat) {
      if (c.parentSlug) expect(seen.has(c.parentSlug)).toBe(true);
      seen.add(c.slug);
    }
    const grocery = flat.find((c) => c.slug === 'grocery');
    expect(grocery).toMatchObject({
      parentSlug: 'household',
      type: 'expense_need',
      color: '#ea580c',
    });
  });

  it('treats ATM withdrawal and system categories as transfers', () => {
    for (const slug of ['atm_cash', 'self_transfer', 'cc_bill_payment', 'opening_adjustment']) {
      expect(flat.find((c) => c.slug === slug)?.type).toBe('transfer');
    }
  });

  it('matches the spec category counts', () => {
    expect(CATEGORY_SEED.map((g) => [g.slug, g.children.length])).toEqual([
      ['income', 9],
      ['investment', 10],
      ['household', 15],
      ['lifestyle', 8],
      ['travel', 12],
      ['misc', 5],
      ['system', 3],
    ]);
  });
});
