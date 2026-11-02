import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  OctagonAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Money } from '@/components/Money';
import { Card } from '@/components/ui/card';
import { formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Signed change vs a named period. Color = direction × whether up is good, with an arrow, so the
 * meaning never rests on color alone.
 */
export function Delta({
  current,
  previous,
  upIsGood,
  vs,
  points = false,
}: {
  current: number | null;
  previous: number | null | undefined;
  upIsGood: boolean;
  vs: string;
  /** Show the change in percentage points (for rates). */
  points?: boolean;
}) {
  if (current === null || previous === null || previous === undefined) return null;
  const diff = current - previous;
  const rel = points ? diff : previous === 0 ? null : diff / Math.abs(previous);
  if (rel === null || Math.abs(rel) < 0.005) {
    return <span className="text-xs text-muted-foreground">No change vs {vs}</span>;
  }
  const up = diff > 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  // Huge relative swings (e.g. from a near-zero base) carry no extra meaning past 999%.
  const text = points
    ? `${(Math.abs(rel) * 100).toFixed(1)} pts`
    : Math.abs(rel) > 9.99
      ? '999%+'
      : formatPct(Math.abs(rel));
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        good ? 'text-delta-good' : 'text-delta-bad',
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
      {text} <span className="font-normal text-muted-foreground">vs {vs}</span>
    </span>
  );
}

/** Stat tile: label · value (proportional figures) · optional delta. */
export function StatTile({
  label,
  paise,
  text,
  delta,
  className,
}: {
  label: string;
  paise?: number;
  text?: string;
  delta?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex min-w-0 flex-col gap-1 p-3', className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {paise !== undefined ? (
        <Money paise={paise} className="truncate text-lg font-semibold proportional-nums" />
      ) : (
        <span data-money className="text-lg font-semibold">
          {text}
        </span>
      )}
      {delta}
    </Card>
  );
}

export type Severity = 'good' | 'warning' | 'serious' | 'critical' | 'na';

const STATUS: Record<Severity, { label: string; icon: typeof CheckCircle2; className: string }> = {
  good: { label: 'Good', icon: CheckCircle2, className: 'text-status-good' },
  warning: { label: 'Watch', icon: AlertTriangle, className: 'text-status-warning' },
  serious: { label: 'Needs attention', icon: CircleAlert, className: 'text-status-serious' },
  critical: { label: 'Off track', icon: OctagonAlert, className: 'text-status-critical' },
  na: { label: 'Not enough data', icon: CircleAlert, className: 'text-muted-foreground' },
};

/** Status always ships as icon + label; the color is never the only signal. */
export function StatusBadge({ status, label }: { status: Severity; label?: string }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium">
      <s.icon aria-hidden className={cn('size-4', s.className)} />
      {label ?? s.label}
    </span>
  );
}

/**
 * Meter for a budget: fill = spend share, tinted by severity; the track is a lighter step of
 * the same hue. Capped visually at 100% (the label carries the overflow).
 */
export function Meter({
  pct,
  state,
  label,
}: {
  pct: number;
  state: 'ok' | 'warning' | 'over';
  label: string;
}) {
  const color =
    state === 'over'
      ? 'var(--status-critical)'
      : state === 'warning'
        ? 'var(--status-warning)'
        : 'var(--series-1)';
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
      className="relative h-2 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: `color-mix(in oklab, ${color} 18%, var(--card))` }}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%`, backgroundColor: color }}
      />
    </div>
  );
}

/**
 * Tall segmented bar (one whole split into ≤ 6 parts): the part-to-whole form used instead of
 * a donut. Shares are printed inside only when they fit; the legend/list carries names.
 */
export function SegmentedBar({
  parts,
  label,
}: {
  parts: { key: string; label: string; value: number; color: string }[];
  label: string;
}) {
  const positive = parts.filter((p) => p.value > 0);
  const total = positive.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return null;
  return (
    <div
      role="img"
      aria-label={`${label}: ${positive.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}`}
      className="flex h-7 w-full gap-0.5"
    >
      {positive.map((p) => {
        const share = p.value / total;
        return (
          <div
            key={p.key}
            title={`${p.label}: ${Math.round(share * 100)}%`}
            className="flex min-w-0 items-center overflow-hidden rounded px-1.5 text-[11px] font-semibold"
            style={{
              width: `${share * 100}%`,
              backgroundColor: p.color,
              // Near-black on the yellow slot, white on the others (palette spec).
              color: p.color === 'var(--series-4)' ? '#0b0b0b' : '#ffffff',
            }}
          >
            {share >= 0.12 && <span className="truncate">{Math.round(share * 100)}%</span>}
          </div>
        );
      })}
    </div>
  );
}
