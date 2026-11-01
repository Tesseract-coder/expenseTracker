/**
 * Money is always integer paise. These helpers are the only place rupee <-> paise
 * conversion happens, and they never go through floating point arithmetic.
 */

export type Paise = number;

const RUPEE_INPUT = /^\s*(-)?\s*(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*)?(?:\.([0-9]{0,2}))?\s*$/i;

/** Parse user/statement input like "1,23,456.78", "₹ 99", "Rs. 12.5" into paise. Returns null if invalid. */
export function parseRupeesToPaise(input: string): Paise | null {
  const m = RUPEE_INPUT.exec(input);
  if (!m) return null;
  const [, neg, intPart, fracPart] = m;
  if (intPart === undefined && (fracPart === undefined || fracPart === '')) return null;
  const digits = (intPart ?? '0').replaceAll(',', '');
  const frac = (fracPart ?? '').padEnd(2, '0');
  const value = Number(digits) * 100 + Number(frac);
  if (!Number.isSafeInteger(value)) return null;
  return neg ? -value : value;
}

/** Group digits Indian style: 1234567 -> "12,34,567". Expects a non-negative integer string. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

export interface FormatInrOptions {
  /** Omit the paise part when it is zero. Default false. */
  compactZeroPaise?: boolean;
  /** Prefix with ₹. Default true. */
  symbol?: boolean;
}

/**
 * Format paise as INR with Indian grouping: 12345678 -> "₹1,23,456.78".
 * Implemented with integer math (not Intl) so output is identical in every runtime.
 */
export function formatINR(paise: Paise, opts: FormatInrOptions = {}): string {
  if (!Number.isSafeInteger(paise))
    throw new RangeError(`paise must be a safe integer, got ${paise}`);
  const { compactZeroPaise = false, symbol = true } = opts;
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const body =
    groupIndian(String(rupees)) +
    (compactZeroPaise && p === 0 ? '' : `.${String(p).padStart(2, '0')}`);
  return `${negative ? '-' : ''}${symbol ? '₹' : ''}${body}`;
}

/** Short form for charts/cards: ₹950, ₹12.3K, ₹4.5L, ₹1.2Cr. */
export function formatINRCompact(paise: Paise): string {
  const negative = paise < 0;
  const rupees = Math.abs(paise) / 100;
  const sign = negative ? '-' : '';
  const fmt = (n: number, unit: string) => `${sign}₹${Number(n.toFixed(1))}${unit}`;
  if (rupees >= 1_00_00_000) return fmt(rupees / 1_00_00_000, 'Cr');
  if (rupees >= 1_00_000) return fmt(rupees / 1_00_000, 'L');
  if (rupees >= 1_000) return fmt(rupees / 1_000, 'K');
  return `${sign}₹${Math.round(rupees)}`;
}

export type Direction = 'in' | 'out';

/** Signed contribution of a movement to an account balance. */
export function signedPaise(amountPaise: Paise, direction: Direction): Paise {
  return direction === 'in' ? amountPaise : -amountPaise;
}
