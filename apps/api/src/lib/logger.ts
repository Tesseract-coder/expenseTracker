/**
 * Structured logger with an allow-list of fields. Financial data (narrations, amounts, VPAs,
 * emails) must never be logged — only pass values from the LogFields type.
 */
export interface LogFields {
  requestId?: string;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  code?: string;
  errorName?: string;
  /** Job counters (counts only — never amounts). */
  users?: number;
  series?: number;
  prunedAudit?: number;
  /** Alert ingestion / AI counters. */
  alerts?: number;
  inserted?: number;
  unmatched?: number;
  suggested?: number;
}

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, fields: LogFields): void {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

export const log = {
  info: (msg: string, fields: LogFields = {}) => emit('info', msg, fields),
  warn: (msg: string, fields: LogFields = {}) => emit('warn', msg, fields),
  error: (msg: string, fields: LogFields = {}) => emit('error', msg, fields),
};
