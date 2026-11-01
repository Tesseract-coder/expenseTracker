import { formatINR } from '@kharcha/shared';
import { cn } from '@/lib/utils';

interface MoneyProps {
  paise: number;
  direction?: 'in' | 'out';
  className?: string;
}

/** Renders INR with Indian grouping; respects privacy blur via [data-money]. */
export function Money({ paise, direction, className }: MoneyProps) {
  return (
    <span
      data-money
      className={cn(
        'tabular-nums',
        direction === 'in' && 'text-income',
        direction === 'out' && 'text-expense',
        className,
      )}
    >
      {direction === 'in' ? '+' : direction === 'out' ? '−' : ''}
      {formatINR(paise)}
    </span>
  );
}
