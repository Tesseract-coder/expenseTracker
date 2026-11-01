import { and, asc, eq, sql } from 'drizzle-orm';
import type { AccountCreate, AccountDto, AccountUpdate } from '@kharcha/shared';
import { accountCreateSchema } from '@kharcha/shared';
import type { Db } from '../db/client';
import { accounts, transactions } from '../db/schema';
import { ApiException, notFound } from '../lib/errors';
import { withUniqueAsConflict } from '../lib/dbErrors';
import { newId } from '../lib/ids';

const DUPLICATE_NAME = 'An account with this name already exists';

/** Accounts with balances computed in SQL: opening + Σ signed amounts dated on/after the opening date. */
export async function listAccounts(db: Db, userId: string, id?: string): Promise<AccountDto[]> {
  const rows = await db
    .select({
      account: accounts,
      movement: sql<number>`coalesce(sum(case when ${transactions.txnDate} >= ${accounts.openingBalanceDate}
        then case ${transactions.direction} when 'in' then ${transactions.amountPaise} else -${transactions.amountPaise} end
        else 0 end), 0)`,
      txnCount: sql<number>`count(${transactions.id})`,
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(and(eq(accounts.userId, userId), id ? eq(accounts.id, id) : undefined))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));

  return rows.map(({ account: a, movement, txnCount }) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    bank: a.bank,
    last4: a.last4,
    openingBalancePaise: a.openingBalancePaise,
    openingBalanceDate: a.openingBalanceDate,
    color: a.color,
    active: a.active === 1,
    sortOrder: a.sortOrder,
    balancePaise: a.openingBalancePaise + Number(movement),
    txnCount: Number(txnCount),
    parserProfileId: a.parserProfileId,
  }));
}

export async function getAccount(db: Db, userId: string, id: string): Promise<AccountDto> {
  const [account] = await listAccounts(db, userId, id);
  if (!account) throw notFound('Account not found');
  return account;
}

export async function createAccount(
  db: Db,
  userId: string,
  input: AccountCreate,
): Promise<AccountDto> {
  const data = accountCreateSchema.parse(input);
  const id = newId();
  await withUniqueAsConflict(
    () => db.insert(accounts).values({ id, userId, ...data }),
    DUPLICATE_NAME,
  );
  return getAccount(db, userId, id);
}

export async function updateAccount(
  db: Db,
  userId: string,
  id: string,
  patch: AccountUpdate,
): Promise<AccountDto> {
  await getAccount(db, userId, id);
  const { active, ...rest } = patch;
  await withUniqueAsConflict(
    () =>
      db
        .update(accounts)
        .set({ ...rest, ...(active === undefined ? {} : { active: active ? 1 : 0 }) })
        .where(and(eq(accounts.userId, userId), eq(accounts.id, id))),
    DUPLICATE_NAME,
  );
  return getAccount(db, userId, id);
}

export async function deleteAccount(db: Db, userId: string, id: string): Promise<void> {
  const account = await getAccount(db, userId, id);
  if (account.txnCount > 0) {
    throw new ApiException(
      409,
      'account_has_transactions',
      'This account has transactions. Archive it instead of deleting.',
    );
  }
  await db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.id, id)));
}
