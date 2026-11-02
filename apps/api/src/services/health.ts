import {
  addMonths,
  computeHealth,
  type HealthScoreResponse,
  healthScoreQuerySchema,
  monthsInRange,
  periodRange,
  toIstDate,
} from '@kharcha/shared';
import { budgetsForMonths } from './budgets';
import { ledgerWhere, monthlyAggregates } from './reports';
import { getSettings } from './settings';

/**
 * Financial health for a month or a (calendar/financial) year. The API only gathers aggregates;
 * the scoring itself is the pure, unit-tested `computeHealth` in @kharcha/shared.
 */
export async function healthScore(
  d1: D1Database,
  userId: string,
  raw: { period?: string; date?: string; accountIds?: string },
): Promise<HealthScoreResponse> {
  const q = healthScoreQuerySchema.parse(raw);
  const settings = await getSettings(d1, userId);
  const range = periodRange(q.period, q.date, settings.yearMode);
  const today = toIstDate();
  // For the period containing today, score up to today (future months of it have no data yet).
  const lastMonth = (range.from <= today && today < range.to ? today : range.to).slice(0, 7);
  const periodMonths = monthsInRange(range.from, `${lastMonth}-01`);
  const historyMonths = monthsInRange(addMonths(`${lastMonth}-01`, -11), `${lastMonth}-01`);

  const all = await monthlyAggregates(d1, userId, historyMonths, q.accountIds);
  // Drop leading months before any data, so "6 months of history" means real history.
  const firstWithData = all.findIndex(
    (m) => m.income || m.needs || m.wants || m.unclassified || m.invested,
  );
  const history = firstWithData < 0 ? all.slice(-periodMonths.length) : all.slice(firstWithData);

  const budgetMonths = await budgetsForMonths(d1, userId, periodMonths, q.accountIds);
  let total = 0;
  let within = 0;
  const over = new Set<string>();
  for (const list of budgetMonths.values()) {
    for (const b of list) {
      total++;
      if (b.spentPaise <= b.amountPaise) within++;
      else over.add(b.name);
    }
  }

  // Wants by category over the last 3 months, for "cut X to Y" suggestions.
  const last3 = historyMonths.slice(-3);
  const w = ledgerWhere(userId, {
    from: `${last3[0]}-01`,
    to: `${lastMonth}-31`,
    accountIds: q.accountIds,
  });
  const { results: wantRows } = await d1
    .prepare(
      `select c.name as name, substr(l.txn_date, 1, 7) as month, sum(l.spend_paise) as spend
       from v_ledger l join categories c on c.id = l.category_id
       where ${w.sql} and l.kind = 'want' group by l.category_id, month`,
    )
    .bind(...w.params)
    .all<{ name: string; month: string; spend: number }>();
  const wants = new Map<string, number[]>();
  for (const r of wantRows) {
    const arr = wants.get(r.name) ?? last3.map(() => 0);
    const i = last3.indexOf(r.month);
    if (i >= 0) arr[i] = r.spend;
    wants.set(r.name, arr);
  }

  const result = computeHealth({
    history: history.length ? history : all.slice(-1),
    periodMonths: Math.min(periodMonths.length, Math.max(1, history.length)),
    budgets: { total, within, overNames: [...over] },
    emergencyFundPaise: settings.emergencyFundPaise,
    targets: settings.targets,
    wantCategories: [...wants].map(([name, months]) => ({ name, months })),
  });
  return { from: range.from, to: range.to, ...result, history };
}
