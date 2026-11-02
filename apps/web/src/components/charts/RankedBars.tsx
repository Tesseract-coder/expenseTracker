import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Money } from '@/components/Money';
import { SERIES } from './tokens';

export interface RankedItem {
  key: string;
  label: string;
  value: number;
  detail?: ReactNode;
  href?: string;
}

/**
 * Ranked horizontal bars (one series → one color). The value sits at the bar's tip in text ink,
 * so every number is readable without hover.
 */
export function RankedBars({ items, color = SERIES[0] }: { items: RankedItem[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="flex flex-col gap-2.5">
      {items.map((i) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{i.label}</span>
              <Money paise={i.value} className="shrink-0 font-medium" />
            </div>
            <div className="mt-1 h-2 w-full">
              <div
                className="h-2 rounded-r-full"
                style={{ width: `${Math.max(1, (i.value / max) * 100)}%`, backgroundColor: color }}
              />
            </div>
            {i.detail && <div className="mt-0.5 text-xs text-muted-foreground">{i.detail}</div>}
          </>
        );
        return (
          <li key={i.key}>
            {i.href ? (
              <Link to={i.href} className="block rounded-md py-1 hover:bg-muted">
                {body}
              </Link>
            ) : (
              <div className="py-1">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
