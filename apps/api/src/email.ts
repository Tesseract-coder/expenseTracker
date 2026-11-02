import PostalMime from 'postal-mime';
import { matchAlertAccount, alertToRow, parseEmailAlerts, toIstDate } from '@kharcha/shared';
import { and, eq } from 'drizzle-orm';
import type { Env } from './env';
import { getDb } from './db/client';
import { accounts } from './db/schema';
import { log } from './lib/logger';
import { commitImport, createAlertImport, previewImport } from './services/imports';
import { resolveUser } from './services/users';

/** Bank alert e-mails are small; anything bigger is not an alert. */
export const MAX_ALERT_EMAIL_BYTES = 256 * 1024;

const list = (s: string | undefined) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

export interface AlertEmailResult {
  alerts: number;
  inserted: number;
  unmatched: number;
}

/**
 * Email Routing → Worker (spec §3.4). Accepts mail only from `ALERT_SENDERS` (the envelope sender,
 * i.e. your own address when you forward or auto-forward), parses alerts with the shared parsers,
 * matches accounts by their last digits and commits them as `needs_review` transactions owned by
 * the first `ALLOWED_EMAILS` user. Nothing is replied; amounts and text are never logged.
 */
export async function handleAlertEmail(
  message: Pick<ForwardableEmailMessage, 'from' | 'raw' | 'rawSize' | 'setReject'>,
  env: Env,
): Promise<AlertEmailResult | null> {
  const senders = list(env.ALERT_SENDERS);
  if (!senders.includes(message.from.trim().toLowerCase())) {
    message.setReject('Sender not allowed');
    log.warn('alert email rejected', { code: 'sender_not_allowed' });
    return null;
  }
  if (message.rawSize > MAX_ALERT_EMAIL_BYTES) {
    message.setReject('Message too large');
    log.warn('alert email rejected', { code: 'too_large' });
    return null;
  }
  const owner = list(env.ALLOWED_EMAILS)[0];
  if (!owner) {
    message.setReject('Not configured');
    log.error('alert email rejected', { code: 'no_owner' });
    return null;
  }

  const email = await PostalMime.parse(message.raw);
  const sentAt = email.date ? Date.parse(email.date) : NaN;
  const alerts = parseEmailAlerts(email, {
    fallbackDate: toIstDate(Number.isFinite(sentAt) ? sentAt : Date.now()),
  });
  const user = await resolveUser(env.DB, owner);
  const db = getDb(env.DB);
  const accountRows = await db
    .select({
      id: accounts.id,
      last4: accounts.last4,
      bank: accounts.bank,
      type: accounts.type,
      active: accounts.active,
    })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.active, 1)));
  const candidates = accountRows.map((a) => ({ ...a, active: a.active === 1 }));

  const byAccount = new Map<string, ReturnType<typeof alertToRow>[]>();
  let unmatched = 0;
  for (const a of alerts) {
    const accountId = matchAlertAccount(a, candidates);
    if (!accountId) {
      unmatched++;
      continue;
    }
    const rows = byAccount.get(accountId) ?? [];
    rows.push(alertToRow(a));
    byAccount.set(accountId, rows);
  }

  let inserted = 0;
  for (const [accountId, rows] of byAccount) {
    const importId = await createAlertImport(db, user.id, accountId, 'email');
    const dates = rows.map((r) => r.txnDate).sort();
    const preview = await previewImport(db, env, user.id, importId, {
      profileId: 'email',
      rows,
      statementFrom: dates[0] ?? null,
      statementTo: dates.at(-1) ?? null,
      closingBalancePaise: null,
      parseErrors: 0,
    });
    // Unattended: skip possible duplicates, accept only high-confidence transfer suggestions
    // (e.g. ATM → Cash). Everything lands in "Needs review" anyway.
    const result = await commitImport(db, env, user.id, importId, {
      includeNearDuplicates: [],
      acceptTransfers: preview.rows
        .filter((r) => r.transfer?.confidence === 'high')
        .map((r) => r.index),
    });
    inserted += result.inserted;
  }

  const result = { alerts: alerts.length, inserted, unmatched };
  log.info('alert email processed', result);
  return result;
}
