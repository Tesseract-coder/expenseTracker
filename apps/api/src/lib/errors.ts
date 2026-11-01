import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiException extends HTTPException {
  constructor(
    status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(status, { message });
  }
}

export const unauthorized = (message = 'Authentication required') =>
  new ApiException(401, 'unauthorized', message);
export const forbidden = (message = 'Not allowed') => new ApiException(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new ApiException(404, 'not_found', message);
