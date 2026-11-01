import { z } from 'zod';
import { accountTypeSchema, bankSchema } from './enums';
import { colorSchema, idSchema, isoDateSchema, nameSchema, signedPaiseSchema } from './primitives';

export const last4Schema = z.string().regex(/^\d{4}$/, 'Must be exactly 4 digits');

export const accountCreateSchema = z.object({
  name: nameSchema,
  type: accountTypeSchema,
  bank: bankSchema.nullable().default(null),
  last4: last4Schema.nullable().default(null),
  openingBalancePaise: signedPaiseSchema.default(0),
  openingBalanceDate: isoDateSchema,
  color: colorSchema.nullable().default(null),
});
export type AccountCreate = z.input<typeof accountCreateSchema>;

export const accountUpdateSchema = z
  .object({
    name: nameSchema,
    type: accountTypeSchema,
    bank: bankSchema.nullable(),
    last4: last4Schema.nullable(),
    openingBalancePaise: signedPaiseSchema,
    openingBalanceDate: isoDateSchema,
    color: colorSchema.nullable(),
    active: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type AccountUpdate = z.infer<typeof accountUpdateSchema>;

export const accountDtoSchema = z.object({
  id: idSchema,
  name: z.string(),
  type: accountTypeSchema,
  bank: bankSchema.nullable(),
  last4: z.string().nullable(),
  openingBalancePaise: z.number().int(),
  openingBalanceDate: z.string(),
  color: z.string().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  /** opening balance + Σ signed transactions on/after the opening date. Negative = owed (cards). */
  balancePaise: z.number().int(),
  txnCount: z.number().int(),
  /** Saved column mapping (from the import wizard) used for this account's next imports. */
  parserProfileId: z.string().nullable(),
});
export type AccountDto = z.infer<typeof accountDtoSchema>;

export const accountListResponseSchema = z.object({ accounts: z.array(accountDtoSchema) });
export const accountResponseSchema = z.object({ account: accountDtoSchema });
