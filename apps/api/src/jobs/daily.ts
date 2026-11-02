import type { Env } from '../env';
import { log } from '../lib/logger';
import { refreshRecurring } from '../services/recurring';

/** Audit entries (undo history) are kept for 180 days. */
export const AUDIT_RETENTION_DAYS = 180;

/**
 * Daily cron (02:00 IST): rebuild recurring-payment caches (statuses like "stopped" depend on
 * today) and prune old audit entries. Logs counts only, never financial data.
 */
export async function runDailyJobs(env: Env, now = Date.now()) {
  const { results: users } = await env.DB.prepare('select id from users').all<{ id: string }>();
  let series = 0;
  for (const u of users) series += await refreshRecurring(env.DB, u.id);
  const cutoff = now - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pruned = await env.DB.prepare('delete from audit_log where created_at < ?1')
    .bind(cutoff)
    .run();
  const summary = { users: users.length, series, prunedAudit: pruned.meta.changes ?? 0 };
  log.info('daily_jobs', summary);
  return summary;
}
