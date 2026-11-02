import { useMemo, useState } from 'react';
import { addDays, isoDayOfWeek, weekStart } from '@kharcha/shared';
import { Money } from '@/components/Money';
import { formatDayHeader } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SEQ } from './tokens';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Bins positive values into the 6 sequential steps by rank (robust to one huge day). */
export function binner(values: number[]): (v: number) => number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return () => -1;
  const cuts = [1, 2, 3, 4, 5].map((i) => sorted[Math.floor((sorted.length * i) / 6)] ?? Infinity);
  return (v) => (v <= 0 ? -1 : cuts.filter((c) => v >= c).length);
}

/**
 * Calendar heatmap of daily spend: Monday-first weeks as columns, one sequential hue light→dark.
 * Each cell is a button (keyboard + screen reader); the selected day shows its amount below.
 */
export function CalendarHeatmap({
  from,
  to,
  daily,
  onSelect,
}: {
  from: string;
  to: string;
  daily: { date: string; spend: number }[];
  onSelect?: (date: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const byDate = useMemo(() => new Map(daily.map((d) => [d.date, d.spend])), [daily]);
  const bin = useMemo(() => binner(daily.map((d) => d.spend)), [daily]);
  const weeks = useMemo(() => {
    const out: string[][] = [];
    for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
      out.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
    }
    return out;
  }, [from, to]);
  const compact = weeks.length > 6;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex gap-1">
          <div className="flex flex-col gap-1 pr-1 text-[10px] text-muted-foreground" aria-hidden>
            {DOW.map((d, i) => (
              <span key={d} className={cn('flex items-center', compact ? 'h-3' : 'h-9')}>
                {compact ? (i % 2 === 0 ? d[0] : '') : d}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} className="flex flex-col gap-1">
              {week.map((date) => {
                const inRange = date >= from && date <= to;
                const spend = byDate.get(date) ?? 0;
                const step = bin(spend);
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={!inRange}
                    aria-label={inRange ? `${formatDayHeader(date)}: spend` : undefined}
                    aria-pressed={selected === date}
                    onClick={() => {
                      setSelected(date);
                      onSelect?.(date);
                    }}
                    className={cn(
                      'rounded-sm outline-offset-1 disabled:invisible',
                      compact ? 'size-3' : 'size-9 text-[10px]',
                      step < 0 && 'bg-muted',
                      selected === date && 'ring-2 ring-foreground',
                    )}
                    style={step >= 0 ? { backgroundColor: SEQ[step] } : undefined}
                  >
                    {!compact && inRange && (
                      <span
                        className={cn(
                          step >= 3 ? 'text-white' : 'text-muted-foreground',
                          'dark:text-foreground',
                        )}
                      >
                        {Number(date.slice(8))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span aria-live="polite" className="min-w-0 truncate">
          {selected ? (
            <>
              {formatDayHeader(selected)} ({DOW[isoDayOfWeek(selected) - 1]}):{' '}
              <Money paise={byDate.get(selected) ?? 0} className="font-medium text-foreground" />
            </>
          ) : (
            'Tap a day to see its spend'
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1" aria-label="Scale: less to more">
          Less
          {SEQ.map((c) => (
            <span
              key={c}
              aria-hidden
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: c }}
            />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
