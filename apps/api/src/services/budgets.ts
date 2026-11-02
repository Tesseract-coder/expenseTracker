import {
  type BudgetDto,
  type BudgetListResponse,
  budgetStatus,
  type BudgetUpsert,
  budgetUpsertSchema,
  toIstDate,
} from '@kharcha/shared';
import { ApiException, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { ledgerWhere } from './reports';

interface BudgetRow {
  id: string;
  category_id: string;
  month: string | null;
  amount_paise: number;
  name: string;
}

export interface MonthBudget {
  id: string;
  categoryId: string;
  name: string;
  month: string | null;
  amountPaise: number;
  spentPaise: number;
}

/**
 * Effective budgets for each month (a month-specific row overrides the default) with actual
 * spend: a category budget counts that category; a group budget counts all its categories.
 * Two queries regardless of how many months.
 */
export async function budgetsForMonths(
  d1: D1Database,
  userId: string,
  months: string[],
  accountIds?: string[],
): Promise<Map<string, MonthBudget[]>> {
  const out = new Map<string, MonthBudget[]>(months.map((m) => [m, []]));
  const first = months[0];
  const last = months.at(-1);
  if (!first || !last) return out;
  const { results: rows } = await d1
    .prepare(
      `select b.id, b.category_id, b.month, b.amount_paise, c.name from budgets b
       join categories c on c.id = b.category_id
       where b.user_id = ?1 and c.archived = 0
         and (b.month is null or b.month in (select value from json_each(?2)))`,
    )
    .bind(userId, JSON.stringify(months))
    .all<BudgetRow>();
  if (rows.length === 0) return out;

  const w = ledgerWhere(userId, { from: `${first}-01`, to: `${last}-31`, accountIds });
  const { results: spend } = await d1
    .prepare(
      `select substr(l.txn_date, 1, 7) as month, l.category_id as categoryId, l.group_id as groupId,
         sum(l.spend_paise) as spend
       from v_ledger l where ${w.sql} and l.kind in ('need', 'want', 'uncategorized')
       group by month, l.category_id, l.group_id`,
    )
    .bind(...w.params)
    .all<{ month: string; categoryId: string; groupId: string; spend: number }>();
  const spent = new Map<string, number>();
  const add = (k: string, v: number) => spent.set(k, (spent.get(k) ?? 0) + v);
  for (const s of spend) {
    add(`${s.month}|${s.categoryId}`, s.spend);
    if (s.groupId !== s.categoryId) add(`${s.month}|${s.groupId}`, s.spend);
  }

  for (const month of months) {
    const effective = new Map<string, BudgetRow>();
    for (const r of rows) {
      if (r.month !== null && r.month !== month) continue;
      const existing = effective.get(r.category_id);
      if (!existing || (existing.month === null && r.month !== null))
        effective.set(r.category_id, r);
    }
    out.set(
      month,
      [...effective.values()].map((r) => ({
        id: r.id,
        categoryId: r.category_id,
        name: r.name,
        month: r.month,
        amountPaise: r.amount_paise,
        spentPaise: spent.get(`${month}|${r.category_id}`) ?? 0,
      })),
    );
  }
  return out;
}

export async function listBudgets(
  d1: D1Database,
  userId: string,
  month: string,
  accountIds?: string[],
): Promise<BudgetListResponse> {
  const today = toIstDate();
  const list = (await budgetsForMonths(d1, userId, [month], accountIds)).get(month) ?? [];
  const budgets: BudgetDto[] = list
    .map((b) => ({
      id: b.id,
      categoryId: b.categoryId,
      month: b.month,
      amountPaise: b.amountPaise,
      spentPaise: b.spentPaise,
      ...budgetStatus(b.amountPaise, b.spentPaise, month, today),
    }))
    .sort((a, b) => b.pct - a.pct);
  return {
    month,
    budgets,
    totals: {
      budgetedPaise: budgets.reduce((a, b) => a + b.amountPaise, 0),
      spentPaise: budgets.reduce((a, b) => a + b.spentPaise, 0),
    },
  };
}

/** Upsert by (category, month|default). Only spending categories/groups can have budgets. */
export async function upsertBudget(d1: D1Database, userId: string, raw: BudgetUpsert) {
  const b = budgetUpsertSchema.parse(raw);
  const cat = await d1
    .prepare('select type, archived from categories where user_id = ?1 and id = ?2')
    .bind(userId, b.categoryId)
    .first<{ type: string; archived: number }>();
  if (!cat) throw notFound('Category not found');
  if (cat.type !== 'expense_need' && cat.type !== 'expense_want') {
    throw new ApiException(400, 'invalid_budget_category', 'Budgets apply to spending categories');
  }
  const id = newId();
  const now = Date.now();
  await d1.batch([
    d1
      .prepare(
        "delete from budgets where user_id = ?1 and category_id = ?2 and ifnull(month, '*') = ifnull(?3, '*')",
      )
      .bind(userId, b.categoryId, b.month),
    d1
      .prepare(
        `insert into budgets (id, user_id, category_id, month, amount_paise, created_at, updated_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
      )
      .bind(id, userId, b.categoryId, b.month, b.amountPaise, now),
  ]);
  return { id };
}

export async function deleteBudget(d1: D1Database, userId: string, id: string) {
  const r = await d1
    .prepare('delete from budgets where user_id = ?1 and id = ?2')
    .bind(userId, id)
    .run();
  if (!r.meta.changes) throw notFound('Budget not found');
}
