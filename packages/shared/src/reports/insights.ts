/** Pure report helpers: period-over-period changes and rolling averages. */

export interface ShareChange {
  id: string;
  current: number;
  previous: number;
  delta: number;
  /** Relative change; null when the previous value was 0. */
  pct: number | null;
}

/** Changes per key between two periods, biggest absolute change first. Ignores tiny noise. */
export function shareChanges(
  current: ReadonlyMap<string, number>,
  previous: ReadonlyMap<string, number>,
  minDeltaPaise = 500_00,
): ShareChange[] {
  const ids = new Set([...current.keys(), ...previous.keys()]);
  const out: ShareChange[] = [];
  for (const id of ids) {
    const c = current.get(id) ?? 0;
    const p = previous.get(id) ?? 0;
    const delta = c - p;
    if (Math.abs(delta) < minDeltaPaise) continue;
    out.push({ id, current: c, previous: p, delta, pct: p > 0 ? delta / p : null });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** Relative change, or null when the base is zero. */
export function pctChange(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / Math.abs(previous);
}

/** Trailing average over `window` points (shorter at the start). */
export function rollingAverage(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
  });
}

/** Folds everything after the first `keep` entries into one "Other" entry. */
export function foldOther<T extends { value: number }>(
  items: T[],
  keep: number,
  makeOther: (value: number, count: number) => T,
): T[] {
  if (items.length <= keep + 1) return items;
  const rest = items.slice(keep);
  return [
    ...items.slice(0, keep),
    makeOther(
      rest.reduce((a, b) => a + b.value, 0),
      rest.length,
    ),
  ];
}
