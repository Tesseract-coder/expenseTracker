import { z } from 'zod';
import { categoryTypeSchema, systemCategoryKeySchema } from './enums';
import { colorSchema, iconSchema, idSchema, nameSchema } from './primitives';

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
export const categoryResponseSchema = z.object({ category: categoryDtoSchema });

/** parentId null => a new group (type required); otherwise a category inheriting the group's type. */
export const categoryCreateSchema = z
  .object({
    name: nameSchema,
    parentId: idSchema.nullable(),
    type: categoryTypeSchema.optional(),
    icon: iconSchema.nullable().default(null),
    color: colorSchema.nullable().default(null),
  })
  .refine((v) => v.parentId !== null || v.type !== undefined, {
    message: 'A new group needs a type',
    path: ['type'],
  });
export type CategoryCreate = z.input<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z
  .object({
    name: nameSchema,
    parentId: idSchema,
    type: categoryTypeSchema,
    icon: iconSchema.nullable(),
    color: colorSchema.nullable(),
    archived: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type CategoryUpdate = z.infer<typeof categoryUpdateSchema>;

export const categoryMergeSchema = z.object({ targetId: idSchema });
export const categoryMergeResponseSchema = z.object({
  moved: z.object({ transactions: z.number().int(), splits: z.number().int() }),
});
