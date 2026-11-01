import { describe, expect, it } from 'vitest';
import type { TransactionDto } from '@kharcha/shared';
import { formatDayHeader } from '@/lib/format';
import { groupByDay } from './groupByDay';

const t = (id: string, txnDate: string, amountPaise: number, direction: 'in' | 'out') =>
  ({ id, txnDate, amountPaise, direction }) as TransactionDto;

describe('groupByDay', () => {
  it('groups consecutive dates and totals in/out', () => {
    const groups = groupByDay([
      t('1', '2026-11-02', 100, 'out'),
      t('2', '2026-11-02', 50, 'in'),
      t('3', '2026-11-01', 70, 'out'),
    ]);
    expect(groups.map((g) => [g.date, g.inPaise, g.outPaise, g.transactions.length])).toEqual([
      ['2026-11-02', 50, 100, 2],
      ['2026-11-01', 0, 70, 1],
    ]);
  });
});

describe('formatDayHeader', () => {
  it.each([
    ['2026-11-01', 'Today'],
    ['2026-10-31', 'Yesterday'],
    ['2026-10-29', 'Thu, 29 Oct'],
  ])('%s -> %s', (date, label) => expect(formatDayHeader(date, '2026-11-01')).toBe(label));

  it('adds the year for other years (punctuation varies by ICU version)', () => {
    expect(formatDayHeader('2025-12-25', '2026-11-01')).toMatch(/^Thu, 25 Dec,? 2025$/);
  });
});
