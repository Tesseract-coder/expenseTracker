import { describe, expect, it } from 'vitest';
import { cashAccountId, categoryIdBySlug, getJson, patchJson, postJson } from './helpers';

const find = async (id: string | undefined) =>
  (await getJson('/api/categories')).body.categories.find((c: any) => c.id === id);

describe('categories', () => {
  it('creates a category that inherits type and color from its group', async () => {
    const ids = await categoryIdBySlug();
    const res = await postJson('/api/categories', {
      name: 'Pet care',
      parentId: ids.household,
      icon: 'paw-print',
    });
    expect(res.status).toBe(201);
    expect(res.body.category).toMatchObject({
      name: 'Pet care',
      type: 'expense_need',
      color: '#ea580c',
      parentId: ids.household,
    });
    expect(
      (await postJson('/api/categories', { name: 'Pet care', parentId: ids.household })).status,
    ).toBe(409);
  });

  it('creates groups (type required) and enforces two levels and system protection', async () => {
    const ids = await categoryIdBySlug();
    expect((await postJson('/api/categories', { name: 'Kids', parentId: null })).status).toBe(400);
    const group = await postJson('/api/categories', {
      name: 'Kids',
      parentId: null,
      type: 'expense_want',
    });
    expect(group.status).toBe(201);

    const nested = await postJson('/api/categories', { name: 'Deep', parentId: ids.grocery });
    expect(nested.body.error.code).toBe('invalid_parent');
    const underSystem = await postJson('/api/categories', { name: 'Mine', parentId: ids.system });
    expect(underSystem.body.error.code).toBe('invalid_parent');
  });

  it('allows renaming system categories but not retyping or archiving them', async () => {
    const ids = await categoryIdBySlug();
    expect(
      (await patchJson(`/api/categories/${ids.self_transfer}`, { name: 'Own transfer' })).status,
    ).toBe(200);
    for (const patch of [{ type: 'expense_want' }, { archived: true }]) {
      const res = await patchJson(`/api/categories/${ids.self_transfer}`, patch);
      expect(res.body.error.code).toBe('system_category');
    }
  });

  it('propagates group type changes and archiving to children', async () => {
    const ids = await categoryIdBySlug();
    await patchJson(`/api/categories/${ids.travel}`, { type: 'expense_want' });
    expect((await find(ids.flight)).type).toBe('expense_want');

    await patchJson(`/api/categories/${ids.travel}`, { archived: true });
    expect((await find(ids.petrol)).archived).toBe(true);
  });

  it('moves a category to another group', async () => {
    const ids = await categoryIdBySlug();
    const res = await patchJson(`/api/categories/${ids.hotels}`, { parentId: ids.travel });
    expect(res.body.category.parentId).toBe(ids.travel);
    expect(
      (await patchJson(`/api/categories/${ids.travel}`, { parentId: ids.lifestyle })).status,
    ).toBe(400);
  });

  it('merges a category: moves transactions and split parts, archives the source', async () => {
    const ids = await categoryIdBySlug();
    const accountId = await cashAccountId();
    const base = { accountId, direction: 'out', txnDate: '2026-11-01' };
    const t1 = (
      await postJson('/api/transactions', { ...base, amountPaise: 100, categoryId: ids.cng })
    ).body.transaction;
    const t2 = (
      await postJson('/api/transactions', {
        ...base,
        amountPaise: 300,
        splits: [
          { categoryId: ids.cng, amountPaise: 100 },
          { categoryId: ids.parking, amountPaise: 200 },
        ],
      })
    ).body.transaction;

    const res = await postJson(`/api/categories/${ids.cng}/merge`, { targetId: ids.petrol });
    expect(res.status).toBe(200);
    expect(res.body.moved).toEqual({ transactions: 1, splits: 1 });
    expect((await getJson(`/api/transactions/${t1.id}`)).body.transaction.categoryId).toBe(
      ids.petrol,
    );
    const splits = (await getJson(`/api/transactions/${t2.id}`)).body.transaction.splits.map(
      (s: any) => s.categoryId,
    );
    expect(splits.sort()).toEqual([ids.parking, ids.petrol].sort());
    expect((await find(ids.cng)).archived).toBe(true);
  });

  it.each([
    ['into itself', 'cng', 'cng', 'invalid_merge'],
    ['a group', 'travel', 'household', 'invalid_merge'],
    ['a system category', 'uncategorized', 'petrol', 'system_category'],
  ])('rejects merging %s', async (_name, from, to, code) => {
    const ids = await categoryIdBySlug();
    const res = await postJson(`/api/categories/${ids[from]}/merge`, { targetId: ids[to] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });
});
