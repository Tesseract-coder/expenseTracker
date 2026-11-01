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
