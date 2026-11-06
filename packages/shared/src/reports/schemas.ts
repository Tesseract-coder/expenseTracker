import { z } from 'zod';
import { diffDays } from '../dates';
import { directionSchema } from '../schemas/enums';
import { idSchema, isoDateSchema, paiseSchema } from '../schemas/primitives';
import { DEFAULT_TARGETS } from './health';

/** Longest range any report accepts (5 years) — keeps SQL scans and payloads bounded. */
export const MAX_REPORT_DAYS = 366 * 5;

const idList = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(idSchema).max(50));

const rangeRefine = <T extends { from: string; to: string }>(v: T, ctx: z.RefinementCtx) => {
  if (v.from > v.to)
    ctx.addIssue({ code: 'custom', message: '"from" must not be after "to"', path: ['from'] });
  else if (diffDays(v.from, v.to) > MAX_REPORT_DAYS)
    ctx.addIssue({ code: 'custom', message: 'Choose a range of at most 5 years', path: ['to'] });
};

export const YEAR_MODES = ['calendar', 'fy'] as const;
export const yearModeSchema = z.enum(YEAR_MODES);

/** Common report filters (query string). Transfers are always excluded from totals. */
export const reportQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    accountIds: idList.optional(),
    /** Comparison period (usually the previous one), for deltas. */
    compareFrom: isoDateSchema.optional(),
    compareTo: isoDateSchema.optional(),
  })
  .superRefine(rangeRefine);
export type ReportQuery = z.input<typeof reportQuerySchema>;

export const totalsSchema = z.object({
  income: z.number().int(),
  /** Needs + wants + uncategorized outflow, net of refunds. */
  spend: z.number().int(),
  needs: z.number().int(),
  wants: z.number().int(),
  unclassified: z.number().int(),
  invested: z.number().int(),
  netSavings: z.number().int(),
  savingsRate: z.number().nullable(),
  /** Uncategorized inflow: excluded from income until labelled. */
  uncategorizedIncome: z.number().int(),
});
export type Totals = z.infer<typeof totalsSchema>;

export const trendGranularitySchema = z.enum(['day', 'week', 'month']);

export const summaryResponseSchema = z.object({
  totals: totalsSchema,
  previous: totalsSchema.nullable(),
  byGroup: z.array(z.object({ groupId: z.string(), spend: z.number().int() })),
  byCategory: z.array(
    z.object({
      categoryId: z.string(),
      groupId: z.string(),
      spend: z.number().int(),
      previous: z.number().int(),
    }),
  ),
  trend: z.object({
    granularity: trendGranularitySchema,
    points: z.array(z.object({ bucket: z.string(), spend: z.number().int() })),
  }),
});
export type SummaryResponse = z.infer<typeof summaryResponseSchema>;

export const trendsQuerySchema = z
  .object({
    granularity: z.enum(['week', 'month', 'year']).default('month'),
    from: isoDateSchema,
    to: isoDateSchema,
    accountIds: idList.optional(),
    yearMode: yearModeSchema.default('calendar'),
  })
  .superRefine(rangeRefine);
export type TrendsQuery = z.input<typeof trendsQuerySchema>;

export const trendsResponseSchema = z.object({
  granularity: z.enum(['week', 'month', 'year']),
  buckets: z.array(
    z.object({
      bucket: z.string(),
      income: z.number().int(),
      spend: z.number().int(),
      invested: z.number().int(),
    }),
  ),
  categories: z.array(
    z.object({ bucket: z.string(), categoryId: z.string(), spend: z.number().int() }),
  ),
});
export type TrendsResponse = z.infer<typeof trendsResponseSchema>;

export const txnLiteSchema = z.object({
  id: z.string(),
  txnDate: z.string(),
  title: z.string(),
  amountPaise: z.number().int(),
  direction: directionSchema,
  categoryId: z.string().nullable(),
});
export type TxnLite = z.infer<typeof txnLiteSchema>;

export const whenResponseSchema = z.object({
  daily: z.array(z.object({ date: z.string(), spend: z.number().int() })),
  byDow: z.array(
    z.object({ dow: z.number().int(), spend: z.number().int(), average: z.number().int() }),
  ),
  byWeekOfMonth: z.array(z.object({ week: z.number().int(), spend: z.number().int() })),
  topDays: z.array(
    z.object({ date: z.string(), spend: z.number().int(), top: z.array(txnLiteSchema) }),
  ),
  topWeeks: z.array(z.object({ weekStart: z.string(), spend: z.number().int() })),
  topMonths: z.array(z.object({ month: z.string(), spend: z.number().int() })),
});
export type WhenResponse = z.infer<typeof whenResponseSchema>;

export const whereResponseSchema = z.object({
  topCategories: z.array(
    z.object({ categoryId: z.string(), spend: z.number().int(), count: z.number().int() }),
  ),
  topCounterparties: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      spend: z.number().int(),
      count: z.number().int(),
    }),
  ),
  topTransactions: z.array(txnLiteSchema),
  changes: z.array(
    z.object({
      categoryId: z.string(),
      current: z.number().int(),
      previous: z.number().int(),
      delta: z.number().int(),
      pct: z.number().nullable(),
    }),
  ),
});
export type WhereResponse = z.infer<typeof whereResponseSchema>;

// ---------------------------------------------------------------------------- recurring

export const recurringDtoSchema = z.object({
  id: z.string(),
  counterparty: z.object({ id: z.string(), name: z.string() }),
  categoryId: z.string().nullable(),
  cadence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  typicalAmountPaise: z.number().int(),
  lastAmountPaise: z.number().int().nullable(),
  lastDate: z.string(),
  nextExpectedDate: z.string().nullable(),
  occurrences: z.number().int(),
  status: z.enum(['active', 'new', 'price_changed', 'stopped']),
  dismissed: z.boolean(),
});
export type RecurringDto = z.infer<typeof recurringDtoSchema>;
export const recurringListResponseSchema = z.object({
  series: z.array(recurringDtoSchema),
  /** Estimated monthly cost of active subscriptions/bills. */
  monthlyTotalPaise: z.number().int(),
});
export const recurringUpdateSchema = z.object({ dismissed: z.boolean() });

// ---------------------------------------------------------------------------- budgets

export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const budgetUpsertSchema = z.object({
  categoryId: idSchema,
  /** null = default for every month; 'YYYY-MM' = this month only (overrides the default). */
  month: monthKeySchema.nullable().default(null),
  amountPaise: paiseSchema,
});
export type BudgetUpsert = z.input<typeof budgetUpsertSchema>;

export const budgetDtoSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  month: z.string().nullable(),
  amountPaise: z.number().int(),
  spentPaise: z.number().int(),
  pct: z.number(),
  projectedPaise: z.number().int(),
  remainingPaise: z.number().int(),
  state: z.enum(['ok', 'warning', 'over']),
  projectedState: z.enum(['ok', 'warning', 'over']),
});
export type BudgetDto = z.infer<typeof budgetDtoSchema>;
export const budgetListResponseSchema = z.object({
  month: z.string(),
  budgets: z.array(budgetDtoSchema),
  totals: z.object({ budgetedPaise: z.number().int(), spentPaise: z.number().int() }),
});
export type BudgetListResponse = z.infer<typeof budgetListResponseSchema>;

// ---------------------------------------------------------------------------- settings

const ratio = z.number().min(0).max(1);
export const targetsSchema = z.object({
  savingsRate: ratio,
  investmentRate: ratio,
  needs: ratio,
  wants: ratio,
  savings: ratio,
  emergencyMonths: z.number().int().min(1).max(36),
});

export const settingsDtoSchema = z.object({
  yearMode: yearModeSchema,
  targets: targetsSchema,
  emergencyFundPaise: z.number().int().min(0).nullable(),
  /** Apply AI suggestions at or above AI_AUTO_APPLY_MIN confidence (only when AI is enabled). */
  aiAutoApply: z.boolean().default(false),
});
export type SettingsDto = z.infer<typeof settingsDtoSchema>;

export const settingsPatchSchema = z
  .object({
    yearMode: yearModeSchema,
    targets: targetsSchema.partial(),
    emergencyFundPaise: z.number().int().min(0).max(1_000_00_00_000_00).nullable(),
    aiAutoApply: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type SettingsPatch = z.input<typeof settingsPatchSchema>;

export const DEFAULT_SETTINGS_DTO: SettingsDto = {
  yearMode: 'calendar',
  targets: DEFAULT_TARGETS,
  emergencyFundPaise: null,
  aiAutoApply: false,
};

// ---------------------------------------------------------------------------- health

export const healthScoreQuerySchema = z.object({
  period: z.enum(['month', 'year']).default('month'),
  date: isoDateSchema,
  accountIds: idList.optional(),
});

const healthComponentSchema = z.object({
  key: z.enum([
    'savings_rate',
    'investment_rate',
    'split',
    'budget_adherence',
    'spending_trend',
    'lifestyle_creep',
    'emergency_fund',
  ]),
  label: z.string(),
  value: z.string(),
  target: z.string(),
  score: z.number().nullable(),
  weight: z.number(),
  status: z.enum(['good', 'warning', 'serious', 'critical', 'na']),
  verdict: z.string(),
});

export const healthScoreResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  score: z.number().nullable(),
  band: z.enum(['excellent', 'good', 'needs_attention', 'off_track']).nullable(),
  components: z.array(healthComponentSchema),
  drivers: z.array(
    z.object({ key: z.string(), impact: z.enum(['positive', 'negative']), text: z.string() }),
  ),
  suggestions: z.array(z.string()),
  totals: z.object({
    income: z.number().int(),
    spend: z.number().int(),
    needs: z.number().int(),
    wants: z.number().int(),
    invested: z.number().int(),
    savings: z.number().int(),
  }),
  history: z.array(
    z.object({
      month: z.string(),
      income: z.number().int(),
      needs: z.number().int(),
      wants: z.number().int(),
      unclassified: z.number().int(),
      invested: z.number().int(),
    }),
  ),
});
export type HealthScoreResponse = z.infer<typeof healthScoreResponseSchema>;

// ---------------------------------------------------------------------------- export

export const MAX_EXPORT_ROWS = 20_000;
/** Rows per export request: one big page would exceed the Workers Free CPU budget (JSON). */
export const EXPORT_PAGE_ROWS = 2_500;

export const exportRowSchema = z.object({
  date: z.string(),
  account: z.string(),
  payee: z.string().nullable(),
  narration: z.string().nullable(),
  category: z.string(),
  group: z.string().nullable(),
  type: z.string(),
  direction: directionSchema,
  amountPaise: z.number().int(),
  tags: z.string(),
  note: z.string().nullable(),
});
export type ExportRow = z.infer<typeof exportRowSchema>;

export const exportResponseSchema = z.object({
  rows: z.array(exportRowSchema),
  truncated: z.boolean(),
  /** Offset of the next page (pass as `offset`), or null on the last page. */
  next: z.number().int().nullable().default(null),
  byCounterparty: z.array(
    z.object({ name: z.string(), spend: z.number().int(), count: z.number().int() }),
  ),
});
export type ExportResponse = z.infer<typeof exportResponseSchema>;
