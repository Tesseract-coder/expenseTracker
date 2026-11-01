import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
  type AccountCreate,
  type AccountUpdate,
  accountListResponseSchema,
  accountResponseSchema,
  type CategoryCreate,
  type CategoryDto,
  type CategoryUpdate,
  categoryListResponseSchema,
  categoryMergeResponseSchema,
  categoryResponseSchema,
  counterpartyListResponseSchema,
  deleteResponseSchema,
  healthResponseSchema,
  meResponseSchema,
  tagListResponseSchema,
  type TransactionCreate,
  type TransactionListQuery,
  type TransactionListResponse,
  type TransactionUpdate,
  transactionListResponseSchema,
  transactionResponseSchema,
  undoResponseSchema,
} from '@kharcha/shared';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';

export type TxnFilters = Omit<TransactionListQuery, 'cursor' | 'limit'>;

export const queryKeys = {
  health: ['health'] as const,
  me: ['me'] as const,
  categories: ['categories'] as const,
  accounts: ['accounts'] as const,
  tags: ['tags'] as const,
  counterparties: (q: string) => ['counterparties', q] as const,
  transactions: ['transactions'] as const,
  transactionList: (f: TxnFilters) => ['transactions', 'list', f] as const,
};

export const useHealth = () =>
  useQuery({ queryKey: queryKeys.health, queryFn: () => apiGet('/health', healthResponseSchema) });

export const useMe = () =>
  useQuery({
    queryKey: queryKeys.me,
    queryFn: () => apiGet('/me', meResponseSchema),
    staleTime: Infinity,
  });

export const useCategories = () =>
  useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => apiGet('/categories', categoryListResponseSchema),
    staleTime: 5 * 60_000,
    select: (d) => d.categories,
  });

/** Categories plus an id lookup map. */
export function useCategoryMap() {
  const q = useCategories();
  const byId = useMemo(() => new Map((q.data ?? []).map((c) => [c.id, c] as const)), [q.data]);
  return { ...q, byId };
}

export const useAccounts = () =>
  useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => apiGet('/accounts', accountListResponseSchema),
    select: (d) => d.accounts,
  });

export const useTags = () =>
  useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => apiGet('/tags', tagListResponseSchema),
    select: (d) => d.tags,
  });

export const useCounterparties = (q: string) =>
  useQuery({
    queryKey: queryKeys.counterparties(q),
    queryFn: () =>
      apiGet(
        `/counterparties${q ? `?q=${encodeURIComponent(q)}` : ''}`,
        counterpartyListResponseSchema,
      ),
    select: (d) => d.counterparties,
    staleTime: 60_000,
  });

export function toQueryString(
  params: Record<string, string | number | boolean | string[] | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const useTransactions = (filters: TxnFilters, limit = 50) =>
  useInfiniteQuery({
    queryKey: queryKeys.transactionList(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet(
        `/transactions${toQueryString({ ...filters, limit, cursor: pageParam })}`,
        transactionListResponseSchema,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

// ---------------------------------------------------------------------------- mutations

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

/** Any transaction write can change balances, tags and counterparties. */
const TXN_KEYS = [
  queryKeys.transactions,
  queryKeys.accounts,
  queryKeys.tags,
  ['counterparties'],
] as const;

export function useCreateTransaction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: TransactionCreate) =>
      apiPost('/transactions', body, transactionResponseSchema),
    onSuccess: () => invalidate(...TXN_KEYS),
  });
}

export function useUpdateTransaction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TransactionUpdate }) =>
      apiPatch(`/transactions/${id}`, patch, transactionResponseSchema),
    onSuccess: () => invalidate(...TXN_KEYS),
  });
}

/** Optimistically removes the row from every cached list; rolls back on failure. */
export function useDeleteTransaction() {
  const qc = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/transactions/${id}`, deleteResponseSchema),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: queryKeys.transactions });
      const snapshot = qc.getQueriesData<{ pages: TransactionListResponse[] }>({
        queryKey: queryKeys.transactions,
      });
      qc.setQueriesData<{ pages: TransactionListResponse[]; pageParams: unknown[] }>(
        { queryKey: queryKeys.transactions },
        (old) =>
          old?.pages
            ? {
                ...old,
                pages: old.pages.map((p) => ({
                  ...p,
                  transactions: p.transactions.filter((t) => t.id !== id),
                })),
              }
            : old,
      );
      return { snapshot };
    },
    onError: (_e, _id, ctx) => ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => invalidate(...TXN_KEYS),
  });
}

export function useUndo() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (token: string) => apiPost(`/undo/${token}`, {}, undoResponseSchema),
    onSuccess: () => invalidate(...TXN_KEYS),
  });
}

export function useSaveAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (args: { id?: string; body: AccountCreate | AccountUpdate }) =>
      args.id
        ? apiPatch(`/accounts/${args.id}`, args.body, accountResponseSchema)
        : apiPost('/accounts', args.body, accountResponseSchema),
    onSuccess: () => invalidate(queryKeys.accounts),
  });
}

export function useDeleteAccount() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/accounts/${id}`),
    onSuccess: () => invalidate(queryKeys.accounts),
  });
}

export function useSaveCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (args: { id?: string; body: CategoryCreate | CategoryUpdate }) =>
      args.id
        ? apiPatch(`/categories/${args.id}`, args.body, categoryResponseSchema)
        : apiPost('/categories', args.body, categoryResponseSchema),
    onSuccess: () => invalidate(queryKeys.categories),
  });
}

export function useMergeCategory() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ source, target }: { source: CategoryDto; target: CategoryDto }) =>
      apiPost(
        `/categories/${source.id}/merge`,
        { targetId: target.id },
        categoryMergeResponseSchema,
      ),
    onSuccess: () => invalidate(queryKeys.categories, queryKeys.transactions),
  });
}
