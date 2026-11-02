import type { AccountType, Bank } from '../schemas/enums';
import type { ParsedAlert } from './parse';

export interface AlertAccount {
  id: string;
  last4: string | null;
  bank: Bank | null;
  type: AccountType;
  active: boolean;
}

/**
 * Pick the account an alert belongs to by the masked digits it prints (`XX1234`, `XX123` for
 * ICICI's 3-digit masks), narrowed by bank and card hint. Returns null when nothing matches or
 * the match is ambiguous; the user then picks the account in the preview.
 */
export function matchAlertAccount(
  alert: Pick<ParsedAlert, 'last4' | 'bank' | 'cardHint'>,
  accounts: AlertAccount[],
): string | null {
  const digits = alert.last4;
  if (!digits) return null;
  let candidates = accounts.filter(
    (a) => a.active && a.last4 && (a.last4.endsWith(digits) || digits.endsWith(a.last4)),
  );
  const narrow = (pred: (a: AlertAccount) => boolean) => {
    const kept = candidates.filter(pred);
    if (kept.length > 0) candidates = kept;
  };
  if (alert.bank) narrow((a) => a.bank === alert.bank);
  if (alert.cardHint === 'credit') narrow((a) => a.type === 'credit_card');
  else narrow((a) => a.type !== 'credit_card');
  return candidates.length === 1 ? (candidates[0] as AlertAccount).id : null;
}

/** Statement-row shape accepted by `POST /imports/:id/preview` (see `parsedRowSchema`). */
export function alertToRow(alert: ParsedAlert) {
  return {
    txnDate: alert.txnDate,
    valueDate: null,
    narration: alert.narration,
    refNo: alert.refNo,
    amountPaise: alert.amountPaise,
    direction: alert.direction,
    balancePaise: alert.balancePaise,
    sourceRow: alert.index + 1,
  };
}
