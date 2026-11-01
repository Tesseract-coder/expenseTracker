import { murmur128Hex } from '../crypto/murmur';

export interface FingerprintFields {
  txnDate: string;
  amountPaise: number;
  direction: 'in' | 'out';
  narration: string | null;
  refNo: string | null;
}

/**
 * Narration normalization for fingerprints only: upper-case and collapse whitespace.
 * Deliberately NOT the counterparty normalizer, so improving categorization never changes
 * fingerprints of already-imported rows.
 */
export function normalizeForFingerprint(narration: string | null): string {
  return (narration ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function tupleKey(accountId: string, r: FingerprintFields): string {
  return [
    accountId,
    r.txnDate,
    r.amountPaise,
    r.direction,
    normalizeForFingerprint(r.narration),
    r.refNo ?? '',
  ].join('|');
}

/**
 * Occurrence index per identical tuple within one batch, in source order: two genuine ₹20 payments
 * to the same VPA on the same day get 0 and 1. Re-importing an overlapping statement reproduces the
 * same numbers, so exact duplicates still collide on the unique fingerprint.
 */
export function assignOccurrences(accountId: string, rows: FingerprintFields[]): number[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = tupleKey(accountId, r);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n;
  });
}

/** 128-bit fingerprint, 'f1' + 32 hex chars. The prefix versions the algorithm and input format. */
export function fingerprint(accountId: string, row: FingerprintFields, occurrence: number): string {
  return `f1${murmur128Hex(`${tupleKey(accountId, row)}|${occurrence}`)}`;
}

export function fingerprintAll(accountId: string, rows: FingerprintFields[]): string[] {
  const occ = assignOccurrences(accountId, rows);
  return rows.map((r, i) => fingerprint(accountId, r, occ[i] ?? 0));
}
