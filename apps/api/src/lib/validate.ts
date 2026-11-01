import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';
import { ApiException } from './errors';

export class ValidationException extends ApiException {
  constructor(readonly issues: { path: string; message: string }[]) {
    super(400, 'validation_error', issues[0]?.message ?? 'Invalid request');
  }
}

/** zValidator that reports failures in the app's error shape (code=validation_error + issues). */
export const zv = <T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ValidationException(
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
  });
