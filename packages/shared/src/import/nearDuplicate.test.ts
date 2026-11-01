import { describe, expect, it } from 'vitest';
import { type DupCandidate, findNearDuplicate, jaccard } from './nearDuplicate';

const c = (id: string, o: Partial<DupCandidate> = {}): DupCandidate => ({
  id,
  txnDate: '2026-10-02',
  amountPaise: 45050,
  direction: 'out',
  narration: 'UPI/swiggy.instamart@ybl/Payment/SWIGGY LIMITED',
  refNo: null,
  ...o,
});

describe('jaccard', () => {
  it('ignores channel noise and numbers', () => {
    expect(jaccard('UPI/DR/4275/SWIGGY LIMITED', 'NEFT 999 SWIGGY LIMITED')).toBe(1);
    expect(jaccard('', 'x')).toBe(0);
  });
});

describe('findNearDuplicate', () => {
  it.each([
    [
      'same reference',
      c('x', { refNo: 'R1', narration: 'totally different' }),
      { refNo: 'R1' },
      'same_ref',
    ],
    [
      'similar narration, 1 day apart',
      c('x', { txnDate: '2026-10-03', narration: 'SWIGGY LIMITED INSTAMART' }),
      {},
      'similar_narration',
    ],
    ['manual entry without narration', c('x', { narration: null }), {}, 'no_narration'],
  ])('matches on %s', (_n, existing, rowPatch, reason) => {
    expect(findNearDuplicate(c('new', rowPatch), [existing])).toMatchObject({ id: 'x', reason });
  });

  it.each([
    ['different amount', c('x', { amountPaise: 45051 })],
    ['different direction', c('x', { direction: 'in' })],
    ['more than 2 days apart', c('x', { txnDate: '2026-10-05' })],
    ['dissimilar narration', c('x', { narration: 'ZOMATO MEDIA PVT' })],
  ])('ignores %s', (_n, existing) => {
    expect(findNearDuplicate(c('new'), [existing])).toBeNull();
  });

  it('picks the strongest match', () => {
    const r = findNearDuplicate(c('new', { refNo: 'R' }), [
      c('weak', { narration: null }),
      c('strong', { refNo: 'R' }),
    ]);
    expect(r?.id).toBe('strong');
  });
});
