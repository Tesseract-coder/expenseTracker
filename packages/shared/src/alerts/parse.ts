/**
 * Bank SMS / e-mail alert parsing (spec §3.3, §3.4). Pure: runs in the browser for the paste flow
 * and in the Worker's email() handler.
 *
 *   Sent Rs.500.00 From HDFC Bank A/C *1234 To SWIGGY On 01/11/26 Ref 412345678901 Not You? …
 *   ICICI Bank Acct XX123 debited for Rs 500.00 on 01-Nov-26; SWIGGY credited. UPI:412345678901.
 *   Dear UPI user A/C X1234 debited by 500.0 on date 01Nov26 trf to SWIGGY Refno 412345678901.
 *   INR 1,299.00 spent using ICICI Bank Card XX1234 on 01-Nov-26 on AMAZON. Avl Limit: INR 9,870.
 *
 * Each alert becomes a statement-like row: the narration is re-built in bank-statement shape
 * (`UPI/DR/<ref>/<payee>/<vpa>`, `POS <merchant>`, `ATM WDL`) so normalization, learned labels and
 * rules treat it exactly like an imported row.
 */
import { addDays, type IsoDate } from '../dates';
import { parseRupeesToPaise } from '../money';
import type { Bank, Channel } from '../schemas/enums';
import { parseStatementDate } from '../import/values';

export const MAX_ALERT_TEXT = 20_000;
export const MAX_ALERTS = 200;

export type CardHint = 'credit' | 'debit' | null;

export interface ParsedAlert {
  /** Position of the message in the pasted text (0-based). */
  index: number;
  /** The message as received, whitespace-collapsed (≤ 500 chars). Shown in the preview only. */
  raw: string;
  amountPaise: number;
  direction: 'in' | 'out';
  txnDate: IsoDate;
  /** False when the message had no usable date and `fallbackDate` was used. */
  dateFromText: boolean;
  /** Last 3–4 digits of the account/card as printed in the alert. */
  last4: string | null;
  bank: Bank | null;
  cardHint: CardHint;
  channel: Channel;
  vpa: string | null;
  payee: string | null;
  refNo: string | null;
  balancePaise: number | null;
  /** Statement-shaped narration (see module doc). */
  narration: string;
}

export type SkipReason =
  'otp' | 'request' | 'reminder' | 'failed' | 'promo' | 'no_amount' | 'no_direction';

export interface SkippedAlert {
  index: number;
  raw: string;
  reason: SkipReason;
}

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  otp: 'OTP or verification message',
  request: 'Payment request, not a payment',
  reminder: 'Reminder or upcoming debit',
  failed: 'Failed or declined transaction',
  promo: 'Offer or promotion',
  no_amount: 'No amount found',
  no_direction: "Couldn't tell if money went in or out",
};

export interface ParseAlertOptions {
  /** IST date used when a message has no date (paste day, or the e-mail's Date header). */
  fallbackDate: IsoDate;
}

// ---------------------------------------------------------------------------- patterns

const REJECTS: readonly (readonly [SkipReason, RegExp])[] = [
  ['otp', /\bOTP\b|one[\s-]time password|verification code|\bcode is \d/i],
  [
    'request',
    /\bhas requested\b|\brequested (?:money|rs|inr)|collect request|\brequest(?:ing)? (?:for )?(?:rs|inr|₹)/i,
  ],
  [
    'reminder',
    /will be (?:debited|deducted|charged)|\bis due\b|\bdue (?:date|on|by)\b|(?:min(?:imum)?|total) (?:amt|amount) due|statement (?:is |has been )?generated|\bpayment reminder\b|\bscheduled (?:for|on)\b/i,
  ],
  [
    'failed',
    /\b(?:declined|failed|unsuccessful|could not be (?:processed|completed)|insufficient (?:funds|balance))\b/i,
  ],
  ['promo', /pre-?approved|\bapply now\b|\bT&C\b|\blimited period\b|\bexclusive offer\b/i],
];

/** Everything from these phrases on is boilerplate (helplines, block-card numbers). */
const TAIL =
  /\b(?:not you\??|if not (?:done )?by you|not done by you|if this (?:was|is) not you|to block|report (?:fraud|unauthori[sz]ed)|call (?:us )?(?:on |at )?\d{3,}|sms block|never share|for dispute|to dispute)\b/i;

const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
/** SBI writes "debited by 500.0" with no currency symbol. */
const BARE_AMOUNT_RE =
  /\b(?:debited|credited)\s+(?:by|with|for)\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)\b/i;
const BALANCE_CONTEXT = /(?:bal(?:ance)?|avl|available|limit|o\/s|outstanding)[^0-9]{0,20}$/i;
const LIMIT_CONTEXT = /(?:limit|o\/s|outstanding)[^0-9]{0,20}$/i;

const OUT_RE =
  /\b(?:debited|debit(?:ed)? (?:for|by|with)|spent|paid|sent|withdrawn|withdrawal|purchase|transferred to|used (?:for|at))\b/i;
const IN_RE = /\b(?:credited|received|deposited|refund(?:ed)?|reversed|reversal|added to)\b/i;

const LAST4_RES = [
  /\b(?:a\/c|ac|acct|account|card)(?:\s*(?:no\.?|number|ending(?:\s+(?:with|in))?))?\s*[:.]?\s*[x*•.]*\s?(\d{3,6})\b/i,
  /(?:^|[\s(])[x*]{2,}(\d{3,4})\b/i,
];

const VPA_RE = /\b([a-z0-9][a-z0-9._-]{1,63})@([a-z][a-z0-9]{1,19})(?![a-z0-9@]|\.[a-z])/i;

const REF_RES = [
  /\b(?:upi\s*)?(?:ref(?:erence)?|rrn|utr|txn\s*(?:id|no))(?:\s*(?:no|number|id))?\.?(?:\s+is)?\s*[:.#-]?\s*([A-Z0-9]{6,22})\b/i,
  /\brefno\s*[:.#-]?\s*([A-Z0-9]{6,22})\b/i,
  /\bUPI[:\s/-]+(?:P2[AMP]\/)?(\d{12})\b/i,
];

/** A bank-statement-shaped description already present in the alert ("for NEFT Cr-ACME-SALARY"). */
const INFO_RES = [
  /\b(UPI\/(?:P2[AMP]|DR|CR)\/\d{6,}\/[^\s.;]+)/i,
  /\b(?:for|info:?)\s+((?:NEFT|IMPS|RTGS)[\s-][^.;]{3,80}?)(?=\.\s|\.?\s*(?:avl|bal|ref)\b|[.;]?$)/i,
];

const PAYEE_STOP =
  '(?=\\s+(?:on|ref|refno|ref\\.?|via|using|upi|avl|bal|from|for|dated|at|is|has|by|with|and)\\b|\\s*[;(]|\\.\\s|\\.$|$)';
const OUT_PAYEE_RES = [
  /;\s*([A-Za-z][\w .&'-]{1,60}?)\s+credited\b/i,
  new RegExp(
    `\\b(?:at|to|towards|trf to|paid to|sent to|transfer to)\\s+(?:vpa\\s+|merchant\\s+)?(.{2,60}?)${PAYEE_STOP}`,
    'gi',
  ),
  new RegExp(`\\bon\\s+([A-Za-z][\\w .&'*-]{1,60}?)${PAYEE_STOP}`, 'gi'),
];
const IN_PAYEE_RES = [
  new RegExp(`\\b(?:from|by)\\s+(?:vpa\\s+)?(.{2,60}?)${PAYEE_STOP}`, 'gi'),
  /;\s*([A-Za-z][\w .&'-]{1,60}?)\s+debited\b/i,
];

const BANK_RES: readonly (readonly [Bank, RegExp])[] = [
  ['hdfc', /\bHDFC\b/i],
  ['icici', /\bICICI\b/i],
  ['sbi', /\bSBI\b|state bank/i],
  ['axis', /\bAxis\b/i],
  ['kotak', /\bKotak\b/i],
];

const DATE_TOKEN_RES = [
  /\b(\d{4}-\d{2}-\d{2})\b/,
  /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/,
  /\b(\d{1,2}[-\s]?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-\s,]*\d{2,4})\b/i,
];

// ---------------------------------------------------------------------------- helpers

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

function firstIndex(re: RegExp, text: string): number {
  const m = re.exec(text);
  return m ? m.index : -1;
}

function findAmounts(text: string): { amount: number | null; balance: number | null } {
  let amount: number | null = null;
  let balance: number | null = null;
  for (const m of text.matchAll(AMOUNT_RE)) {
    const paise = parseRupeesToPaise(m[1] as string);
    if (paise === null || paise <= 0) continue;
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    if (BALANCE_CONTEXT.test(before)) {
      if (balance === null && !LIMIT_CONTEXT.test(before)) balance = paise;
    } else if (amount === null) amount = paise;
  }
  if (amount === null) {
    const bare = BARE_AMOUNT_RE.exec(text);
    const paise = bare ? parseRupeesToPaise(bare[1] as string) : null;
    if (paise && paise > 0) amount = paise;
  }
  return { amount, balance };
}

function findDirection(text: string): 'in' | 'out' | null {
  const o = firstIndex(OUT_RE, text);
  const i = firstIndex(IN_RE, text);
  if (o === -1 && i === -1) return null;
  if (o === -1) return 'in';
  if (i === -1) return 'out';
  return o < i ? 'out' : 'in';
}

function findLast4(text: string): string | null {
  for (const re of LAST4_RES) {
    const m = re.exec(text);
    if (m) return (m[1] as string).slice(-4);
  }
  return null;
}

function findRef(text: string): string | null {
  for (const re of REF_RES) {
    const m = re.exec(text);
    if (m && /\d/.test(m[1] as string)) return (m[1] as string).toUpperCase();
  }
  return null;
}

function findDate(text: string, fallback: IsoDate): { date: IsoDate; fromText: boolean } {
  for (const re of DATE_TOKEN_RES) {
    const m = re.exec(text);
    if (!m) continue;
    const date = parseStatementDate((m[1] as string).replace(/,/g, ' '));
    // Alerts are about the recent past: reject impossible years and future dates (typo'd tokens).
    if (date && date <= addDays(fallback, 1) && date >= addDays(fallback, -800))
      return { date, fromText: true };
  }
  return { date: fallback, fromText: false };
}

/** Captures that name an account, a reference or a sender, never a payee. */
const NOT_A_PAYEE =
  /^(?:a\/?c|ac|acct|account|your|card|x{2,}|\*|bank|beneficiary|self|vpa$|ref\b|refno|rrn|utr|txn)/i;

function cleanPayee(raw: string, vpa: string | null): string | null {
  let s = collapse(raw)
    .replace(/^(?:vpa|merchant|m\/s\.?)\s+/i, '')
    .replace(/[.,;:\-\s]+$/, '');
  if (vpa && s.toLowerCase().startsWith(vpa)) s = s.slice(vpa.length).trim();
  s = s.replace(/^\(|\)$/g, '').trim();
  if (s.length < 2 || /^[\d₹]|^(?:rs\.?|inr)(?:\b|\s*\d)/i.test(s) || NOT_A_PAYEE.test(s))
    return null;
  if (VPA_RE.test(s)) return null;
  // "HDFC Bank" is the sender, not the payee.
  if (/^(?:hdfc|icici|sbi|axis|kotak)(?: bank)?$/i.test(s)) return null;
  return s.slice(0, 60);
}

function findPayee(text: string, direction: 'in' | 'out', vpa: string | null): string | null {
  for (const re of direction === 'out' ? OUT_PAYEE_RES : IN_PAYEE_RES) {
    if (re.global) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const name = cleanPayee(m[1] as string, vpa);
        if (name) return name;
      }
    } else {
      const m = re.exec(text);
      const name = m ? cleanPayee(m[1] as string, vpa) : null;
      if (name) return name;
    }
  }
  return null;
}

function findChannel(
  text: string,
  raw: string,
  vpa: string | null,
  cardHint: CardHint,
  refNo: string | null,
): Channel {
  if (/\bATM\b|withdrawn|cash withdrawal/i.test(text)) return 'atm';
  // HDFC only says "UPI" in its trailer ("SMS BLOCK UPI to …"), so look at the whole message.
  if (vpa || /\bUPI\b/i.test(raw)) return 'upi';
  if (/\bNEFT\b/i.test(text)) return 'neft';
  if (/\bIMPS\b/i.test(text)) return 'imps';
  if (/\bRTGS\b/i.test(text)) return 'rtgs';
  if (/\b(?:NACH|ACH|e-?mandate|autopay|standing instruction)\b/i.test(text)) return 'nach';
  if (cardHint) return 'card';
  // A bare 12-digit reference is a UPI RRN (IMPS/NEFT alerts name their rail).
  if (refNo && /^\d{12}$/.test(refNo)) return 'upi';
  return 'other';
}

function buildNarration(a: {
  channel: Channel;
  direction: 'in' | 'out';
  refNo: string | null;
  payee: string | null;
  vpa: string | null;
  info: string | null;
}): string {
  if (a.info) return a.info;
  const drcr = a.direction === 'out' ? 'DR' : 'CR';
  const parts = (xs: (string | null)[]) => xs.filter(Boolean).join('/');
  switch (a.channel) {
    case 'upi':
      return parts(['UPI', drcr, a.refNo, a.payee, a.vpa]);
    case 'atm':
      return collapse(`ATM WDL ${a.payee ?? ''}`);
    case 'card':
      return `POS ${a.payee ?? (a.direction === 'out' ? 'CARD PURCHASE' : 'CARD REFUND')}`;
    case 'neft':
    case 'imps':
    case 'rtgs':
      return `${a.channel.toUpperCase()} ${drcr}-${a.payee ?? ''}`.replace(/-$/, '');
    case 'nach':
      return `NACH ${drcr} ${a.payee ?? ''}`.trim();
    default:
      return a.payee ?? (a.direction === 'out' ? 'DEBIT ALERT' : 'CREDIT ALERT');
  }
}

// ---------------------------------------------------------------------------- public API

/** Parse one message. Returns a skipped entry when it isn't a completed transaction. */
export function parseAlert(
  message: string,
  index: number,
  opts: ParseAlertOptions,
): ParsedAlert | SkippedAlert {
  const raw = collapse(message).slice(0, 500);
  for (const [reason, re] of REJECTS) if (re.test(raw)) return { index, raw, reason };

  const cut = firstIndex(TAIL, raw);
  const text = cut > 0 ? raw.slice(0, cut) : raw;

  const { amount, balance } = findAmounts(text);
  if (amount === null) return { index, raw, reason: 'no_amount' };
  const direction = findDirection(text);
  if (!direction) return { index, raw, reason: 'no_direction' };

  const cardHint: CardHint = /debit card/i.test(text)
    ? 'debit'
    : /\bcard\b/i.test(text)
      ? 'credit'
      : null;
  const vpaMatch = VPA_RE.exec(text);
  const vpa = vpaMatch ? vpaMatch[0].toLowerCase() : null;
  const refNo = findRef(text);
  const channel = findChannel(text, raw, vpa, cardHint, refNo);
  const info = INFO_RES.map((re) => re.exec(text)?.[1] ?? null).find(Boolean) ?? null;
  const payee = channel === 'atm' ? null : findPayee(text, direction, vpa);
  const { date, fromText } = findDate(text, opts.fallbackDate);

  return {
    index,
    raw,
    amountPaise: amount,
    direction,
    txnDate: date,
    dateFromText: fromText,
    last4: findLast4(text),
    // The bank name is often only in the signature ("-SBI", "Axis Bank") after the trailer.
    bank: BANK_RES.find(([, re]) => re.test(raw))?.[0] ?? null,
    cardHint,
    channel,
    vpa,
    payee,
    refNo,
    balancePaise: balance,
    narration: buildNarration({ channel, direction, refNo, payee, vpa, info }).slice(0, 500),
  };
}

export const isParsedAlert = (a: ParsedAlert | SkippedAlert): a is ParsedAlert =>
  'amountPaise' in a;

/** Quick test used to decide whether lines of a block are separate messages. */
const HAS_AMOUNT_RE = /(?:rs\.?|inr|₹)\s*[0-9]/i;
const looksLikeAlert = (line: string) =>
  (HAS_AMOUNT_RE.test(line) || BARE_AMOUNT_RE.test(line)) &&
  (OUT_RE.test(line) || IN_RE.test(line));

/**
 * Split pasted text into messages: blank lines separate messages; inside a block, lines that each
 * look like an alert are separate messages too (SMS apps often copy one message per line).
 * Continuation lines attach to the message above.
 */
export function splitAlerts(text: string): string[] {
  const out: string[] = [];
  for (const block of text.slice(0, MAX_ALERT_TEXT).split(/\r?\n\s*\r?\n/)) {
    const lines = block
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    const starts = lines.map(looksLikeAlert);
    if (starts.filter(Boolean).length < 2) {
      out.push(lines.join(' '));
      continue;
    }
    let current: string[] = [];
    let currentHasAlert = false;
    lines.forEach((line, i) => {
      if (starts[i] && currentHasAlert) {
        out.push(current.join(' '));
        current = [];
        currentHasAlert = false;
      }
      current.push(line);
      currentHasAlert ||= !!starts[i];
    });
    if (current.length) out.push(current.join(' '));
  }
  return out.slice(0, MAX_ALERTS);
}

export interface ParseAlertsResult {
  alerts: ParsedAlert[];
  skipped: SkippedAlert[];
}

export function parseAlerts(text: string, opts: ParseAlertOptions): ParseAlertsResult {
  const alerts: ParsedAlert[] = [];
  const skipped: SkippedAlert[] = [];
  splitAlerts(text).forEach((m, i) => {
    const r = parseAlert(m, i, opts);
    if (isParsedAlert(r)) alerts.push(r);
    else skipped.push(r);
  });
  return { alerts, skipped };
}
