import { z } from 'zod';
import { categorizedBySchema, directionSchema } from '../schemas/enums';
import { idSchema, nameSchema, noteSchema } from '../schemas/primitives';
import { tagNameSchema, transactionDtoSchema } from '../schemas/transactions';
import { ruleConditionsSchema } from './rules';

// ---------------------------------------------------------------------------- label (learn-from-label)

export const LABEL_SCOPES = ['this', 'future', 'past_and_future'] as const;
export const labelScopeSchema = z.enum(LABEL_SCOPES);
export type LabelScope = z.infer<typeof labelScopeSchema>;

/** PATCH /api/transactions/:id/category */
export const labelRequestSchema = z.object({
  categoryId: idSchema,
  scope: labelScopeSchema.default('this'),
  /** Learn only for this direction (a refund from Amazon is not shopping). */
  matchDirection: z.boolean().default(true),
  /** Learn only for this account. */
  matchAccount: z.boolean().default(false),
});
export type LabelRequest = z.input<typeof labelRequestSchema>;

const boolString = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .default(false);

/** GET /api/transactions/:id/category/impact */
export const labelImpactQuerySchema = z.object({
  categoryId: idSchema,
  matchDirection: boolString,
  matchAccount: boolString,
});
export type LabelImpactQuery = z.input<typeof labelImpactQuerySchema>;

export const labelImpactResponseSchema = z.object({
  counterparty: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Past transactions that "All past + future" would recategorize (manual and rule-set ones excluded). */
  count: z.number().int(),
});

export const labelResponseSchema = z.object({
  transaction: transactionDtoSchema,
  learnedLabelId: z.string().nullable(),
  /** Other past transactions recategorized. */
  applied: z.number().int(),
  undoToken: z.string(),
});
export type LabelResponse = z.infer<typeof labelResponseSchema>;

// ---------------------------------------------------------------------------- bulk relabel

export const MAX_BULK_IDS = 500;

export const bulkCategoryRequestSchema = z.object({
  ids: z.array(idSchema).min(1).max(MAX_BULK_IDS),
  categoryId: idSchema,
});
export type BulkCategoryRequest = z.infer<typeof bulkCategoryRequestSchema>;

export const bulkCategoryResponseSchema = z.object({
  updated: z.number().int(),
  /** Split transactions, missing ids and rows already in that category. */
  skipped: z.number().int(),
  undoToken: z.string().nullable(),
});

// ---------------------------------------------------------------------------- inbox

export const inboxQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const inboxResponseSchema = z.object({
  transactions: z.array(transactionDtoSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
  /** Most likely categories per transaction id, best first. */
  suggestions: z.record(z.string(), z.array(z.string())),
});
export type InboxResponse = z.infer<typeof inboxResponseSchema>;

export const inboxCountResponseSchema = z.object({
  count: z.number().int(),
  /** Transactions in "Needs review" (from forwarded e-mail alerts). */
  review: z.number().int().default(0),
});

// ---------------------------------------------------------------------------- re-run categorization

export const categorizationRunRequestSchema = z.object({
  /** `uncategorized`: only rows still Uncategorized. `all`: every auto-categorized row (manual never). */
  scope: z.enum(['uncategorized', 'all']).default('uncategorized'),
  cursor: z.string().max(64).optional(),
  /** Pass back the batchId from the first chunk so the whole run is one undo. */
  batchId: idSchema.optional(),
});
export type CategorizationRunRequest = z.input<typeof categorizationRunRequestSchema>;

export const categorizationRunResponseSchema = z.object({
  processed: z.number().int(),
  changed: z.number().int(),
  nextCursor: z.string().nullable(),
  batchId: z.string(),
});
export type CategorizationRunResponse = z.infer<typeof categorizationRunResponseSchema>;

// ---------------------------------------------------------------------------- rules

export const MAX_RULE_TAGS = 5;

export const ruleCreateSchema = z.object({
  name: nameSchema,
  conditions: ruleConditionsSchema,
  categoryId: idSchema,
  setTags: z.array(tagNameSchema).max(MAX_RULE_TAGS).default([]),
  setNote: noteSchema.nullable().default(null),
  enabled: z.boolean().default(true),
});
export type RuleCreate = z.input<typeof ruleCreateSchema>;

export const ruleUpdateSchema = z
  .object({
    name: nameSchema,
    conditions: ruleConditionsSchema,
    categoryId: idSchema,
    setTags: z.array(tagNameSchema).max(MAX_RULE_TAGS),
    setNote: noteSchema.nullable(),
    enabled: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type RuleUpdate = z.input<typeof ruleUpdateSchema>;

export const ruleDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  priority: z.number().int(),
  enabled: z.boolean(),
  conditions: ruleConditionsSchema,
  categoryId: z.string(),
  setTags: z.array(z.string()),
  setNote: z.string().nullable(),
  hitCount: z.number().int(),
  lastHitAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});
export type RuleDto = z.infer<typeof ruleDtoSchema>;

export const ruleListResponseSchema = z.object({ rules: z.array(ruleDtoSchema) });
export const ruleResponseSchema = z.object({ rule: ruleDtoSchema });

export const ruleReorderSchema = z.object({ ids: z.array(idSchema).min(1).max(500) });

export const ruleTestRequestSchema = z.object({ conditions: ruleConditionsSchema });
export const RULE_TEST_SCAN_LIMIT = 5000;
export const ruleTestResponseSchema = z.object({
  /** Transactions examined (most recent first, capped at RULE_TEST_SCAN_LIMIT). */
  scanned: z.number().int(),
  matched: z.number().int(),
  /** Matches that are manual overrides and would not change. */
  manual: z.number().int(),
  truncated: z.boolean(),
  sample: z.array(
    z.object({
      id: z.string(),
      txnDate: z.string(),
      amountPaise: z.number().int(),
      direction: directionSchema,
      title: z.string(),
      categoryId: z.string().nullable(),
      categorizedBy: categorizedBySchema,
    }),
  ),
});
export type RuleTestResponse = z.infer<typeof ruleTestResponseSchema>;

export const ruleApplyRequestSchema = z.object({
  cursor: z.string().max(64).optional(),
  batchId: idSchema.optional(),
});

// ---------------------------------------------------------------------------- learned labels

export const learnedLabelDtoSchema = z.object({
  id: z.string(),
  counterparty: z.object({ id: z.string(), name: z.string() }),
  direction: directionSchema.nullable(),
  accountId: z.string().nullable(),
  categoryId: z.string(),
  enabled: z.boolean(),
  hitCount: z.number().int(),
  lastHitAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});
export type LearnedLabelDto = z.infer<typeof learnedLabelDtoSchema>;

export const learnedLabelListResponseSchema = z.object({ labels: z.array(learnedLabelDtoSchema) });
export const learnedLabelUpdateSchema = z
  .object({ categoryId: idSchema, enabled: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export const learnedLabelResponseSchema = z.object({ label: learnedLabelDtoSchema });

// ---------------------------------------------------------------------------- counterparties (payees)

export const counterpartyUpdateSchema = z.object({ displayName: nameSchema });
export const counterpartyMergeSchema = z.object({ targetId: idSchema });
export const counterpartyMergeResponseSchema = z.object({ moved: z.number().int() });
