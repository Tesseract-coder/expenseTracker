import { useQuery } from '@tanstack/react-query';
import {
  categoryListResponseSchema,
  healthResponseSchema,
  meResponseSchema,
} from '@kharcha/shared';
import { apiGet } from '@/lib/api';

export const queryKeys = {
  health: ['health'] as const,
  me: ['me'] as const,
  categories: ['categories'] as const,
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
  });
