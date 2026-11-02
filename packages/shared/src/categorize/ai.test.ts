import { describe, expect, it } from 'vitest';
import {
  AI_MIN_CONFIDENCE,
  type AiCategory,
  type AiTransaction,
  buildAiMessages,
  parseAiResponse,
} from './ai';

const CATS: AiCategory[] = [
  { id: 'c-delivery', name: 'Food delivery', groupName: 'Lifestyle', type: 'expense_want' },
  { id: 'c-salary', name: 'Salary', groupName: 'Income', type: 'income' },
  { id: 'c-ott', name: 'Entertainment & OTT', groupName: 'Lifestyle', type: 'expense_want' },
];
const TXNS: AiTransaction[] = [
  {
    id: 'a',
    direction: 'out',
    amountPaise: 64950,
    channel: 'upi',
    payee: 'Netflix',
    vpa: 'netflix@hdfc',
    narration: 'UPI/DR/1|2\n/NETFLIX',
  },
  {
    id: 'b',
    direction: 'in',
    amountPaise: 8500000,
    channel: 'neft',
    payee: null,
    vpa: null,
    narration: null,
  },
];

describe('buildAiMessages', () => {
  it('numbers categories and transactions and sanitizes fields', () => {
    const [system, user] = buildAiMessages(CATS, TXNS);
    expect(system?.role).toBe('system');
    expect(user?.content).toContain('1. Lifestyle > Food delivery [want]');
    expect(user?.content).toContain('2. Income > Salary [income]');
    expect(user?.content).toContain(
      't1 | money out | Rs 650 | upi | payee: Netflix | upi: netflix@hdfc | narration: UPI/DR/1 2 /NETFLIX',
    );
    expect(user?.content).toContain(
      't2 | money in | Rs 85000 | neft | payee: - | upi: - | narration: -',
    );
  });
});

describe('parseAiResponse', () => {
  it.each([
    [
      'object response',
      { results: [{ t: 't1', c: 3, confidence: 0.93 }] },
      [{ transactionId: 'a', categoryId: 'c-ott', confidence: 0.93 }],
    ],
    [
      'string with code fence',
      '```json\n{"results":[{"t":"t2","c":2,"confidence":0.8}]}\n```',
      [{ transactionId: 'b', categoryId: 'c-salary', confidence: 0.8 }],
    ],
    [
      'numeric t and string c',
      { results: [{ t: 1, c: '1', confidence: '0.7' }] },
      [{ transactionId: 'a', categoryId: 'c-delivery', confidence: 0.7 }],
    ],
    ['income for money out is dropped', { results: [{ t: 't1', c: 2, confidence: 0.99 }] }, []],
    [
      'unknown category / 0 / unknown txn dropped',
      {
        results: [
          { t: 't1', c: 0, confidence: 1 },
          { t: 't1', c: 9, confidence: 1 },
          { t: 't7', c: 1, confidence: 1 },
        ],
      },
      [],
    ],
    [
      'low confidence dropped',
      { results: [{ t: 't1', c: 3, confidence: AI_MIN_CONFIDENCE - 0.01 }] },
      [],
    ],
    [
      'confidence clamped, first answer wins',
      {
        results: [
          { t: 't1', c: 3, confidence: 7 },
          { t: 't1', c: 1, confidence: 1 },
        ],
      },
      [{ transactionId: 'a', categoryId: 'c-ott', confidence: 1 }],
    ],
    ['garbage', 'I think it is food', []],
    ['broken json', '{"results": [', []],
    ['wrong shape', { results: 'nope' }, []],
  ])('%s', (_n, raw, expected) => {
    expect(parseAiResponse(raw, CATS, TXNS)).toEqual(expected);
  });
});
