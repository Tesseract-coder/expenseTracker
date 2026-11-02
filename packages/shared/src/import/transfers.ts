import { diffDays } from '../dates';
import type { AccountType } from '../schemas/enums';

export interface TransferCandidate {
  key: string;
  accountId: string;
  accountType: AccountType;
  txnDate: string;
  amountPaise: number;
  direction: 'in' | 'out';
  narration: string | null;
}

export type TransferKind = 'self_transfer' | 'cc_bill_payment';
/** Preview-level kinds: pairs/hints plus ATM withdrawals moved to the Cash account. */
export type PreviewTransferKind = TransferKind | 'atm_cash';

export interface TransferPair {
  outKey: string;
  inKey: string;
  kind: TransferKind;
  confidence: 'high' | 'medium';
  reason: string;
}

export interface SingleLegHint {
  key: string;
  kind: TransferKind;
  confidence: 'high' | 'medium';
  reason: string;
}

const CC_PAYMENT_OUT =
  /(credit\s*card|\bcc\s*(payment|bill|pymt)|\bcc\b.*\bautopay|card\s*(bill|payment|pymt|dues)|billdesk.*card|autopay.*card|\bcred\b|cardpayment|ccpayment)/i;
const CC_PAYMENT_IN =
  /(payment\s*(received|recd|thank)|thank\s*you|autopay|bbps|payment\s*-\s*(neft|imps|upi)|repayment)/i;

const daysApart = (a: TransferCandidate, b: TransferCandidate) =>
  Math.abs(diffDays(a.txnDate, b.txnDate));

function mentionsLast4(narration: string | null, last4: string | null | undefined): boolean {
  return !!(narration && last4 && new RegExp(`(?<!\\d)${last4}(?!\\d)`).test(narration));
}

/**
 * Pair debits and credits that are the same money moving between the user's own accounts.
 * Rules (DATA_MODEL §6): opposite directions, different accounts, same amount, |Δdate| ≤ 2 days
 * (≤ 3 when a credit card is involved). Card involvement ⇒ credit-card bill payment.
 * One-to-one greedy assignment, closest dates and strongest evidence first.
 */
export function findTransferPairs(
  candidates: TransferCandidate[],
  last4ByAccount: Record<string, string | null | undefined> = {},
): TransferPair[] {
  const outs = candidates.filter((c) => c.direction === 'out');
  // Bucket credits by amount so each debit only meets same-amount credits (linear overall).
  const insByAmount = new Map<number, TransferCandidate[]>();
  for (const c of candidates) {
    if (c.direction !== 'in') continue;
    const list = insByAmount.get(c.amountPaise);
    if (list) list.push(c);
    else insByAmount.set(c.amountPaise, [c]);
  }
  const options: (TransferPair & { days: number; strength: number })[] = [];

  for (const o of outs) {
    for (const i of insByAmount.get(o.amountPaise) ?? []) {
      if (o.accountId === i.accountId) continue;
      if (o.accountType === 'credit_card') continue; // money doesn't leave a card into a bank as a "payment"
      const card = i.accountType === 'credit_card';
      const days = daysApart(o, i);
      if (days > (card ? 3 : 2)) continue;

      const kind: TransferKind = card ? 'cc_bill_payment' : 'self_transfer';
      const evidence: string[] = [];
      if (mentionsLast4(o.narration, last4ByAccount[i.accountId]))
        evidence.push('debit mentions the other account');
      if (mentionsLast4(i.narration, last4ByAccount[o.accountId]))
        evidence.push('credit mentions the other account');
      if (card && CC_PAYMENT_OUT.test(o.narration ?? '')) evidence.push('card payment wording');
      if (card && CC_PAYMENT_IN.test(i.narration ?? '')) evidence.push('payment received on card');
      const strength = evidence.length;
      options.push({
        outKey: o.key,
        inKey: i.key,
        kind,
        days,
        strength,
        confidence: strength > 0 || days === 0 ? 'high' : 'medium',
        reason: [
          `same amount, ${days === 0 ? 'same day' : `${days} day${days > 1 ? 's' : ''} apart`}`,
          ...evidence,
        ].join('; '),
      });
    }
  }

  options.sort((a, b) => b.strength - a.strength || a.days - b.days);
  const used = new Set<string>();
  const pairs: TransferPair[] = [];
  for (const { days: _d, strength: _s, ...p } of options) {
    if (used.has(p.outKey) || used.has(p.inKey)) continue;
    used.add(p.outKey);
    used.add(p.inKey);
    pairs.push(p);
  }
  return pairs;
}

/**
 * Single-leg hints for when the other side isn't imported (yet): a card-bill payment from a bank
 * account, or a payment received on a card. Such rows should not count as spend/income.
 */
export function singleLegHint(
  c: TransferCandidate,
  ownAccounts: { last4: string | null; accountType: AccountType }[] = [],
): SingleLegHint | null {
  const n = c.narration ?? '';
  const mentioned = ownAccounts.find((a) => mentionsLast4(n, a.last4));
  if (c.accountType !== 'credit_card' && c.direction === 'out') {
    if (CC_PAYMENT_OUT.test(n)) {
      return {
        key: c.key,
        kind: 'cc_bill_payment',
        confidence: 'high',
        reason: 'card payment wording',
      };
    }
    if (mentioned?.accountType === 'credit_card') {
      return {
        key: c.key,
        kind: 'cc_bill_payment',
        confidence: 'high',
        reason: `mentions your card ••${mentioned.last4}`,
      };
    }
  }
  if (c.accountType === 'credit_card' && c.direction === 'in' && CC_PAYMENT_IN.test(n)) {
    return {
      key: c.key,
      kind: 'cc_bill_payment',
      confidence: 'high',
      reason: 'payment received on card',
    };
  }
  if (mentioned && mentioned.accountType !== 'credit_card' && c.accountType !== 'credit_card') {
    return {
      key: c.key,
      kind: 'self_transfer',
      confidence: 'medium',
      reason: `mentions your account ••${mentioned.last4}`,
    };
  }
  return null;
}
