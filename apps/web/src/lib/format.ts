import { addDays, toIstDate } from '@kharcha/shared';

const dayFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dayFmtWithYear = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Today", "Yesterday", "Sat, 31 Oct" (adds the year when it isn't the current one). */
export function formatDayHeader(date: string, today = toIstDate()): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const d = new Date(`${date}T00:00:00Z`);
  return (date.slice(0, 4) === today.slice(0, 4) ? dayFmt : dayFmtWithYear).format(d);
}

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  savings: 'Savings',
  current: 'Current',
  credit_card: 'Credit card',
  cash: 'Cash',
  wallet: 'Wallet',
  investment: 'Investment',
};

export const BANK_LABELS: Record<string, string> = {
  hdfc: 'HDFC Bank',
  icici: 'ICICI Bank',
  sbi: 'SBI',
  axis: 'Axis Bank',
  kotak: 'Kotak',
  other: 'Other',
};

export const DEFAULT_COLOR = '#0f766e';

export const PALETTE = [
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#16a34a',
  '#ca8a04',
  '#64748b',
  '#dc2626',
  '#0891b2',
];

/** Compact INR for axis ticks: ₹950, ₹12K, ₹1.2L, ₹3.4Cr (Indian units). */
export function compactINR(paise: number): string {
  const r = Math.round(paise / 100);
  const a = Math.abs(r);
  const sign = r < 0 ? '−' : '';
  const trim = (n: number) =>
    n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, '');
  if (a >= 1_00_00_000) return `${sign}₹${trim(a / 1_00_00_000)}Cr`;
  if (a >= 1_00_000) return `${sign}₹${trim(a / 1_00_000)}L`;
  if (a >= 1_000) return `${sign}₹${trim(a / 1_000)}K`;
  return `${sign}₹${a}`;
}

/** "▲ 12%" style relative change; null when there is no base to compare. */
export function formatPct(x: number | null, digits = 0): string {
  if (x === null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

const monthShort = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });
const monthShortYear = new Intl.DateTimeFormat('en-IN', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const dayMonth = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** Axis label for a bucket key: '2026-10' → "Oct 26", '2026-10-05' → "5 Oct", 'FY 2026-27' as is. */
export function bucketLabel(bucket: string, long = false): string {
  if (/^\d{4}-\d{2}$/.test(bucket)) {
    const d = new Date(`${bucket}-01T00:00:00Z`);
    return (long ? monthShortYear : monthShort).format(d);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(bucket)) return dayMonth.format(new Date(`${bucket}T00:00:00Z`));
  return bucket;
}
