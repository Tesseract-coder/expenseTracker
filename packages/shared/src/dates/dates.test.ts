import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  fyLabel,
  fyStartYear,
  isIsoDate,
  isoDayOfWeek,
  monthKey,
  periodRange,
  previousPeriodRange,
  toIstDate,
  weekOfMonth,
  weekStart,
} from './dates';

describe('toIstDate', () => {
  it('rolls over to the next day at 18:30 UTC', () => {
    expect(toIstDate(new Date('2026-03-31T18:29:59Z'))).toBe('2026-03-31');
    expect(toIstDate(new Date('2026-03-31T18:30:00Z'))).toBe('2026-04-01');
  });
  it('accepts epoch ms and defaults to now', () => {
    expect(toIstDate(Date.UTC(2026, 0, 1, 0, 0))).toBe('2026-01-01');
    expect(isIsoDate(toIstDate())).toBe(true);
  });
});

describe('isIsoDate', () => {
  it.each([
    ['2026-02-28', true],
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['26-01-01', false],
    ['2026-1-1', false],
  ])('%s -> %s', (s, ok) => expect(isIsoDate(s)).toBe(ok));
});

describe('arithmetic', () => {
  it('adds and diffs days across month/year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(diffDays('2026-01-30', '2026-02-02')).toBe(3);
    expect(diffDays('2026-02-02', '2026-01-30')).toBe(-3);
  });
  it('throws on invalid input', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });
});

describe('weeks', () => {
  it.each([
    ['2026-11-02', 1, '2026-11-02'], // Monday
    ['2026-11-01', 7, '2026-10-26'], // Sunday
    ['2026-11-04', 3, '2026-11-02'],
    ['2027-01-01', 5, '2026-12-28'], // crosses year
  ])('%s: dow %d, week starts %s', (d, dow, ws) => {
    expect(isoDayOfWeek(d)).toBe(dow);
    expect(weekStart(d)).toBe(ws);
  });
  it.each([
    ['2026-11-01', 1],
    ['2026-11-07', 1],
    ['2026-11-08', 2],
    ['2026-11-28', 4],
    ['2026-11-29', 5],
    ['2026-12-31', 5],
  ])('week of month %s -> %d', (d, w) => expect(weekOfMonth(d)).toBe(w));
});

describe('financial year', () => {
  it.each([
    ['2026-03-31', 2025],
    ['2026-04-01', 2026],
    ['2026-12-31', 2026],
    ['2027-01-15', 2026],
  ])('%s -> FY start %d', (d, y) => expect(fyStartYear(d)).toBe(y));
  it('labels', () => {
    expect(fyLabel(2025)).toBe('FY 2025-26');
    expect(fyLabel(2099)).toBe('FY 2099-00');
  });
});

describe('periodRange', () => {
  it('week', () => {
    expect(periodRange('week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });
  it('month incl. leap February', () => {
    expect(periodRange('month', '2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(periodRange('month', '2026-11-15')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
  it('calendar and FY year', () => {
    expect(periodRange('year', '2026-02-10')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('year', '2026-02-10', 'fy')).toEqual({
      from: '2025-04-01',
      to: '2026-03-31',
    });
  });
  it('previous period', () => {
    expect(previousPeriodRange('month', periodRange('month', '2026-03-15'))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(previousPeriodRange('week', periodRange('week', '2026-11-04'))).toEqual({
      from: '2026-10-26',
      to: '2026-11-01',
    });
    expect(previousPeriodRange('year', periodRange('year', '2026-05-01', 'fy'), 'fy')).toEqual({
      from: '2025-04-01',
      to: '2026-03-31',
    });
  });
  it('monthKey', () => expect(monthKey('2026-11-01')).toBe('2026-11'));
  it('rejects invalid dates', () => expect(() => periodRange('month', 'nope')).toThrow(RangeError));
});
