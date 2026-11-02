import { z } from 'zod';
import { formatINR } from '../money';
import {
  categorizedBySchema,
  channelSchema,
  directionSchema,
  txnSourceSchema,
  txnStatusSchema,
} from './enums';
import { idSchema, isoDateSchema, nameSchema, noteSchema, paiseSchema } from './primitives';

export const MAX_SPLITS = 20;
export const MAX_TAGS = 10;

export const tagNameSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/^#/, '').toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9-_]{0,39}$/, 'Tags: letters, digits, - and _ (max 40)'));

export const splitInputSchema = z.object({
  categoryId: idSchema,
  amountPaise: paiseSchema,
  note: noteSchema.nullable().default(null),
});
export type SplitInput = z.input<typeof splitInputSchema>;

const txnFields = {
  accountId: idSchema,
  txnDate: isoDateSchema,
  amountPaise: paiseSchema,
  direction: directionSchema,
  /** Omit (or null) with no splits => Uncategorized. */
  categoryId: idSchema.nullable(),
  /** ≥2 splits whose amounts sum to amountPaise; replaces categoryId. Empty array = not split. */
  splits: z.array(splitInputSchema).max(MAX_SPLITS),
  note: noteSchema.nullable(),
  counterpartyName: nameSchema.nullable(),
  tags: z.array(tagNameSchema).max(MAX_TAGS),
  isReimbursable: z.boolean(),
  reimbursedByTxnId: idSchema.nullable(),
};

/** Shared cross-field checks; returns issues instead of throwing so both create and update reuse it. */
export function splitIssues(
  amountPaise: number | undefined,
  splits: SplitInput[] | undefined,
): string | null {
  if (!splits || splits.length === 0) return null;
  if (splits.length < 2) return 'A split needs at least two parts';
  if (amountPaise === undefined) return 'Amount is required when changing splits';
  const sum = splits.reduce((acc, s) => acc + s.amountPaise, 0);
  if (sum !== amountPaise) {
    return `Split parts add up to ${formatINR(sum)} but the transaction is ${formatINR(amountPaise)}`;
  }
  return null;
}

export const transactionCreateSchema = z
  .object({
    ...txnFields,
    categoryId: txnFields.categoryId.default(null),
    splits: txnFields.splits.default([]),
    note: txnFields.note.default(null),
    counterpartyName: txnFields.counterpartyName.default(null),
    tags: txnFields.tags.default([]),
    isReimbursable: txnFields.isReimbursable.default(false),
    reimbursedByTxnId: txnFields.reimbursedByTxnId.default(null),
  })
  .superRefine((v, ctx) => {
    const issue = splitIssues(v.amountPaise, v.splits);
    if (issue) ctx.addIssue({ code: 'custom', message: issue, path: ['splits'] });
  });
export type TransactionCreate = z.input<typeof transactionCreateSchema>;
export type TransactionCreateParsed = z.output<typeof transactionCreateSchema>;

/**
 * Partial update. `splits` replaces all splits when present ([] un-splits; then categoryId applies).
 * `tags` replaces the tag set when present. Split sums are re-validated server-side against the
 * stored amount when amountPaise is omitted.
 */
export const transactionUpdateSchema = z
  .object(txnFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type TransactionUpdate = z.input<typeof transactionUpdateSchema>;

export const transactionSplitDtoSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  amountPaise: z.number().int(),
  note: z.string().nullable(),
});

export const transactionDtoSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  txnDate: z.string(),
  amountPaise: z.number().int(),
  direction: directionSchema,
  rawNarration: z.string().nullable(),
  channel: channelSchema.nullable(),
  counterparty: z.object({ id: z.string(), name: z.string() }).nullable(),
  categoryId: z.string().nullable(),
  categorizedBy: categorizedBySchema,
  /** Why the category was chosen, e.g. `keyword:swiggy`, `rule:Rent`, `learned:swiggy`. */
  categorizationReason: z.string().nullable(),
  confidence: z.number().nullable(),
  vpa: z.string().nullable(),
  isSplit: z.boolean(),
  splits: z.array(transactionSplitDtoSchema),
  tags: z.array(z.object({ id: z.string(), name: z.string() })),
  note: z.string().nullable(),
  status: txnStatusSchema,
  source: txnSourceSchema,
  isReimbursable: z.boolean(),
  reimbursedByTxnId: z.string().nullable(),
  transferGroupId: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type TransactionDto = z.infer<typeof transactionDtoSchema>;

export const transactionResponseSchema = z.object({ transaction: transactionDtoSchema });

const idList = () =>
  z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(idSchema).max(50));

/** Query string for GET /api/transactions. Comma-separated lists for multi-select filters. */
export const transactionListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  accountIds: idList().optional(),
  /** Group ids expand to their categories; matches split parts too. */
  categoryIds: idList().optional(),
  tagIds: idList().optional(),
  direction: directionSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** Searches narration, note and counterparty name; numeric queries also match the exact amount. */
  q: z.string().trim().max(100).optional(),
  importId: idSchema.optional(),
  uncategorized: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type TransactionListQuery = z.input<typeof transactionListQuerySchema>;

export const transactionListResponseSchema = z.object({
  transactions: z.array(transactionDtoSchema),
  nextCursor: z.string().nullable(),
});
export type TransactionListResponse = z.infer<typeof transactionListResponseSchema>;

export const deleteResponseSchema = z.object({ undoToken: z.string() });
export const undoResponseSchema = z.object({ restored: z.number().int() });

export const tagDtoSchema = z.object({ id: z.string(), name: z.string(), count: z.number().int() });
export const tagListResponseSchema = z.object({ tags: z.array(tagDtoSchema) });

export const counterpartyDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  vpa: z.string().nullable(),
  txnCount: z.number().int(),
  lastSeenDate: z.string().nullable(),
});
export type CounterpartyDto = z.infer<typeof counterpartyDtoSchema>;
export const counterpartyListResponseSchema = z.object({
  counterparties: z.array(counterpartyDtoSchema),
});
