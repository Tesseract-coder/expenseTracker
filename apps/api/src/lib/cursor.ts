import { ApiException } from './errors';

/** Keyset cursor for (txn_date DESC, created_at DESC, id DESC). Opaque base64url JSON. */
export interface TxnCursor {
  txnDate: string;
  createdAt: number;
  id: string;
}

export function encodeCursor(c: TxnCursor): string {
  return btoa(JSON.stringify([c.txnDate, c.createdAt, c.id]))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function decodeCursor(raw: string): TxnCursor {
  try {
    const json = atob(raw.replaceAll('-', '+').replaceAll('_', '/'));
    const v: unknown = JSON.parse(json);
    if (
      Array.isArray(v) &&
      v.length === 3 &&
      typeof v[0] === 'string' &&
      typeof v[1] === 'number' &&
      typeof v[2] === 'string'
    ) {
      return { txnDate: v[0], createdAt: v[1], id: v[2] };
    }
  } catch {
    // fall through
  }
  throw new ApiException(400, 'invalid_cursor', 'Invalid pagination cursor');
}
