import { z } from 'zod';
import { idSchema } from '../schemas/primitives';
import {
  importCommitRequestSchema,
  importCommitResponseSchema,
  importPreviewResponseSchema,
  parsedRowSchema,
} from '../import/schemas';
import { MAX_ALERTS } from './parse';

/** Alerts after the user assigned each one to an account (paste flow). */
export const alertsPreviewRequestSchema = z.object({
  rows: z
    .array(parsedRowSchema.extend({ accountId: idSchema }))
    .min(1, 'No transactions to check')
    .max(MAX_ALERTS),
});
export type AlertsPreviewRequest = z.infer<typeof alertsPreviewRequestSchema>;

/** One import per account, each with the regular statement-import preview. */
export const alertsPreviewResponseSchema = z.object({
  groups: z.array(
    z.object({
      accountId: z.string(),
      importId: z.string(),
      preview: importPreviewResponseSchema,
    }),
  ),
});
export type AlertsPreviewResponse = z.infer<typeof alertsPreviewResponseSchema>;

export const alertsCommitRequestSchema = z.object({
  groups: z
    .array(importCommitRequestSchema.extend({ importId: idSchema }))
    .min(1)
    .max(MAX_ALERTS),
});
export type AlertsCommitRequest = z.input<typeof alertsCommitRequestSchema>;

export const alertsCommitResponseSchema = importCommitResponseSchema.extend({
  importIds: z.array(z.string()),
});
