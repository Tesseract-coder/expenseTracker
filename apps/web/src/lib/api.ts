import type { z } from 'zod';
import { apiErrorSchema } from '@kharcha/shared';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T extends z.ZodType>(
  method: string,
  path: string,
  schema: T | null,
  body?: unknown,
): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw new ApiRequestError(
      res.status,
      parsed.success ? parsed.data.error.code : 'http_error',
      parsed.success ? parsed.data.error.message : `Request failed (${res.status})`,
      parsed.success ? (parsed.data.error.issues ?? []) : [],
    );
  }
  return (schema ? schema.parse(json) : json) as z.infer<T>;
}

/** Typed API calls; responses are validated with the shared Zod schemas. */
export const apiGet = <T extends z.ZodType>(path: string, schema: T) =>
  request('GET', path, schema);
export const apiPost = <T extends z.ZodType>(path: string, body: unknown, schema: T) =>
  request('POST', path, schema, body);
export const apiPatch = <T extends z.ZodType>(path: string, body: unknown, schema: T) =>
  request('PATCH', path, schema, body);
export const apiDelete = <T extends z.ZodType>(path: string, schema: T | null = null) =>
  request('DELETE', path, schema);

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}
