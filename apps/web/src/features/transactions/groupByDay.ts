import type { TransactionDto } from '@kharcha/shared';

export interface DayGroup {
  date: string;
  inPaise: number;
  outPaise: number;
  transactions: TransactionDto[];
}

/** Groups an already date-sorted list by txnDate, with per-day totals. */
export function groupByDay(transactions: TransactionDto[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const t of transactions) {
    let g = groups.at(-1);
    if (!g || g.date !== t.txnDate) {
      g = { date: t.txnDate, inPaise: 0, outPaise: 0, transactions: [] };
      groups.push(g);
    }
    g.transactions.push(t);
    if (t.direction === 'in') g.inPaise += t.amountPaise;
    else g.outPaise += t.amountPaise;
  }
  return groups;
}
