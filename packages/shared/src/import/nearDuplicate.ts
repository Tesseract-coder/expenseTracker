import { normalizeForFingerprint } from './fingerprint';

export interface DupCandidate {
  id: string;
  txnDate: string;
  amountPaise: number;
  direction: 'in' | 'out';
  narration: string | null;
  refNo: string | null;
}

const NOISE = new Set([
  'UPI',
  'NEFT',
  'IMPS',
  'RTGS',
  'POS',
  'DR',
  'CR',
  'TO',
  'BY',
  'FROM',
  'TRANSFER',
  'PAYMENT',
  'TXN',
]);

function tokens(narration: string | null): Set<string> {
  return new Set(
    normalizeForFingerprint(narration)
      .split(/[^A-Z0-9@.]+/)
      .filter((t) => t.length >= 3 && !NOISE.has(t) && !/^\d+$/.test(t)),
  );
}

function jaccardSets(ta: Set<string>, tb: Set<string>): number {
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function jaccard(a: string | null, b: string | null): number {
  return jaccardSets(tokens(a), tokens(b));
}

export interface NearDupMatch {
  id: string;
  score: number;
  reason: 'same_ref' | 'similar_narration' | 'no_narration';
}

interface Prepared {
  c: DupCandidate;
  day: number;
  hasNarration: boolean;
  /** Tokenized lazily: most comparisons are settled by date window or reference number. */
  tokens: Set<string> | null;
}

/** Day number from an already-validated ISO date (plain arithmetic; no Date round-trips). */
const dayNumber = (iso: string) =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) /
  86_400_000;

const tokensOf = (p: Prepared) => (p.tokens ??= tokens(p.c.narration));

function prepare(c: DupCandidate): Prepared {
  return { c, day: dayNumber(c.txnDate), hasNarration: !!c.narration?.trim(), tokens: null };
}

/**
 * Near-duplicate: same amount and direction within ±2 days, and either the same reference number,
 * similar narration (token Jaccard ≥ 0.5), or one side has no narration at all (e.g. a manual
 * entry or SMS-sourced row). Exact fingerprint duplicates are handled separately.
 */
export function findNearDuplicate(
  row: DupCandidate,
  existing: DupCandidate[],
): NearDupMatch | null {
  return createNearDuplicateMatcher(existing)(row);
}

/**
 * Builds the matcher once for many rows: existing transactions are pre-tokenized and bucketed by
 * amount + direction, so each lookup only compares the few same-amount candidates (linear overall).
 */
export function createNearDuplicateMatcher(
  existing: DupCandidate[],
): (row: DupCandidate) => NearDupMatch | null {
  const buckets = new Map<string, Prepared[]>();
  for (const e of existing) {
    const k = `${e.direction}:${e.amountPaise}`;
    const list = buckets.get(k);
    if (list) list.push(prepare(e));
    else buckets.set(k, [prepare(e)]);
  }
  return (row) => {
    const candidates = buckets.get(`${row.direction}:${row.amountPaise}`);
    return candidates ? bestMatch(prepare(row), candidates) : null;
  };
}

function bestMatch(row: Prepared, candidates: Prepared[]): NearDupMatch | null {
  let best: NearDupMatch | null = null;
  for (const e of candidates) {
    const days = Math.abs(e.day - row.day);
    if (days > 2) continue;
    let match: NearDupMatch | null = null;
    if (row.c.refNo && e.c.refNo && row.c.refNo === e.c.refNo)
      match = { id: e.c.id, score: 1, reason: 'same_ref' };
    else if (!e.hasNarration || !row.hasNarration) {
      match = { id: e.c.id, score: 0.6 - days * 0.1, reason: 'no_narration' };
    } else {
      const j = jaccardSets(tokensOf(row), tokensOf(e));
      if (j >= 0.5) match = { id: e.c.id, score: j - days * 0.05, reason: 'similar_narration' };
    }
    if (match && (!best || match.score > best.score)) best = match;
  }
  return best;
}
