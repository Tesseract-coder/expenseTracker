import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Money } from '@/components/Money';
import { compactINR } from '@/lib/format';
import { usePreferences } from '@/lib/preferences';
import { AXIS, GRID, TICK } from './tokens';

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

type Row = { bucket: string } & Record<string, number | string>;

/** Hover/focus tooltip: series swatch + label in text ink, amount through <Money> (privacy-aware). */
function ChartTooltip({
  active,
  payload,
  label,
  series,
  formatBucket,
}: {
  active?: boolean;
  payload?: readonly { dataKey?: unknown; value?: unknown }[];
  label?: unknown;
  series: SeriesDef[];
  formatBucket: (b: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const byKey = new Map(payload.map((p) => [String(p.dataKey), Number(p.value ?? 0)]));
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{formatBucket(String(label))}</p>
      <ul className="flex flex-col gap-0.5">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 rounded-sm"
              style={{ backgroundColor: s.color }}
            />
            <span className="flex-1 text-muted-foreground">{s.label}</span>
            <Money paise={byKey.get(s.key) ?? 0} className="font-medium" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function useTickFormatter() {
  const { privacy } = usePreferences();
  return (v: number) => (privacy ? '•••' : compactINR(v));
}

const axisProps = {
  tick: TICK,
  tickLine: false,
  axisLine: { stroke: AXIS },
} as const;

/** Single-series spend over time: 2px line with a 10% wash, crosshair tooltip. */
export function TrendArea({
  data,
  series,
  height = 160,
  labelFormatter,
  showYAxis = true,
}: {
  data: Row[];
  series: SeriesDef;
  height?: number;
  labelFormatter: (bucket: string) => string;
  showYAxis?: boolean;
}) {
  const tick = useTickFormatter();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="bucket" tickFormatter={labelFormatter} minTickGap={24} {...axisProps} />
        <YAxis hide={!showYAxis} tickFormatter={tick} width={52} {...axisProps} axisLine={false} />
        <Tooltip
          cursor={{ stroke: AXIS, strokeWidth: 1 }}
          content={(p) => <ChartTooltip {...p} series={[series]} formatBucket={labelFormatter} />}
        />
        <Area
          type="monotone"
          dataKey={series.key}
          name={series.label}
          stroke={series.color}
          strokeWidth={2}
          fill={series.color}
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2, fill: series.color }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Columns over time, grouped or stacked. Bars ≤ 24px, 4px rounded data ends square at the
 * baseline, 2px surface gaps between touching fills.
 */
export function ColumnChart({
  data,
  series,
  stacked = false,
  height = 220,
  labelFormatter,
}: {
  data: Row[];
  series: SeriesDef[];
  stacked?: boolean;
  height?: number;
  labelFormatter: (bucket: string) => string;
}) {
  const tick = useTickFormatter();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        barGap={2}
        barCategoryGap="20%"
      >
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="bucket" tickFormatter={labelFormatter} minTickGap={8} {...axisProps} />
        <YAxis tickFormatter={tick} width={52} {...axisProps} axisLine={false} />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          content={(p) => <ChartTooltip {...p} series={series} formatBucket={labelFormatter} />}
        />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color}
            maxBarSize={24}
            stackId={stacked ? 'stack' : undefined}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
            stroke={stacked ? 'var(--card)' : undefined}
            strokeWidth={stacked ? 1 : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
