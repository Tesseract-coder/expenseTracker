import {
  addDays,
  diffDays,
  type DateRange,
  fyLabel,
  type ReportQuery,
  reportQuerySchema,
  shareChanges,
  type SummaryResponse,
  type Totals,
  type TrendsQuery,
  type TrendsResponse,
  trendsQuerySchema,
  type TxnLite,
  weekdayCounts,
  weekStart,
  type WhenResponse,
  type WhereResponse,
  monthsInRange,
} from '@kharcha/shared';

/**
 * Reports read the `v_ledger` view (migrations/0003_v_ledger.sql): one row per categorized amount,
 * split parts exploded, `kind` in income|need|want|investment|transfer|uncategorized. All
 * aggregation happens in SQL; the Worker only shapes results.
 */

export interface LedgerFilter {
  from: string;
  to: string;
  accountIds?: string[] | undefined;
}

/** `where` for v_ledger aliased `l`, with params ?1 user, ?2 from, ?3 to, ?4 accounts JSON. */
export function ledgerWhere(userId: string, f: LedgerFilter) {
  return {
    sql: `l.user_id = ?1 and l.txn_date between ?2 and ?3
      and (?4 is null or l.account_id in (select value from json_each(?4)))`,
    params: [
      userId,
      f.from,
      f.to,
      f.accountIds?.length ? JSON.stringify(f.accountIds) : null,
    ] as unknown[],
  };
}

const SPEND_KINDS = `l.kind in ('need', 'want', 'uncategorized')`;

interface TotalsRow {
  income: number;
  needs: number;
  wants: number;
  unclassified: number;
  invested: number;
  uncat_in: number;
}

export async function totals(d1: D1Database, userId: string, f: LedgerFilter): Promise<Totals> {
  const w = ledgerWhere(userId, f);
  const r = await d1
    .prepare(
      `select
         coalesce(sum(case when l.kind = 'income' then l.signed_paise end), 0) as income,
         coalesce(sum(case when l.kind = 'need' then l.spend_paise end), 0) as needs,
         coalesce(sum(case when l.kind = 'want' then l.spend_paise end), 0) as wants,
         coalesce(sum(case when l.kind = 'uncategorized' then l.spend_paise end), 0) as unclassified,
         coalesce(sum(case when l.kind = 'investment' then -l.signed_paise end), 0) as invested,
         coalesce(sum(case when l.kind = 'uncategorized' and l.direction = 'in' then l.amount_paise end), 0) as uncat_in
       from v_ledger l where ${w.sql}`,
    )
    .bind(...w.params)
    .first<TotalsRow>();
  const t = r ?? { income: 0, needs: 0, wants: 0, unclassified: 0, invested: 0, uncat_in: 0 };
  const spend = t.needs + t.wants + t.unclassified;
  const netSavings = t.income - spend;
  return {
    income: t.income,
    spend,
    needs: t.needs,
    wants: t.wants,
    unclassified: t.unclassified,
    invested: t.invested,
    netSavings,
    savingsRate: t.income > 0 ? netSavings / t.income : null,
    uncategorizedIncome: t.uncat_in,
  };
}

async function spendByCategory(d1: D1Database, userId: string, f: LedgerFilter) {
  const w = ledgerWhere(userId, f);
  const { results } = await d1
    .prepare(
      `select l.category_id as categoryId, l.group_id as groupId, sum(l.spend_paise) as spend,
         count(distinct l.txn_id) as count
       from v_ledger l where ${w.sql} and ${SPEND_KINDS}
       group by l.category_id, l.group_id`,
    )
    .bind(...w.params)
    .all<{ categoryId: string; groupId: string; spend: number; count: number }>();
  return results;
}

/** Trend granularity that keeps a chart readable for the range. */
export function summaryGranularity(range: DateRange): 'day' | 'week' | 'month' {
  const days = diffDays(range.from, range.to) + 1;
  return days <= 62 ? 'day' : days <= 190 ? 'week' : 'month';
}

/** Every bucket key in the range, so charts show gaps as zero rather than skipping them. */
export function bucketsInRange(
  granularity: 'day' | 'week' | 'month' | 'year',
  range: DateRange,
  yearMode: 'calendar' | 'fy' = 'calendar',
): string[] {
  const out: string[] = [];
  if (granularity === 'day') {
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d);
  } else if (granularity === 'week') {
    for (let d = weekStart(range.from); d <= range.to; d = addDays(d, 7)) out.push(d);
  } else if (granularity === 'month') {
    out.push(...monthsInRange(range.from, range.to));
  } else {
    const startYear = (d: string) =>
      yearMode === 'fy' && Number(d.slice(5, 7)) < 4
        ? Number(d.slice(0, 4)) - 1
        : Number(d.slice(0, 4));
    for (let y = startYear(range.from); y <= startYear(range.to); y++)
      out.push(yearMode === 'fy' ? fyLabel(y) : String(y));
  }
  return out;
}

function bucketExpr(granularity: 'day' | 'week' | 'month' | 'year', yearMode: 'calendar' | 'fy') {
  switch (granularity) {
    case 'day':
      return 'l.txn_date';
    case 'week':
      return 'l.week_start';
    case 'month':
      return 'substr(l.txn_date, 1, 7)';
    case 'year':
      return yearMode === 'fy'
        ? `(case when cast(substr(l.txn_date, 6, 2) as integer) >= 4 then cast(substr(l.txn_date, 1, 4) as integer)
             else cast(substr(l.txn_date, 1, 4) as integer) - 1 end)`
        : 'substr(l.txn_date, 1, 4)';
  }
}

export async function summary(
  d1: D1Database,
  userId: string,
  raw: ReportQuery,
): Promise<SummaryResponse> {
  const q = reportQuerySchema.parse(raw);
  const f = { from: q.from, to: q.to, accountIds: q.accountIds };
  const compare =
    q.compareFrom && q.compareTo
      ? { from: q.compareFrom, to: q.compareTo, accountIds: q.accountIds }
      : null;
  const granularity = summaryGranularity(q);
  const w = ledgerWhere(userId, f);
  const [current, previous, cats, prevCats, trendRows] = await Promise.all([
    totals(d1, userId, f),
    compare ? totals(d1, userId, compare) : Promise.resolve(null),
    spendByCategory(d1, userId, f),
    compare ? spendByCategory(d1, userId, compare) : Promise.resolve([]),
    d1
      .prepare(
        `select ${bucketExpr(granularity, 'calendar')} as bucket, sum(l.spend_paise) as spend
         from v_ledger l where ${w.sql} and ${SPEND_KINDS} group by bucket`,
      )
      .bind(...w.params)
      .all<{ bucket: string; spend: number }>(),
  ]);

  const prevByCat = new Map(prevCats.map((c) => [c.categoryId, c.spend]));
  const groups = new Map<string, number>();
  for (const c of cats) groups.set(c.groupId, (groups.get(c.groupId) ?? 0) + c.spend);
  const trendBy = new Map(trendRows.results.map((r) => [String(r.bucket), r.spend]));

  return {
    totals: current,
    previous,
    byGroup: [...groups]
      .map(([groupId, spend]) => ({ groupId, spend }))
      .filter((g) => g.spend !== 0)
      .sort((a, b) => b.spend - a.spend),
    byCategory: cats
      .filter((c) => c.spend !== 0 || prevByCat.get(c.categoryId))
      .map((c) => ({
        categoryId: c.categoryId,
        groupId: c.groupId,
        spend: c.spend,
        previous: prevByCat.get(c.categoryId) ?? 0,
      }))
      .sort((a, b) => b.spend - a.spend),
    trend: {
      granularity,
      points: bucketsInRange(granularity, q).map((bucket) => ({
        bucket,
        spend: trendBy.get(bucket) ?? 0,
      })),
    },
  };
}

export async function trends(
  d1: D1Database,
  userId: string,
  raw: TrendsQuery,
): Promise<TrendsResponse> {
  const q = trendsQuerySchema.parse(raw);
  const w = ledgerWhere(userId, q);
  const b = bucketExpr(q.granularity, q.yearMode);
  const [totalsRows, catRows] = await Promise.all([
    d1
      .prepare(
        `select ${b} as bucket,
           coalesce(sum(case when l.kind = 'income' then l.signed_paise end), 0) as income,
           coalesce(sum(l.spend_paise), 0) as spend,
           coalesce(sum(case when l.kind = 'investment' then -l.signed_paise end), 0) as invested
         from v_ledger l where ${w.sql} group by bucket`,
      )
      .bind(...w.params)
      .all<{ bucket: string | number; income: number; spend: number; invested: number }>(),
    d1
      .prepare(
        `select ${b} as bucket, l.category_id as categoryId, sum(l.spend_paise) as spend
         from v_ledger l where ${w.sql} and ${SPEND_KINDS}
         group by bucket, l.category_id having sum(l.spend_paise) != 0`,
      )
      .bind(...w.params)
      .all<{ bucket: string | number; categoryId: string; spend: number }>(),
  ]);
  const key = (bucket: string | number) =>
    q.granularity === 'year' && q.yearMode === 'fy' ? fyLabel(Number(bucket)) : String(bucket);
  const byBucket = new Map(totalsRows.results.map((r) => [key(r.bucket), r]));
  return {
    granularity: q.granularity,
    buckets: bucketsInRange(q.granularity, q, q.yearMode).map((bucket) => {
      const r = byBucket.get(bucket);
      return { bucket, income: r?.income ?? 0, spend: r?.spend ?? 0, invested: r?.invested ?? 0 };
    }),
    categories: catRows.results.map((r) => ({ ...r, bucket: key(r.bucket) })),
  };
}

/** Lightweight transaction rows (title = payee, note, narration or category). */
export async function txnLites(
  d1: D1Database,
  userId: string,
  ids: string[],
): Promise<Map<string, TxnLite>> {
  if (ids.length === 0) return new Map();
  const { results } = await d1
    .prepare(
      `select t.id, t.txn_date as txnDate, t.amount_paise as amountPaise, t.direction, t.category_id as categoryId,
         coalesce(cp.display_name, t.note, t.raw_narration, c.name, 'Transaction') as title
       from transactions t
       left join counterparties cp on cp.id = t.counterparty_id
       left join categories c on c.id = t.category_id
       where t.user_id = ?1 and t.id in (select value from json_each(?2))`,
    )
    .bind(userId, JSON.stringify(ids))
    .all<TxnLite>();
  return new Map(results.map((r) => [r.id, r]));
}

export async function whenReport(
  d1: D1Database,
  userId: string,
  raw: ReportQuery,
): Promise<WhenResponse> {
  const q = reportQuerySchema.parse(raw);
  const w = ledgerWhere(userId, q);
  const base = `from v_ledger l where ${w.sql} and ${SPEND_KINDS}`;
  const run = <T>(select: string, tail: string) =>
    d1
      .prepare(`select ${select} ${base} ${tail}`)
      .bind(...w.params)
      .all<T>();
  const [daily, dow, wom, weeks, months] = await Promise.all([
    run<{ date: string; spend: number }>(
      'l.txn_date as date, sum(l.spend_paise) as spend',
      'group by l.txn_date order by l.txn_date',
    ),
    run<{ dow: number; spend: number }>(
      'l.dow as dow, sum(l.spend_paise) as spend',
      'group by l.dow',
    ),
    run<{ week: number; spend: number }>(
      '((cast(substr(l.txn_date, 9, 2) as integer) + 6) / 7) as week, sum(l.spend_paise) as spend',
      'group by week',
    ),
    run<{ weekStart: string; spend: number }>(
      'l.week_start as weekStart, sum(l.spend_paise) as spend',
      'group by l.week_start having sum(l.spend_paise) > 0 order by spend desc limit 3',
    ),
    run<{ month: string; spend: number }>(
      'substr(l.txn_date, 1, 7) as month, sum(l.spend_paise) as spend',
      'group by month having sum(l.spend_paise) > 0 order by spend desc limit 3',
    ),
  ]);

  const topDays = [...daily.results]
    .filter((d) => d.spend > 0)
    .sort((a, b) => b.spend - a.spend || (a.date < b.date ? -1 : 1))
    .slice(0, 5);
  // The biggest spends behind each top day.
  const { results: dayTxns } = topDays.length
    ? await d1
        .prepare(
          `select l.txn_id as id, l.txn_date as date, sum(l.spend_paise) as spend ${base}
             and l.txn_date in (select value from json_each(?5))
           group by l.txn_id having sum(l.spend_paise) > 0 order by spend desc`,
        )
        .bind(...w.params, JSON.stringify(topDays.map((d) => d.date)))
        .all<{ id: string; date: string; spend: number }>()
    : { results: [] as { id: string; date: string; spend: number }[] };
  const perDay = new Map<string, string[]>();
  for (const t of dayTxns) {
    const list = perDay.get(t.date) ?? [];
    if (list.length < 3) list.push(t.id);
    perDay.set(t.date, list);
  }
  const lites = await txnLites(d1, userId, [...perDay.values()].flat());
  const counts = weekdayCounts(q.from, q.to);
  const dowBy = new Map(dow.results.map((r) => [r.dow, r.spend]));
  const womBy = new Map(wom.results.map((r) => [r.week, r.spend]));

  return {
    daily: daily.results,
    byDow: [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const spend = dowBy.get(d) ?? 0;
      return { dow: d, spend, average: counts[d] ? Math.round(spend / (counts[d] as number)) : 0 };
    }),
    byWeekOfMonth: [1, 2, 3, 4, 5].map((week) => ({ week, spend: womBy.get(week) ?? 0 })),
    topDays: topDays.map((d) => ({
      ...d,
      top: (perDay.get(d.date) ?? []).flatMap((id) => {
        const l = lites.get(id);
        return l ? [l] : [];
      }),
    })),
    topWeeks: weeks.results,
    topMonths: months.results,
  };
}

export async function whereReport(
  d1: D1Database,
  userId: string,
  raw: ReportQuery,
): Promise<WhereResponse> {
  const q = reportQuerySchema.parse(raw);
  const w = ledgerWhere(userId, q);
  const base = `from v_ledger l where ${w.sql} and ${SPEND_KINDS}`;
  const compare =
    q.compareFrom && q.compareTo
      ? { from: q.compareFrom, to: q.compareTo, accountIds: q.accountIds }
      : null;
  const [cats, cps, txns, prevCats] = await Promise.all([
    spendByCategory(d1, userId, q),
    d1
      .prepare(
        `select l.counterparty_id as id, cp.display_name as name, sum(l.spend_paise) as spend,
           count(distinct l.txn_id) as count
         ${base.replace('from v_ledger l', 'from v_ledger l join counterparties cp on cp.id = l.counterparty_id')}
         group by l.counterparty_id having sum(l.spend_paise) > 0 order by spend desc limit 10`,
      )
      .bind(...w.params)
      .all<{ id: string; name: string; spend: number; count: number }>(),
    d1
      .prepare(
        `select l.txn_id as id, sum(l.spend_paise) as spend ${base}
         group by l.txn_id having sum(l.spend_paise) > 0 order by spend desc limit 10`,
      )
      .bind(...w.params)
      .all<{ id: string; spend: number }>(),
    compare ? spendByCategory(d1, userId, compare) : Promise.resolve([]),
  ]);
  const lites = await txnLites(
    d1,
    userId,
    txns.results.map((t) => t.id),
  );
  const changes = compare
    ? shareChanges(
        new Map(cats.map((c) => [c.categoryId, c.spend])),
        new Map(prevCats.map((c) => [c.categoryId, c.spend])),
      ).slice(0, 8)
    : [];
  return {
    topCategories: cats
      .filter((c) => c.spend > 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10)
      .map(({ categoryId, spend, count }) => ({ categoryId, spend, count })),
    topCounterparties: cps.results,
    topTransactions: txns.results.flatMap((t) => {
      const l = lites.get(t.id);
      return l ? [{ ...l, amountPaise: t.spend }] : [];
    }),
    changes: changes.map(({ id, ...c }) => ({ categoryId: id, ...c })),
  };
}

/** Monthly aggregates for the health score (months with no data come back as zeros). */
export async function monthlyAggregates(
  d1: D1Database,
  userId: string,
  months: string[],
  accountIds?: string[],
) {
  const first = months[0];
  const last = months.at(-1);
  if (!first || !last) return [];
  const w = ledgerWhere(userId, { from: `${first}-01`, to: `${last}-31`, accountIds });
  const { results } = await d1
    .prepare(
      `select substr(l.txn_date, 1, 7) as month,
         coalesce(sum(case when l.kind = 'income' then l.signed_paise end), 0) as income,
         coalesce(sum(case when l.kind = 'need' then l.spend_paise end), 0) as needs,
         coalesce(sum(case when l.kind = 'want' then l.spend_paise end), 0) as wants,
         coalesce(sum(case when l.kind = 'uncategorized' then l.spend_paise end), 0) as unclassified,
         coalesce(sum(case when l.kind = 'investment' then -l.signed_paise end), 0) as invested
       from v_ledger l where ${w.sql} group by month`,
    )
    .bind(...w.params)
    .all<{
      month: string;
      income: number;
      needs: number;
      wants: number;
      unclassified: number;
      invested: number;
    }>();
  const by = new Map(results.map((r) => [r.month, r]));
  return months.map(
    (month) =>
      by.get(month) ?? { month, income: 0, needs: 0, wants: 0, unclassified: 0, invested: 0 },
  );
}
