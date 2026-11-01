/**
 * Built-in statement profiles for common Indian banks, expressed as header aliases.
 * Detection finds the header row and resolves aliases to column indices, producing a
 * ColumnMapping for the shared parseGrid engine. Bump a profile's `id` version when its
 * behaviour changes so past imports stay attributable.
 *
 * Layouts are modelled on the public net-banking download formats; banks change these over
 * time, so anything unrecognised falls back to the generic profile + mapping wizard.
 */
import type { AccountType, Bank } from '../schemas/enums';
import { type ColumnMapping, type Grid } from './mapping';
import { detectDateOrder } from './values';

export interface BankProfile {
  id: string;
  bank: Bank | null;
  accountType: Extract<AccountType, 'savings' | 'credit_card'> | null;
  label: string;
  columns: {
    date: string[];
    valueDate?: string[];
    /** Each inner list is one narration column (some formats split description across columns). */
    narration: string[][];
    ref?: string[];
    balance?: string[];
  } & (
    | { amountKind: 'debit_credit'; debit: string[]; credit: string[] }
    | {
        amountKind: 'amount_with_type';
        amount: string[];
        type?: string[];
        defaultDirection: 'in' | 'out';
      }
  );
}

/** Lower-case alphanumerics only: "Withdrawal Amt." → "withdrawalamt". */
export const normalizeHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const BANK_PROFILES: readonly BankProfile[] = [
  {
    id: 'hdfc_savings_v1',
    bank: 'hdfc',
    accountType: 'savings',
    label: 'HDFC Bank — Savings/Current',
    columns: {
      date: ['date'],
      valueDate: ['valuedt', 'valuedate'],
      narration: [['narration']],
      ref: ['chqrefno', 'chqrefnumber', 'refno'],
      amountKind: 'debit_credit',
      debit: ['withdrawalamt', 'withdrawalamount'],
      credit: ['depositamt', 'depositamount'],
      balance: ['closingbalance'],
    },
  },
  {
    id: 'hdfc_cc_v1',
    bank: 'hdfc',
    accountType: 'credit_card',
    label: 'HDFC Bank — Credit Card',
    columns: {
      date: ['date', 'transactiondate'],
      narration: [['description', 'transactiondescription']],
      amountKind: 'amount_with_type',
      amount: ['amt', 'amount', 'amountinrs'],
      type: ['debitcredit', 'drcr'],
      defaultDirection: 'out',
    },
  },
  {
    id: 'icici_savings_v1',
    bank: 'icici',
    accountType: 'savings',
    label: 'ICICI Bank — Savings/Current',
    columns: {
      date: ['transactiondate'],
      valueDate: ['valuedate'],
      narration: [['transactionremarks', 'remarks']],
      ref: ['chequenumber', 'chequeno'],
      amountKind: 'debit_credit',
      debit: ['withdrawalamountinr', 'withdrawalamount'],
      credit: ['depositamountinr', 'depositamount'],
      balance: ['balanceinr', 'balance'],
    },
  },
  {
    id: 'icici_cc_v1',
    bank: 'icici',
    accountType: 'credit_card',
    label: 'ICICI Bank — Credit Card',
    columns: {
      date: ['date', 'transactiondate'],
      narration: [['transactiondetails', 'details']],
      ref: ['srno', 'referencenumber'],
      amountKind: 'amount_with_type',
      amount: ['amountinrs', 'amountrs', 'amount'],
      type: ['billingamountsign'],
      defaultDirection: 'out',
    },
  },
  {
    id: 'sbi_savings_v1',
    bank: 'sbi',
    accountType: 'savings',
    label: 'SBI — Savings/Current',
    columns: {
      date: ['txndate', 'transactiondate'],
      valueDate: ['valuedate'],
      narration: [['description']],
      ref: ['refnochequeno', 'refno'],
      amountKind: 'debit_credit',
      debit: ['debit'],
      credit: ['credit'],
      balance: ['balance'],
    },
  },
  {
    id: 'sbi_cc_v1',
    bank: 'sbi',
    accountType: 'credit_card',
    label: 'SBI Card — Credit Card',
    columns: {
      date: ['transactiondate', 'date'],
      narration: [['transactiondetails', 'description']],
      amountKind: 'amount_with_type',
      amount: ['amount', 'amountinr'],
      type: ['type', 'transactiontype'],
      defaultDirection: 'out',
    },
  },
  {
    id: 'axis_savings_v1',
    bank: 'axis',
    accountType: 'savings',
    label: 'Axis Bank — Savings/Current',
    columns: {
      date: ['trandate', 'transactiondate'],
      narration: [['particulars']],
      ref: ['chqno', 'chequeno'],
      amountKind: 'debit_credit',
      debit: ['dr', 'debit'],
      credit: ['cr', 'credit'],
      balance: ['bal', 'balance'],
    },
  },
  {
    id: 'axis_cc_v1',
    bank: 'axis',
    accountType: 'credit_card',
    label: 'Axis Bank — Credit Card',
    columns: {
      date: ['date', 'transactiondate'],
      narration: [['transactiondetails']],
      amountKind: 'amount_with_type',
      amount: ['amountinr', 'amount'],
      type: ['debitcredit'],
      defaultDirection: 'out',
    },
  },
  {
    id: 'kotak_savings_v1',
    bank: 'kotak',
    accountType: 'savings',
    label: 'Kotak Mahindra Bank — Savings/Current',
    columns: {
      date: ['transactiondate', 'date'],
      valueDate: ['valuedate'],
      narration: [['description', 'narration']],
      ref: ['chqrefno', 'chequerefno'],
      amountKind: 'amount_with_type',
      amount: ['amount'],
      type: ['drcr'],
      defaultDirection: 'out',
      balance: ['balance'],
    },
  },
  {
    id: 'kotak_cc_v1',
    bank: 'kotak',
    accountType: 'credit_card',
    label: 'Kotak Mahindra Bank — Credit Card',
    columns: {
      date: ['date', 'transactiondate'],
      narration: [['transactiondetails']],
      amountKind: 'amount_with_type',
      amount: ['amountrs', 'amount'],
      type: ['drcr', 'debitcredit'],
      defaultDirection: 'out',
    },
  },
];

/** Broad aliases used when no bank profile matches; result is a suggestion for the wizard. */
export const GENERIC_PROFILE: BankProfile = {
  id: 'generic_v1',
  bank: null,
  accountType: null,
  label: 'Generic',
  columns: {
    date: ['date', 'txndate', 'trandate', 'transactiondate', 'postingdate', 'valuedate'],
    narration: [
      [
        'narration',
        'description',
        'particulars',
        'details',
        'transactiondetails',
        'remarks',
        'transactionremarks',
      ],
    ],
    ref: ['refno', 'chqrefno', 'chqno', 'chequeno', 'referenceno', 'utr'],
    amountKind: 'debit_credit',
    debit: [
      'withdrawal',
      'withdrawalamt',
      'withdrawalamount',
      'withdrawalamountinr',
      'debit',
      'dr',
      'debitamount',
    ],
    credit: [
      'deposit',
      'depositamt',
      'depositamount',
      'depositamountinr',
      'credit',
      'cr',
      'creditamount',
    ],
    balance: ['balance', 'closingbalance', 'bal', 'balanceinr'],
  },
};

function findCol(header: string[], aliases: string[] | undefined, after = -1): number | null {
  if (!aliases) return null;
  for (let i = after + 1; i < header.length; i++) {
    if (aliases.includes(header[i] ?? '')) return i;
  }
  return null;
}

export interface ProfileMatch {
  profile: BankProfile;
  mapping: ColumnMapping;
  /** Fraction of the profile's declared columns found (0–1). */
  score: number;
  /** Absolute number of columns matched; breaks ties in favour of more specific profiles. */
  matched: number;
}

/** Try to resolve one profile against the header row at `headerRow`. */
export function matchProfileAt(
  grid: Grid,
  headerRow: number,
  profile: BankProfile,
): ProfileMatch | null {
  const header = (grid[headerRow] ?? []).map((c) => normalizeHeader(String(c ?? '')));
  const c = profile.columns;
  const dateCol = findCol(header, c.date);
  const narrationCols = c.narration.map((aliases) => findCol(header, aliases));
  if (dateCol === null || narrationCols.some((n) => n === null)) return null;

  let amount: ColumnMapping['amount'];
  let declared = 2 + (c.ref ? 1 : 0) + (c.balance ? 1 : 0) + (c.valueDate ? 1 : 0);
  if (c.amountKind === 'debit_credit') {
    const debitCol = findCol(header, c.debit);
    const creditCol = findCol(header, c.credit);
    if (debitCol === null || creditCol === null) return null;
    amount = { kind: 'debit_credit', debitCol, creditCol };
    declared += 2;
  } else {
    const amountCol = findCol(header, c.amount);
    if (amountCol === null) return null;
    // The type column is the first match *after* the amount (Kotak repeats "Dr / Cr" for balance).
    const typeCol = findCol(header, c.type, amountCol);
    amount = { kind: 'amount_with_type', amountCol, typeCol, defaultDirection: c.defaultDirection };
    declared += 1 + (c.type ? 1 : 0);
  }

  const refCol = findCol(header, c.ref);
  const balanceCol = findCol(header, c.balance);
  const valueDateCol = findCol(header, c.valueDate);
  const found =
    2 +
    (refCol !== null ? 1 : 0) +
    (balanceCol !== null ? 1 : 0) +
    (valueDateCol !== null ? 1 : 0) +
    (amount.kind === 'debit_credit' ? 2 : 1 + (amount.typeCol !== null ? 1 : 0));

  const dateSamples = grid
    .slice(headerRow + 1, headerRow + 40)
    .map((r) => String(r?.[dateCol] ?? ''))
    .filter((s) => /\d/.test(s));

  return {
    profile,
    score: found / declared,
    matched: found,
    mapping: {
      headerRow,
      dateCol,
      valueDateCol,
      narrationCols: narrationCols as number[],
      refCol,
      balanceCol,
      amount,
      dateOrder: detectDateOrder(dateSamples),
    },
  };
}

const HEADER_SCAN_ROWS = 60;

/**
 * Detect the best built-in profile. Prefers (1) complete column matches, (2) a profile matching
 * the account's bank/type hint, (3) more matched columns. Returns null when nothing matches;
 * callers can then try `guessGenericMapping` and the wizard.
 */
export function detectProfile(
  grid: Grid,
  hint: { bank?: Bank | null; accountType?: AccountType } = {},
): ProfileMatch | null {
  let best: { m: ProfileMatch; rank: number } | null = null;
  const limit = Math.min(grid.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < limit; r++) {
    for (const profile of BANK_PROFILES) {
      const m = matchProfileAt(grid, r, profile);
      if (!m) continue;
      const hintBonus =
        (hint.bank && profile.bank === hint.bank ? 0.5 : 0) +
        (hint.accountType &&
        profile.accountType === (hint.accountType === 'credit_card' ? 'credit_card' : 'savings')
          ? 0.25
          : 0);
      const rank = m.score + hintBonus + m.matched / 100;
      if (!best || rank > best.rank) best = { m, rank };
    }
  }
  return best?.m ?? null;
}

/** Best-effort mapping from generic aliases, to pre-fill the wizard. */
export function guessGenericMapping(grid: Grid): ProfileMatch | null {
  const limit = Math.min(grid.length, HEADER_SCAN_ROWS);
  let best: ProfileMatch | null = null;
  for (let r = 0; r < limit; r++) {
    const m = matchProfileAt(grid, r, GENERIC_PROFILE);
    if (m && (!best || m.score > best.score)) best = m;
  }
  return best;
}

export function getProfile(id: string): BankProfile | undefined {
  return [...BANK_PROFILES, GENERIC_PROFILE].find((p) => p.id === id);
}
