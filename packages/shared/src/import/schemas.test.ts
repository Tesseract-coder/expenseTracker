import { describe, expect, it } from 'vitest';
import {
  importCommitRequestSchema,
  importPreviewRequestSchema,
  MAX_IMPORT_ROWS,
  parserProfileCreateSchema,
} from './schemas';

const row = {
  txnDate: '2026-10-01',
  valueDate: null,
  narration: 'X',
  refNo: null,
  amountPaise: 100,
  direction: 'out',
  balancePaise: null,
  sourceRow: 2,
};
const preview = {
  profileId: 'hdfc_savings_v1',
  rows: [row],
  statementFrom: null,
  statementTo: null,
  closingBalancePaise: null,
  parseErrors: 0,
};

describe('import schemas', () => {
  it('bounds preview rows', () => {
    expect(importPreviewRequestSchema.safeParse(preview).success).toBe(true);
    expect(
      importPreviewRequestSchema.safeParse({ ...preview, rows: [] }).error?.issues[0]?.message,
    ).toBe('No transactions found in this file');
    expect(
      importPreviewRequestSchema.safeParse({
        ...preview,
        rows: Array(MAX_IMPORT_ROWS + 1).fill(row),
      }).success,
    ).toBe(false);
    expect(
      importPreviewRequestSchema.safeParse({ ...preview, rows: [{ ...row, amountPaise: 0 }] })
        .success,
    ).toBe(false);
  });

  it('defaults commit decisions', () => {
    expect(importCommitRequestSchema.parse({})).toEqual({
      includeNearDuplicates: [],
      acceptTransfers: [],
    });
  });

  it('validates saved mappings', () => {
    const mapping = {
      headerRow: 0,
      dateCol: 0,
      valueDateCol: null,
      narrationCols: [1],
      refCol: null,
      balanceCol: null,
      amount: { kind: 'amount_with_type', amountCol: 2, typeCol: null, defaultDirection: 'out' },
      dateOrder: 'dmy',
    };
    expect(parserProfileCreateSchema.parse({ name: 'My bank', mapping }).accountId).toBeNull();
    expect(
      parserProfileCreateSchema.safeParse({
        name: 'x',
        mapping: { ...mapping, amount: { kind: 'magic' } },
      }).success,
    ).toBe(false);
  });
});
