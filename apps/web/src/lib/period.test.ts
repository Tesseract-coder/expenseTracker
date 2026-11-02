import { describe, expect, it } from 'vitest';
import { bucketLabel, compactINR } from './format';
import { periodLabel, resolvePeriod } from './period';
import { binner } from '@/components/charts/Heatmap';

const sp = (q: string) => new URLSearchParams(q);
const TODAY = '2026-11-02';

describe('resolvePeriod', () => {
  it('defaults to the current month with the previous month as comparison', () => {
    const p = resolvePeriod(sp(''), 'calendar', TODAY);
    expect(p.kind).toBe('month');
    expect(p.range).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(p.compare).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(p.label).toBe('November 2026');
    expect(p.params).toMatchObject({
      from: '2026-11-01',
      compareTo: '2026-10-31',
      accountIds: undefined,
    });
  });

  it('handles Monday weeks, financial years and accounts', () => {
    const w = resolvePeriod(sp('period=week&date=2026-11-01'), 'calendar', TODAY);
    expect(w.range).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    const fy = resolvePeriod(sp('period=year&date=2026-02-10&acc=a,b'), 'fy', TODAY);
    expect(fy.range).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(fy.label).toBe('FY 2025-26');
    expect(fy.compare.from).toBe('2024-04-01');
    expect(fy.accountIds).toEqual(['a', 'b']);
  });

  it('compares a custom range with the same-length span before it', () => {
    const p = resolvePeriod(sp('period=custom&from=2026-10-11&to=2026-10-20'), 'calendar', TODAY);
    expect(p.compare).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(p.label).toBe('11 Oct – 20 Oct 2026');
  });

  it('falls back safely on bad params', () => {
    const p = resolvePeriod(sp('period=decade&date=nope'), 'calendar', TODAY);
    expect(p.kind).toBe('month');
    const c = resolvePeriod(sp('period=custom&from=2026-10-20&to=2026-10-01'), 'calendar', TODAY);
    expect(c.range).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(c.label).toBe('November 2026');
  });

  it('labels calendar years', () =>
    expect(periodLabel('year', { from: '2026-01-01', to: '2026-12-31' }, 'calendar')).toBe('2026'));
});

describe('format helpers', () => {
  it.each([
    [95_000, '₹950'],
    [1_250_000, '₹13K'],
    [1_20_00_000, '₹1.2L'],
    [3_40_00_00_000, '₹3.4Cr'],
    [-5_00_000, '−₹5K'],
  ])('compactINR(%i) = %s', (p, e) => expect(compactINR(p)).toBe(e));

  it('labels buckets', () => {
    expect(bucketLabel('2026-10')).toBe('Oct');
    expect(bucketLabel('2026-10', true)).toBe('Oct 26');
    expect(bucketLabel('2026-10-05')).toBe('5 Oct');
    expect(bucketLabel('FY 2026-27')).toBe('FY 2026-27');
  });
});

describe('heatmap binner', () => {
  it('ranks positive values into 6 steps and marks zero/negative as empty', () => {
    const bin = binner([10, 20, 30, 40, 50, 60, 0, -5]);
    expect(bin(0)).toBe(-1);
    expect(bin(-5)).toBe(-1);
    expect(bin(10)).toBe(0);
    expect(bin(60)).toBe(5);
    expect(binner([])(5)).toBe(-1);
  });
});
