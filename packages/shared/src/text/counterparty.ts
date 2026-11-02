/**
 * Counterparty keying for names (manual entries and normalized payees).
 * Narration parsing (VPA, channel, payee extraction) lives in categorize/normalize.ts.
 */

const NOISE_WORDS = new Set([
  'pvt',
  'private',
  'ltd',
  'limited',
  'llp',
  'inc',
  'co',
  'the',
  'india',
  'payment',
  'payments',
  'ind',
  'upi',
  'com',
  'corp',
  'corporation',
  'company',
  'services',
  'technologies',
  'solutions',
  'systems',
]);

/** Collapse whitespace and trim; keeps the user's casing for display. */
export function cleanDisplayName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/**
 * Canonical key: lower-case, punctuation/digits removed, noise words dropped.
 * "Swiggy Pvt. Ltd." -> "swiggy"; "Ramesh  Kirana Store" -> "ramesh kirana store".
 * A UPI VPA (contains '@') is used verbatim (lower-cased) because it is already unique.
 */
export function counterpartyKey(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (/^[a-z0-9._-]+@[a-z0-9.-]+$/.test(trimmed)) return trimmed;
  const words = trimmed
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NOISE_WORDS.has(w));
  return words.join(' ') || trimmed.replace(/\s+/g, ' ');
}
