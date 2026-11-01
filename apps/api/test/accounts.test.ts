import { describe, expect, it } from 'vitest';
import { accountListResponseSchema } from '@kharcha/shared';
import { cashAccountId, del, getJson, patchJson, postJson } from './helpers';

const hdfc = {
  name: 'HDFC Salary',
  type: 'savings',
  bank: 'hdfc',
  last4: '1234',
  openingBalancePaise: 100000,
  openingBalanceDate: '2026-10-01',
};

describe('accounts', () => {
  it('seeds a Cash account on first login', async () => {
    const { status, body } = await getJson('/api/accounts');
    expect(status).toBe(200);
    const { accounts } = accountListResponseSchema.parse(body);
    expect(accounts).toEqual([
      expect.objectContaining({ name: 'Cash', type: 'cash', balancePaise: 0, active: true }),
    ]);
  });

  it('creates, rejects duplicates and validates input', async () => {
    const created = await postJson('/api/accounts', hdfc);
    expect(created.status).toBe(201);
    expect(created.body.account).toMatchObject({ ...hdfc, balancePaise: 100000, txnCount: 0 });

    expect((await postJson('/api/accounts', hdfc)).status).toBe(409);

    const bad = await postJson('/api/accounts', { ...hdfc, name: 'X', last4: '12' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'validation_error', issues: [{ path: 'last4' }] });
  });

  it('computes balances from opening balance and transactions on/after the opening date', async () => {
    const { body } = await postJson('/api/accounts', hdfc);
    const id = body.account.id;
    const txn = (amountPaise: number, direction: string, txnDate: string) =>
      postJson('/api/transactions', { accountId: id, amountPaise, direction, txnDate });
    await txn(50000, 'in', '2026-10-05');
    await txn(20000, 'out', '2026-10-06');
    await txn(99999, 'out', '2026-09-30'); // before opening date: ignored for balance

    const acct = (await getJson(`/api/accounts/${id}`)).body.account;
    expect(acct.balancePaise).toBe(100000 + 50000 - 20000);
    expect(acct.txnCount).toBe(3);
  });

  it('supports negative opening balances for credit cards', async () => {
    const { body } = await postJson('/api/accounts', {
      name: 'ICICI Amazon Pay',
      type: 'credit_card',
      openingBalancePaise: -2500000,
      openingBalanceDate: '2026-10-01',
    });
    expect(body.account.balancePaise).toBe(-2500000);
  });

  it('updates and archives', async () => {
    const id = await cashAccountId();
    const res = await patchJson(`/api/accounts/${id}`, {
      name: 'Wallet cash',
      active: false,
      color: '#123456',
    });
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({
      name: 'Wallet cash',
      active: false,
      color: '#123456',
    });
    expect((await patchJson(`/api/accounts/${id}`, {})).status).toBe(400);
  });

  it('deletes only accounts without transactions', async () => {
    const empty = (await postJson('/api/accounts', { ...hdfc, name: 'Empty' })).body.account.id;
    expect((await del(`/api/accounts/${empty}`)).status).toBe(204);
    expect((await getJson(`/api/accounts/${empty}`)).status).toBe(404);

    const cash = await cashAccountId();
    await postJson('/api/transactions', {
      accountId: cash,
      amountPaise: 100,
      direction: 'out',
      txnDate: '2026-11-01',
    });
    const res = await del(`/api/accounts/${cash}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('account_has_transactions');
  });
});
