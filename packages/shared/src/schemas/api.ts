import { z } from 'zod';

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    /** Field-level validation issues (code = validation_error). */
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
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
