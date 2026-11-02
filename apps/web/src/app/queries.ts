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
  type ImportCommitRequest,
  type ImportPreviewRequest,
  importCommitResponseSchema,
  importListResponseSchema,
  importPreviewResponseSchema,
  importRevertResponseSchema,
  importUploadResponseSchema,
  parserProfileListResponseSchema,
  parserProfileResponseSchema,
  type ColumnMapping,
  bulkCategoryResponseSchema,
  categorizationRunResponseSchema,
  type CategorizationRunResponse,
  counterpartyMergeResponseSchema,
  inboxCountResponseSchema,
  inboxResponseSchema,
  labelImpactResponseSchema,
  type LabelRequest,
  labelResponseSchema,
  learnedLabelListResponseSchema,
  learnedLabelResponseSchema,
  type RuleConditions,
  type RuleCreate,
  ruleListResponseSchema,
  ruleResponseSchema,
  ruleTestResponseSchema,
  type RuleUpdate,
  counterpartyDtoSchema,
} from '@kharcha/shared';
import { z } from 'zod';
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '@/lib/api';

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
  imports: ['imports'] as const,
  parserProfiles: ['parser-profiles'] as const,
  inbox: ['inbox'] as const,
  rules: ['rules'] as const,
  learnedLabels: ['learned-labels'] as const,
  labelImpact: (
    txnId: string,
    categoryId: string,
    matchDirection: boolean,
    matchAccount: boolean,
  ) => ['label-impact', txnId, categoryId, matchDirection, matchAccount] as const,
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

export const useCounterparties = (q: string, limit = 20) =>
  useQuery({
    queryKey: [...queryKeys.counterparties(q), limit],
    queryFn: () =>
      apiGet(`/counterparties${toQueryString({ q, limit })}`, counterpartyListResponseSchema),
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

/** Any transaction write can change balances, tags, counterparties and the inbox. */
const TXN_KEYS = [
  queryKeys.transactions,
  queryKeys.accounts,
  queryKeys.tags,
  ['counterparties'],
  queryKeys.inbox,
  ['label-impact'],
] as const;
/** Category changes also move rule/learned-label hit counts. */
const CATEGORY_KEYS = [...TXN_KEYS, queryKeys.rules, queryKeys.learnedLabels] as const;

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
    onSuccess: () => invalidate(...CATEGORY_KEYS),
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

// ---------------------------------------------------------------------------- imports

export const useImports = () =>
  useQuery({
    queryKey: queryKeys.imports,
    queryFn: () => apiGet('/imports', importListResponseSchema),
    select: (d) => d.imports,
  });

export const useParserProfiles = () =>
  useQuery({
    queryKey: queryKeys.parserProfiles,
    queryFn: () => apiGet('/parser-profiles', parserProfileListResponseSchema),
    select: (d) => d.profiles,
  });

export function useUploadStatement() {
  return useMutation({
    mutationFn: ({ accountId, file }: { accountId: string; file: File }) => {
      const form = new FormData();
      form.set('accountId', accountId);
      form.set('file', file);
      return apiUpload('/imports', form, importUploadResponseSchema);
    },
  });
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: ({ importId, body }: { importId: string; body: ImportPreviewRequest }) =>
      apiPost(`/imports/${importId}/preview`, body, importPreviewResponseSchema),
  });
}

export function useCommitImport() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ importId, body }: { importId: string; body: ImportCommitRequest }) =>
      apiPost(`/imports/${importId}/commit`, body, importCommitResponseSchema),
    onSuccess: () => invalidate(...TXN_KEYS, queryKeys.imports),
  });
}

export function useRevertImport() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (importId: string) =>
      apiPost(`/imports/${importId}/revert`, {}, importRevertResponseSchema),
    onSuccess: () => invalidate(...TXN_KEYS, queryKeys.imports),
  });
}

export function useSaveParserProfile() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { name: string; mapping: ColumnMapping; accountId: string | null }) =>
      apiPost('/parser-profiles', body, parserProfileResponseSchema),
    onSuccess: () => invalidate(queryKeys.parserProfiles, queryKeys.accounts),
  });
}

// ---------------------------------------------------------------------------- categorization

export const useInbox = (limit = 30) =>
  useInfiniteQuery({
    queryKey: [...queryKeys.inbox, 'list', limit],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet(`/inbox${toQueryString({ limit, cursor: pageParam })}`, inboxResponseSchema),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useInboxCount = () =>
  useQuery({
    queryKey: [...queryKeys.inbox, 'count'],
    queryFn: () => apiGet('/inbox/count', inboxCountResponseSchema),
    select: (d) => d.count,
  });

export const useLabelImpact = (
  txnId: string | null,
  categoryId: string | null,
  matchDirection: boolean,
  matchAccount: boolean,
  enabled: boolean,
) =>
  useQuery({
    queryKey: queryKeys.labelImpact(txnId ?? '', categoryId ?? '', matchDirection, matchAccount),
    queryFn: () =>
      apiGet(
        `/transactions/${txnId}/category/impact${toQueryString({ categoryId: categoryId ?? '', matchDirection, matchAccount })}`,
        labelImpactResponseSchema,
      ),
    enabled: enabled && !!txnId && !!categoryId,
  });

export function useLabelTransaction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LabelRequest }) =>
      apiPatch(`/transactions/${id}/category`, body, labelResponseSchema),
    onSuccess: () => invalidate(...CATEGORY_KEYS),
  });
}

export function useBulkCategorize() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { ids: string[]; categoryId: string }) =>
      apiPost('/transactions/bulk-category', body, bulkCategoryResponseSchema),
    onSuccess: () => invalidate(...CATEGORY_KEYS),
  });
}

/** Loops a chunked server job (re-run / apply rule) until done; one undo token for the whole run. */
async function runChunks(
  path: string,
  body: Record<string, unknown>,
): Promise<CategorizationRunResponse> {
  let total: CategorizationRunResponse | null = null;
  let cursor: string | undefined;
  for (let i = 0; i < 200; i++) {
    const r: CategorizationRunResponse = await apiPost(
      path,
      { ...body, cursor, batchId: total?.batchId },
      categorizationRunResponseSchema,
    );
    total = total
      ? { ...r, processed: total.processed + r.processed, changed: total.changed + r.changed }
      : r;
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  return total as CategorizationRunResponse;
}

export function useRunCategorization() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (scope: 'uncategorized' | 'all') => runChunks('/categorization/run', { scope }),
    onSuccess: () => invalidate(...CATEGORY_KEYS),
  });
}

export const useRules = () =>
  useQuery({
    queryKey: queryKeys.rules,
    queryFn: () => apiGet('/rules', ruleListResponseSchema),
    select: (d) => d.rules,
  });

export function useSaveRule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (args: { id?: string; body: RuleCreate | RuleUpdate }) =>
      args.id
        ? apiPatch(`/rules/${args.id}`, args.body, ruleResponseSchema)
        : apiPost('/rules', args.body, ruleResponseSchema),
    onSuccess: () => invalidate(queryKeys.rules),
  });
}

export function useDeleteRule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/rules/${id}`),
    onSuccess: () => invalidate(queryKeys.rules),
  });
}

export function useReorderRules() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (ids: string[]) => apiPost('/rules/reorder', { ids }, ruleListResponseSchema),
    onSuccess: () => invalidate(queryKeys.rules),
  });
}

export function useTestRule() {
  return useMutation({
    mutationFn: (conditions: RuleConditions) =>
      apiPost('/rules/test', { conditions }, ruleTestResponseSchema),
  });
}

export function useApplyRule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => runChunks(`/rules/${id}/apply`, {}),
    onSuccess: () => invalidate(...CATEGORY_KEYS),
  });
}

export const useLearnedLabels = () =>
  useQuery({
    queryKey: queryKeys.learnedLabels,
    queryFn: () => apiGet('/learned-labels', learnedLabelListResponseSchema),
    select: (d) => d.labels,
  });

export function useUpdateLearnedLabel() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { categoryId?: string; enabled?: boolean } }) =>
      apiPatch(`/learned-labels/${id}`, body, learnedLabelResponseSchema),
    onSuccess: () => invalidate(queryKeys.learnedLabels),
  });
}

export function useDeleteLearnedLabel() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/learned-labels/${id}`),
    onSuccess: () => invalidate(queryKeys.learnedLabels),
  });
}

export function useRenameCounterparty() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, displayName }: { id: string; displayName: string }) =>
      apiPatch(
        `/counterparties/${id}`,
        { displayName },
        z.object({ counterparty: counterpartyDtoSchema }),
      ),
    onSuccess: () =>
      invalidate(['counterparties'], queryKeys.transactions, queryKeys.learnedLabels),
  });
}

export function useMergeCounterparty() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, targetId }: { id: string; targetId: string }) =>
      apiPost(`/counterparties/${id}/merge`, { targetId }, counterpartyMergeResponseSchema),
    onSuccess: () => invalidate(...CATEGORY_KEYS),
  });
}
