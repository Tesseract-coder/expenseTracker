/**
 * Chart color roles (CSS variables defined per theme in index.css). Categorical slots are assigned
 * in this fixed order and never cycled: a 7th series folds into "Other".
 */
export const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
] as const;
export const MAX_SERIES = SERIES.length;
export const OTHER_COLOR = 'var(--chart-axis)';
/** Sequential blue ramp (light → dark in light mode; recedes toward the surface in dark mode). */
export const SEQ = [
  'var(--seq-1)',
  'var(--seq-2)',
  'var(--seq-3)',
  'var(--seq-4)',
  'var(--seq-5)',
  'var(--seq-6)',
];
export const GRID = 'var(--chart-grid)';
export const AXIS = 'var(--chart-axis)';
export const MUTED = 'var(--chart-muted)';
export const TICK = { fill: MUTED, fontSize: 11 } as const;
