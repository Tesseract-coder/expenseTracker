import {
  addDays,
  detectRecurring,
  type Occurrence,
  type RecurringDto,
  toIstDate,
} from '@kharcha/shared';
import { notFound } from '../lib/errors';
import { newId } from '../lib/ids';

/** How far back detection looks (enough for a yearly charge to repeat). */
const LOOKBACK_DAYS = 400;
const REFRESH_KEY = 'recurring_refreshed_at';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const MONTHLY_FACTOR = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 } as const;

interface OccRow {
  cp: string;
  d: string;
  a: number;
  cat: string | null;
}

/**
 * Rebuilds the `recurring_series` cache for one user: per counterparty, outgoing non-transfer
 * payments over the last ~13 months go through the pure detector. Dismissals survive rebuilds
 * (keyed by counterparty + cadence).
 */
export async function refreshRecurring(d1: D1Database, userId: string, today = toIstDate()) {
  const since = addDays(today, -LOOKBACK_DAYS);
  const [{ results: rows }, { results: dismissed }] = await Promise.all([
    d1
      .prepare(
        `select t.counterparty_id as cp, t.txn_date as d, t.amount_paise as a, t.category_id as cat
         from transactions t left join categories c on c.id = t.category_id
         where t.user_id = ?1 and t.direction = 'out' and t.counterparty_id is not null
           and t.transfer_group_id is null and coalesce(c.type, '') != 'transfer' and t.txn_date >= ?2
           and t.counterparty_id in (
             select counterparty_id from transactions where user_id = ?1 and direction = 'out'
               and counterparty_id is not null and txn_date >= ?2
             group by counterparty_id having count(*) >= 2)
         order by t.counterparty_id, t.txn_date`,
      )
      .bind(userId, since)
      .all<OccRow>(),
    d1
      .prepare(
        'select counterparty_id as cp, cadence from recurring_series where user_id = ?1 and dismissed = 1',
      )
      .bind(userId)
      .all<{ cp: string; cadence: string }>(),
  ]);
  const dismissedKeys = new Set(dismissed.map((r) => `${r.cp}|${r.cadence}`));

  const groups = new Map<string, OccRow[]>();
  for (const r of rows) {
    const list = groups.get(r.cp) ?? [];
    list.push(r);
    groups.set(r.cp, list);
  }
  const now = Date.now();
  const series: Record<string, unknown>[] = [];
  for (const [cp, occ] of groups) {
    const match = detectRecurring(
      occ.map((o): Occurrence => ({ date: o.d, amountPaise: o.a })),
      today,
    );
    if (!match) continue;
    series.push({
      id: newId(),
      cp,
      cat: occ.at(-1)?.cat ?? null,
      cadence: match.cadence,
      typical: match.typicalAmountPaise,
      last: match.lastAmountPaise,
      tol: match.amountTolerancePct,
      lastDate: match.lastDate,
      next: match.nextExpectedDate,
      n: match.occurrences,
      status: match.status,
      dismissed: dismissedKeys.has(`${cp}|${match.cadence}`) ? 1 : 0,
    });
  }

  await d1.batch([
    d1.prepare('delete from recurring_series where user_id = ?1').bind(userId),
    d1
      .prepare(
        `insert into recurring_series (id, user_id, counterparty_id, category_id, cadence, typical_amount_paise,
           last_amount_paise, amount_tolerance_pct, last_date, next_expected_date, occurrences, status, dismissed, updated_at)
         select json_extract(value, '$.id'), ?1, json_extract(value, '$.cp'),
           (select id from categories where id = json_extract(value, '$.cat')),
           json_extract(value, '$.cadence'), json_extract(value, '$.typical'), json_extract(value, '$.last'),
           json_extract(value, '$.tol'), json_extract(value, '$.lastDate'), json_extract(value, '$.next'),
           json_extract(value, '$.n'), json_extract(value, '$.status'), json_extract(value, '$.dismissed'), ?2
         from json_each(?3)`,
      )
      .bind(userId, now, JSON.stringify(series)),
    d1
      .prepare(
        `insert into settings (user_id, key, value, updated_at) values (?1, ?2, ?3, ?3)
         on conflict (user_id, key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      )
      .bind(userId, REFRESH_KEY, now),
  ]);
  return series.length;
}

/** The cache is stale after any transaction change, or after 12 h (statuses depend on today). */
async function isStale(d1: D1Database, userId: string): Promise<boolean> {
  const r = await d1
    .prepare(
      `select (select cast(value as integer) from settings where user_id = ?1 and key = ?2) as refreshed,
         (select max(updated_at) from transactions where user_id = ?1) as changed`,
    )
    .bind(userId, REFRESH_KEY)
    .first<{ refreshed: number | null; changed: number | null }>();
  if (!r?.refreshed) return true;
  return (r.changed ?? 0) > r.refreshed || Date.now() - r.refreshed > MAX_AGE_MS;
}

interface SeriesRow {
  id: string;
  counterparty_id: string;
  name: string;
  category_id: string | null;
  cadence: RecurringDto['cadence'];
  typical_amount_paise: number;
  last_amount_paise: number | null;
  last_date: string;
  next_expected_date: string | null;
  occurrences: number;
  status: RecurringDto['status'];
  dismissed: number;
}

export async function listRecurring(d1: D1Database, userId: string) {
  if (await isStale(d1, userId)) await refreshRecurring(d1, userId);
  const { results } = await d1
    .prepare(
      `select r.*, cp.display_name as name from recurring_series r
       join counterparties cp on cp.id = r.counterparty_id
       where r.user_id = ?1 order by r.next_expected_date`,
    )
    .bind(userId)
    .all<SeriesRow>();
  const series: RecurringDto[] = results.map((r) => ({
    id: r.id,
    counterparty: { id: r.counterparty_id, name: r.name },
    categoryId: r.category_id,
    cadence: r.cadence,
    typicalAmountPaise: r.typical_amount_paise,
    lastAmountPaise: r.last_amount_paise,
    lastDate: r.last_date,
    nextExpectedDate: r.next_expected_date,
    occurrences: r.occurrences,
    status: r.status,
    dismissed: r.dismissed === 1,
  }));
  const monthlyTotalPaise = Math.round(
    series
      .filter((s) => !s.dismissed && s.status !== 'stopped')
      .reduce(
        (a, s) => a + (s.lastAmountPaise ?? s.typicalAmountPaise) * MONTHLY_FACTOR[s.cadence],
        0,
      ),
  );
  return { series, monthlyTotalPaise };
}

export async function setRecurringDismissed(
  d1: D1Database,
  userId: string,
  id: string,
  dismissed: boolean,
) {
  const r = await d1
    .prepare('update recurring_series set dismissed = ?3 where user_id = ?1 and id = ?2')
    .bind(userId, id, dismissed ? 1 : 0)
    .run();
  if (!r.meta.changes) throw notFound('Recurring payment not found');
}
