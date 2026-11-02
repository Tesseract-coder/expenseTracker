import { z } from 'zod';
import { directionSchema } from '../schemas/enums';
import {
  idSchema,
  isoDateSchema,
  nameSchema,
  paiseSchema,
  signedPaiseSchema,
} from '../schemas/primitives';
import { columnMappingSchema } from './mapping';

/** Upper bound per import; keeps a preview within Worker CPU/memory budgets on the Free plan. */
export const MAX_IMPORT_ROWS = 3000;
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const IMPORT_FILE_EXTENSIONS = ['csv', 'txt', 'xls', 'xlsx'] as const;

export const parsedRowSchema = z.object({
  txnDate: isoDateSchema,
  valueDate: isoDateSchema.nullable(),
  narration: z.string().max(500),
  refNo: z.string().max(64).nullable(),
  amountPaise: paiseSchema,
  direction: directionSchema,
  balancePaise: signedPaiseSchema.nullable(),
  sourceRow: z.number().int().min(1),
});

export const importPreviewRequestSchema = z.object({
  /** Built-in profile id (e.g. hdfc_savings_v1), a saved profile id, or 'custom'. */
  profileId: z.string().min(1).max(64),
  rows: z.array(parsedRowSchema).min(1, 'No transactions found in this file').max(MAX_IMPORT_ROWS),
  statementFrom: isoDateSchema.nullable(),
  statementTo: isoDateSchema.nullable(),
  closingBalancePaise: signedPaiseSchema.nullable(),
  parseErrors: z.number().int().min(0),
});
export type ImportPreviewRequest = z.infer<typeof importPreviewRequestSchema>;

export const previewRowStatusSchema = z.enum(['new', 'duplicate', 'near_duplicate']);

export const previewRowSchema = parsedRowSchema.extend({
  index: z.number().int(),
  status: previewRowStatusSchema,
  match: z
    .object({
      txnId: z.string(),
      txnDate: z.string(),
      amountPaise: z.number().int(),
      narration: z.string().nullable(),
      reason: z.enum(['same_ref', 'similar_narration', 'no_narration']),
    })
    .nullable(),
  transfer: z
    .object({
      kind: z.enum(['self_transfer', 'cc_bill_payment', 'atm_cash']),
      confidence: z.enum(['high', 'medium']),
      reason: z.string(),
      counterpartTxnId: z.string().nullable(),
      counterpartAccountId: z.string().nullable(),
    })
    .nullable(),
  /** Normalized payee (Phase 3). */
  payee: z.string().nullable().default(null),
  /** Category the engine would assign if no transfer is accepted. */
  proposal: z
    .object({
      categoryId: z.string(),
      categorizedBy: z.enum(['rule', 'learned', 'keyword']),
      reason: z.string(),
      confidence: z.number(),
    })
    .nullable()
    .default(null),
});
export type PreviewRow = z.infer<typeof previewRowSchema>;

export const importPreviewResponseSchema = z.object({
  importId: z.string(),
  rows: z.array(previewRowSchema),
  summary: z.object({
    total: z.number().int(),
    new: z.number().int(),
    duplicate: z.number().int(),
    nearDuplicate: z.number().int(),
    transfers: z.number().int(),
  }),
  reconciliation: z
    .object({
      statementClosingPaise: z.number().int(),
      projectedBalancePaise: z.number().int(),
      matches: z.boolean(),
    })
    .nullable(),
});
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;

export const importCommitRequestSchema = z.object({
  /** Row indices of near-duplicates the user chose to import anyway (default: skipped). */
  includeNearDuplicates: z.array(z.number().int().min(0)).max(MAX_IMPORT_ROWS).default([]),
  /** Row indices whose transfer suggestion was accepted. */
  acceptTransfers: z.array(z.number().int().min(0)).max(MAX_IMPORT_ROWS).default([]),
});
export type ImportCommitRequest = z.input<typeof importCommitRequestSchema>;

export const importCommitResponseSchema = z.object({
  inserted: z.number().int(),
  skippedDuplicates: z.number().int(),
  transfersLinked: z.number().int(),
  /** Inserted rows the engine categorized (rule / learned / keyword). */
  categorized: z.number().int(),
});

export const importUploadResponseSchema = z.object({
  importId: z.string(),
  duplicateOf: z
    .object({
      importId: z.string(),
      fileName: z.string().nullable(),
      committedAt: z.number().nullable(),
    })
    .nullable(),
});

export const importDtoSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  fileName: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  parserProfileId: z.string().nullable(),
  status: z.enum(['uploaded', 'previewed', 'committing', 'committed', 'failed', 'reverted']),
  rowsParsed: z.number().int(),
  rowsNew: z.number().int(),
  rowsDuplicate: z.number().int(),
  rowsNearDuplicate: z.number().int(),
  rowsFailed: z.number().int(),
  statementFrom: z.string().nullable(),
  statementTo: z.string().nullable(),
  createdAt: z.number().int(),
  committedAt: z.number().int().nullable(),
});
export type ImportDto = z.infer<typeof importDtoSchema>;
export const importListResponseSchema = z.object({ imports: z.array(importDtoSchema) });
export const importRevertResponseSchema = z.object({ deleted: z.number().int() });

export const parserProfileCreateSchema = z.object({
  name: nameSchema,
  mapping: columnMappingSchema,
  /** Remember this mapping for the account's future imports. */
  accountId: idSchema.nullable().default(null),
});
export const parserProfileDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  mapping: columnMappingSchema,
});
export const parserProfileListResponseSchema = z.object({
  profiles: z.array(parserProfileDtoSchema),
});
export const parserProfileResponseSchema = z.object({ profile: parserProfileDtoSchema });
export type ParserProfileDto = z.infer<typeof parserProfileDtoSchema>;
