import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ApiError } from '@kharcha/shared';
import type { AppEnv } from '../env';
import { ApiException } from '../lib/errors';
import { ValidationException } from '../lib/validate';
import { log } from '../lib/logger';

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get('requestId');
  if (err instanceof ValidationException) {
    return c.json<ApiError>(
      { error: { code: err.code, message: err.message, requestId, issues: err.issues } },
      400,
    );
  }
  if (err instanceof ApiException) {
    return c.json<ApiError>(
      { error: { code: err.code, message: err.message, requestId } },
      err.status,
    );
  }
  if (err instanceof HTTPException) {
    return c.json<ApiError>(
      { error: { code: 'http_error', message: err.message, requestId } },
      err.status,
    );
  }
  log.error('unhandled', { requestId, errorName: err.name });
  return c.json<ApiError>(
    { error: { code: 'internal', message: 'Something went wrong', requestId } },
    500,
  );
};
