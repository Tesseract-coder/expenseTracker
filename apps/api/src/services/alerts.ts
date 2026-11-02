import {
  type AlertsCommitRequest,
  type AlertsPreviewRequest,
  type AlertsPreviewResponse,
  alertsCommitRequestSchema,
} from '@kharcha/shared';
import type { Env } from '../env';
import type { Db } from '../db/client';
import { commitImport, createAlertImport, previewImport } from './imports';

/**
 * Pasted SMS alerts (spec §3.3). Alerts are parsed in the browser (shared `parseAlerts`), the user
 * assigns each to an account, and each account's alerts become one `imports` row (source `sms`)
 * that goes through the regular statement preview → commit: dedup, transfers, categorization,
 * history and revert all come for free.
 */
export async function previewAlerts(
  db: Db,
  env: Env,
  userId: string,
  req: AlertsPreviewRequest,
): Promise<AlertsPreviewResponse> {
  const byAccount = new Map<string, AlertsPreviewRequest['rows']>();
  for (const row of req.rows) {
    const list = byAccount.get(row.accountId);
    if (list) list.push(row);
    else byAccount.set(row.accountId, [row]);
  }
  const groups: AlertsPreviewResponse['groups'] = [];
  for (const [accountId, rows] of byAccount) {
    const importId = await createAlertImport(db, userId, accountId, 'sms');
    const dates = rows.map((r) => r.txnDate).sort();
    const preview = await previewImport(db, env, userId, importId, {
      profileId: 'sms',
      rows: rows.map(({ accountId: _a, ...r }) => r),
      statementFrom: dates[0] ?? null,
      statementTo: dates.at(-1) ?? null,
      closingBalancePaise: null,
      parseErrors: 0,
    });
    groups.push({ accountId, importId, preview });
  }
  return { groups };
}

export async function commitAlerts(db: Db, env: Env, userId: string, raw: AlertsCommitRequest) {
  const req = alertsCommitRequestSchema.parse(raw);
  const total = {
    inserted: 0,
    skippedDuplicates: 0,
    transfersLinked: 0,
    categorized: 0,
    alertsConfirmed: 0,
    importIds: [] as string[],
  };
  // One D1 batch per account: each import is atomic on its own.
  for (const { importId, ...decisions } of req.groups) {
    const r = await commitImport(db, env, userId, importId, decisions);
    total.inserted += r.inserted;
    total.skippedDuplicates += r.skippedDuplicates;
    total.transfersLinked += r.transfersLinked;
    total.categorized += r.categorized;
    total.importIds.push(importId);
  }
  return total;
}
