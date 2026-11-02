/**
 * Workers AI category suggestions (spec §6.2 step 5, flag-gated). Pure prompt building and
 * response validation; the Worker only makes the call. The model picks from a numbered list of
 * your own categories, so it can't invent one, and every answer is checked before it is stored.
 */
import { z } from 'zod';
import { idSchema } from '../schemas/primitives';
import type { CategoryType } from '../schemas/enums';

/** Suggestions below this are dropped as noise. */
export const AI_MIN_CONFIDENCE = 0.4;
/** With "auto-apply" on, suggestions at or above this are applied (marked `ai`, undoable). */
export const AI_AUTO_APPLY_MIN = 0.9;
/** Transactions per request: keeps the prompt small and the call well inside Worker limits. */
export const AI_BATCH = 20;

export interface AiCategory {
  id: string;
  name: string;
  groupName: string;
  type: CategoryType;
}

export interface AiTransaction {
  id: string;
  direction: 'in' | 'out';
  amountPaise: number;
  channel: string | null;
  payee: string | null;
  vpa: string | null;
  narration: string | null;
}

export interface AiSuggestion {
  transactionId: string;
  categoryId: string;
  confidence: number;
}

const TYPE_LABEL: Record<CategoryType, string> = {
  income: 'income',
  expense_need: 'need',
  expense_want: 'want',
  investment: 'investment',
  transfer: 'transfer',
};

const clip = (s: string | null, n: number) => (s ? s.replace(/[\r\n|]+/g, ' ').slice(0, n) : '-');

export function buildAiMessages(categories: AiCategory[], txns: AiTransaction[]) {
  const catLines = categories.map(
    (c, i) => `${i + 1}. ${c.groupName} > ${c.name} [${TYPE_LABEL[c.type]}]`,
  );
  const txnLines = txns.map(
    (t, i) =>
      `t${i + 1} | ${t.direction === 'out' ? 'money out' : 'money in'} | Rs ${Math.round(t.amountPaise / 100)} | ${t.channel ?? '-'} | payee: ${clip(t.payee, 60)} | upi: ${clip(t.vpa, 60)} | narration: ${clip(t.narration, 140)}`,
  );
  return [
    {
      role: 'system' as const,
      content:
        'You categorize personal bank transactions from India. Pick exactly one category number ' +
        'from the list for each transaction, using the payee, UPI handle and narration. Money in ' +
        'is usually income or a refund; never give an income category to money out. If you are ' +
        'not reasonably sure, answer 0. Confidence is your probability (0 to 1) that the category ' +
        'is right. Reply with JSON only.',
    },
    {
      role: 'user' as const,
      content: `Categories:\n${catLines.join('\n')}\n\nTransactions:\n${txnLines.join('\n')}\n\nReply as {"results":[{"t":"t1","c":<category number or 0>,"confidence":<0..1>}]} with one entry per transaction.`,
    },
  ];
}

/** JSON schema for Workers AI JSON mode (`response_format`). */
export const AI_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          t: { type: 'string' },
          c: { type: 'integer' },
          confidence: { type: 'number' },
        },
        required: ['t', 'c', 'confidence'],
      },
    },
  },
  required: ['results'],
} as const;

const responseSchema = z.object({
  results: z
    .array(
      z.object({
        t: z.union([z.string(), z.number()]).transform(String),
        c: z.coerce.number().int(),
        confidence: z.coerce.number(),
      }),
    )
    .max(500),
});

function toJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Validates the model output: known transaction and category numbers only, one answer per
 * transaction, no income category for money out, confidence clamped to 0–1 and ≥ the minimum.
 */
export function parseAiResponse(
  raw: unknown,
  categories: AiCategory[],
  txns: AiTransaction[],
): AiSuggestion[] {
  const parsed = responseSchema.safeParse(toJson(raw));
  if (!parsed.success) return [];
  const out: AiSuggestion[] = [];
  const seen = new Set<string>();
  for (const r of parsed.data.results) {
    const ti = Number(r.t.replace(/^t/i, '')) - 1;
    const txn = txns[ti];
    const cat = categories[r.c - 1];
    if (!txn || !cat || seen.has(txn.id)) continue;
    if (cat.type === 'income' && txn.direction === 'out') continue;
    const confidence = Math.min(1, Math.max(0, Number.isFinite(r.confidence) ? r.confidence : 0));
    if (confidence < AI_MIN_CONFIDENCE) continue;
    seen.add(txn.id);
    out.push({
      transactionId: txn.id,
      categoryId: cat.id,
      confidence: Math.round(confidence * 100) / 100,
    });
  }
  return out;
}

export const aiSuggestRequestSchema = z.object({
  transactionIds: z.array(idSchema).min(1).max(AI_BATCH),
});
export type AiSuggestRequest = z.infer<typeof aiSuggestRequestSchema>;

export const aiSuggestResponseSchema = z.object({
  suggestions: z.array(
    z.object({
      transactionId: z.string(),
      categoryId: z.string(),
      confidence: z.number(),
      applied: z.boolean(),
    }),
  ),
  applied: z.number().int(),
  /** Undo token for auto-applied suggestions (null when nothing was applied). */
  undoToken: z.string().nullable(),
});
export type AiSuggestResponse = z.infer<typeof aiSuggestResponseSchema>;
