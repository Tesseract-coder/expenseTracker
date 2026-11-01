import { z } from 'zod';
import { categoryTypeSchema, systemCategoryKeySchema } from './enums';

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  env: z.string(),
  db: z.enum(['ok', 'error']),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const meResponseSchema = z.object({
  id: z.string(),
  email: z.email(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const categoryDtoSchema = z.object({
  id: z.string(),
  slug: z.string().nullable(),
  parentId: z.string().nullable(),
  name: z.string(),
  type: categoryTypeSchema,
  systemKey: systemCategoryKeySchema.nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  archived: z.boolean(),
  sortOrder: z.number().int(),
});
export type CategoryDto = z.infer<typeof categoryDtoSchema>;

export const categoryListResponseSchema = z.object({ categories: z.array(categoryDtoSchema) });
export type CategoryListResponse = z.infer<typeof categoryListResponseSchema>;
