import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { Direction } from '@kharcha/shared';
import type { TxnFilters } from '@/app/queries';

/** Transaction filters live in the URL so they survive reloads and back/forward. */
export function useTxnFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<TxnFilters>(() => {
    // Values stay in the API's query-string form (comma-separated id lists).
    const get = (k: string) => params.get(k) || undefined;
    const direction = params.get('direction');
    return {
      q: get('q'),
      accountIds: get('accountIds'),
      categoryIds: get('categoryIds'),
      tagIds: get('tagIds'),
      direction: direction === 'in' || direction === 'out' ? (direction as Direction) : undefined,
      from: get('from'),
      importId: get('importId'),
      to: get('to'),
      uncategorized: params.get('uncategorized') === 'true' ? 'true' : undefined,
    };
  }, [params]);

  const setFilter = useCallback(
    (key: string, value: string | string[] | undefined) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const v = Array.isArray(value) ? value.join(',') : value;
          if (v) next.set(key, v);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clearAll = useCallback(() => setParams({}, { replace: true }), [setParams]);
  const activeCount = [
    'accountIds',
    'categoryIds',
    'tagIds',
    'direction',
    'from',
    'to',
    'uncategorized',
  ].filter((k) => params.has(k)).length;

  return { filters, params, setFilter, clearAll, activeCount };
}

export const splitIds = (csv: string | undefined): string[] =>
  csv?.split(',').filter(Boolean) ?? [];
