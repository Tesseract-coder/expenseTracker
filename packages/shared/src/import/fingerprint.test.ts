import { describe, expect, it } from 'vitest';
import {
  assignOccurrences,
  fingerprint,
  fingerprintAll,
  normalizeForFingerprint,
} from './fingerprint';

const row = (o: Partial<Parameters<typeof fingerprint>[1]> = {}) => ({
  txnDate: '2026-10-02',
  amountPaise: 2000,
  direction: 'out' as const,
  narration: 'UPI-CHAI POINT',
  refNo: null,
  ...o,
});

describe('fingerprints', () => {
  it('normalizes only case and whitespace', () => {
    expect(normalizeForFingerprint('  upi-chai   point ')).toBe('UPI-CHAI POINT');
    expect(normalizeForFingerprint(null)).toBe('');
  });

  it('numbers identical rows by occurrence and keeps distinct rows at 0', () => {
    expect(
      assignOccurrences('a1', [
        row(),
        row({ amountPaise: 3000 }),
        row(),
        row({ narration: 'upi-chai  point' }),
      ]),
    ).toEqual([0, 0, 1, 2]);
  });

  it('is deterministic, distinguishes repeats, accounts and fields', async () => {
    const [a, b] = fingerprintAll('a1', [row(), row()]);
    expect(a).toMatch(/^f1[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    // Re-importing an overlapping statement reproduces the same fingerprints.
    expect(fingerprintAll('a1', [row(), row(), row({ txnDate: '2026-10-03' })])).toEqual(
      expect.arrayContaining([a, b]),
    );
    expect(fingerprint('a2', row(), 0)).not.toBe(a);
    expect(fingerprint('a1', row({ refNo: 'X' }), 0)).not.toBe(a);
    expect(fingerprint('a1', row({ direction: 'in' }), 0)).not.toBe(a);
  });
});
