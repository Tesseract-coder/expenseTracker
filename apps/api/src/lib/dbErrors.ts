import { ApiException } from './errors';

/** D1 surfaces SQLite constraint failures as Error messages; map the ones users can trigger. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(errorChain(err));
}

function errorChain(err: Error): string {
  let msg = err.message;
  let cause = err.cause;
  while (cause instanceof Error) {
    msg += ` | ${cause.message}`;
    cause = cause.cause;
  }
  return msg;
}

export async function withUniqueAsConflict<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiException(409, 'conflict', message);
    throw err;
  }
}
