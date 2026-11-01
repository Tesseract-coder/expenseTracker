/**
 * Cell-level parsing for bank statements: dates and amounts arrive in many shapes
 * ("01/10/26", "1 Oct 2026", "01-OCT-2026 10:15", Excel serials, "1,23,456.78 Cr", "(500.00)").
 */
import { isIsoDate } from '../dates';

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function expandYear(y: number): number {
  if (y >= 100) return y;
  return y >= 70 ? 1900 + y : 2000 + y;
}

function iso(y: number, m: number, d: number): string | null {
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(s) ? s : null;
}

/** Excel serial day number (1900 date system) → ISO date. */
function fromExcelSerial(n: number): string | null {
  if (n < 20000 || n > 80000) return null; // ~1954..2119; rejects small numbers that are not dates
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Parse a statement date cell to 'YYYY-MM-DD'. Numeric dates follow `order` (Indian banks: dmy).
 * Time suffixes are ignored. Returns null when the cell is not a date.
 */
export function parseStatementDate(raw: string, order: DateOrder = 'dmy'): string | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return null;

  // ISO (possibly with time): 2026-10-01, 2026-10-01T00:00:00
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  // Excel serial (only when the whole cell is a number)
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromExcelSerial(Number(s));

  // Month name: 01-Oct-2026, 1 Oct 26, 01 OCT 2026 10:15, Oct 01, 2026
  m = /^(\d{1,2})[\s\-/.]?([A-Za-z]{3,9})[\s\-/.,]*(\d{2,4})(?:\s.*)?$/.exec(s);
  if (m) {
    const month =
      MONTHS[(m[2] ?? '').slice(0, 4).toLowerCase()] ??
      MONTHS[(m[2] ?? '').slice(0, 3).toLowerCase()];
    return month ? iso(expandYear(Number(m[3])), month, Number(m[1])) : null;
  }
  m = /^([A-Za-z]{3,9})[\s\-/.]+(\d{1,2}),?[\s\-/.]+(\d{2,4})(?:\s.*)?$/.exec(s);
  if (m) {
    const month = MONTHS[(m[1] ?? '').slice(0, 3).toLowerCase()];
    return month ? iso(expandYear(Number(m[3])), month, Number(m[2])) : null;
  }

  // Numeric: 01/10/2026, 1-10-26, 01.10.2026 (+ optional time)
  m = /^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})(?:\s.*)?$/.exec(s);
  if (m) {
    const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if ((m[1] ?? '').length === 4) return iso(a, b, c); // y/m/d regardless of order
    if (order === 'mdy') return iso(expandYear(c), a, b);
    if (order === 'ymd') return iso(expandYear(a), b, c);
    return iso(expandYear(c), b, a);
  }
  return null;
}

/** Pick the date order under which every sample parses (prefers day-first, the Indian convention). */
export function detectDateOrder(samples: string[]): DateOrder {
  const nonEmpty = samples.map((s) => s.trim()).filter(Boolean);
  for (const order of ['dmy', 'mdy', 'ymd'] as const) {
    if (nonEmpty.length > 0 && nonEmpty.every((s) => parseStatementDate(s, order) !== null))
      return order;
  }
  return 'dmy';
}

export interface ParsedAmount {
  paise: number; // always >= 0
  /** Sign information found in the cell itself: '-' / '()' → negative; Dr/Cr suffix → explicit. */
  sign: 'negative' | 'dr' | 'cr' | null;
}

const AMOUNT = /^\(?-?\+?[\d,]*\.?\d*\)?$/;

/** Parse an amount cell. Returns null for empty, "-", or non-numeric cells. Zero is returned as paise 0. */
export function parseStatementAmount(raw: string): ParsedAmount | null {
  let s = raw.trim().replace(/\u00a0/g, ' ');
  if (!s || s === '-' || s === '--') return null;
  let sign: ParsedAmount['sign'] = null;

  const suffix = /\s*(?<![a-z])(cr|dr)\.?$/i.exec(s);
  if (suffix) {
    sign = (suffix[1] ?? '').toLowerCase() === 'cr' ? 'cr' : 'dr';
    s = s.slice(0, suffix.index);
  }
  const prefix = /^(cr|dr)\.?\s*/i.exec(s);
  if (prefix && !sign) {
    sign = (prefix[1] ?? '').toLowerCase() === 'cr' ? 'cr' : 'dr';
    s = s.slice(prefix[0].length);
  }
  s = s.replace(/₹|inr|rs\.?/gi, '').replace(/\s+/g, '');
  if (!s || !AMOUNT.test(s)) return null;

  const negative = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  const digits = s.replace(/[(),+-]/g, '');
  if (!/^\d*\.?\d+$/.test(digits) && !/^\d+\.?$/.test(digits)) return null;
  const value = Math.round(Number(digits) * 100);
  if (!Number.isSafeInteger(value)) return null;
  return { paise: value, sign: sign ?? (negative ? 'negative' : null) };
}

const DEBIT_WORDS = new Set(['dr', 'd', 'debit', 'withdrawal', 'db', 'dr.']);
const CREDIT_WORDS = new Set(['cr', 'c', 'credit', 'deposit', 'cr.']);

/** Interpret a Dr/Cr "type" column value. */
export function parseTypeCell(raw: string): 'out' | 'in' | null {
  const v = raw.trim().toLowerCase();
  if (DEBIT_WORDS.has(v)) return 'out';
  if (CREDIT_WORDS.has(v)) return 'in';
  return null;
}
