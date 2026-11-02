import { z } from 'zod';
import type { Direction } from '../money/money';
import type { AccountType, Channel } from '../schemas/enums';
import { channelSchema, directionSchema } from '../schemas/enums';
import { idSchema, paiseSchema } from '../schemas/primitives';

export const MAX_RULE_CONDITIONS = 10;
export const MAX_REGEX_LENGTH = 200;
/** Text fed to rule regexes is capped, which bounds the cost of any pattern that slips through. */
export const RULE_TEXT_CAP = 500;

/**
 * Rejects patterns prone to catastrophic backtracking: nested quantifiers such as `(a+)+`,
 * `(a|aa)*`, `(.*)*`, plus backreferences and lookbehinds. Conservative by design; the UI explains
 * the error and suggests `contains` instead.
 */
export function regexIssue(pattern: string): string | null {
  if (pattern.length > MAX_REGEX_LENGTH)
    return `Keep patterns under ${MAX_REGEX_LENGTH} characters`;
  if (/\\[1-9]|\\k</.test(pattern)) return 'Backreferences are not supported';
  if (/\(\?<[=!]/.test(pattern)) return 'Lookbehind is not supported';
  if (hasNestedQuantifier(pattern))
    return 'Nested repetition like (a+)+ can hang; simplify the pattern';
  try {
    new RegExp(pattern, 'i');
  } catch {
    return 'Not a valid regular expression';
  }
  return null;
}

/**
 * Linear scan for a group that contains a quantifier or alternation and is itself followed by
 * `+`, `*` or `{`, e.g. `(a+)+`, `(\\w*)*`, `(a|aa)+`. Escapes and character classes are skipped.
 */
function hasNestedQuantifier(p: string): boolean {
  const stack: boolean[] = []; // per open group: contains a quantifier/alternation?
  let inClass = false;
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === '(') stack.push(false);
    else if (ch === ')') {
      const risky = stack.pop() ?? false;
      const next = p[i + 1];
      if (risky && (next === '+' || next === '*' || next === '{')) return true;
      if (risky && stack.length) stack[stack.length - 1] = true;
    } else if ((ch === '+' || ch === '*' || ch === '{' || ch === '|') && stack.length) {
      stack[stack.length - 1] = true;
    }
  }
  return false;
}

const textValue = z.string().trim().min(1, 'Required').max(MAX_REGEX_LENGTH);

const textCondition = (field: 'narration' | 'counterparty_key' | 'vpa') =>
  z.discriminatedUnion('op', [
    z.object({ field: z.literal(field), op: z.literal('contains'), value: textValue }),
    z.object({ field: z.literal(field), op: z.literal('eq'), value: textValue }),
    z.object({
      field: z.literal(field),
      op: z.literal('regex'),
      value: textValue.superRefine((v, ctx) => {
        const issue = regexIssue(v);
        if (issue) ctx.addIssue({ code: 'custom', message: issue });
      }),
    }),
  ]);

const amountCondition = z.discriminatedUnion('op', [
  z.object({ field: z.literal('amount'), op: z.literal('eq'), value: paiseSchema }),
  z.object({ field: z.literal('amount'), op: z.literal('gte'), value: paiseSchema }),
  z.object({ field: z.literal('amount'), op: z.literal('lte'), value: paiseSchema }),
  z.object({
    field: z.literal('amount'),
    op: z.literal('between'),
    value: z
      .tuple([paiseSchema, paiseSchema])
      .refine(([a, b]) => a <= b, 'Minimum must not exceed maximum'),
  }),
]);

/**
 * One rule condition. Text comparisons are case-insensitive. `narration` is the bank narration
 * (or the note for manual entries); `counterparty_key` is the normalized payee key (VPA or name).
 */
export const ruleConditionSchema = z.union([
  textCondition('narration'),
  textCondition('counterparty_key'),
  textCondition('vpa'),
  amountCondition,
  z.object({ field: z.literal('direction'), op: z.literal('eq'), value: directionSchema }),
  z.object({
    field: z.literal('account_id'),
    op: z.literal('in'),
    value: z.array(idSchema).min(1).max(20),
  }),
  z.object({
    field: z.literal('channel'),
    op: z.literal('in'),
    value: z.array(channelSchema).min(1).max(14),
  }),
]);
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

/** All conditions must hold (AND). */
export const ruleConditionsSchema = z.object({
  all: z.array(ruleConditionSchema).min(1, 'Add at least one condition').max(MAX_RULE_CONDITIONS),
});
export type RuleConditions = z.infer<typeof ruleConditionsSchema>;

/** The transaction facts a rule can look at. */
export interface RuleSubject {
  narration: string | null;
  counterpartyKey: string | null;
  vpa: string | null;
  amountPaise: number;
  direction: Direction;
  accountId: string;
  accountType?: AccountType | null;
  channel: Channel | null;
}

/** A subject with text fields lower-cased once, shared by every rule evaluated against it. */
export interface PreparedSubject extends RuleSubject {
  readonly lower: { narration: string | null; counterpartyKey: string | null; vpa: string | null };
}

export function prepareSubject(s: RuleSubject): PreparedSubject {
  if ('lower' in s) return s as PreparedSubject;
  return {
    ...s,
    lower: {
      narration: s.narration?.toLowerCase() ?? null,
      counterpartyKey: s.counterpartyKey?.toLowerCase() ?? null,
      vpa: s.vpa?.toLowerCase() ?? null,
    },
  };
}

export type RulePredicate = (s: RuleSubject) => boolean;
type TextField = 'narration' | 'counterpartyKey' | 'vpa';

function textPredicate(
  field: TextField,
  op: 'contains' | 'eq' | 'regex',
  value: string,
): (s: PreparedSubject) => boolean {
  const v = value.toLowerCase();
  if (op === 'regex') {
    const re = new RegExp(value, 'i');
    return (s) => {
      const t = s[field];
      return t !== null && re.test(t.slice(0, RULE_TEXT_CAP));
    };
  }
  if (op === 'eq') return (s) => s.lower[field]?.trim() === v;
  return (s) => s.lower[field]?.includes(v) ?? false;
}

function conditionPredicate(c: RuleCondition): (s: PreparedSubject) => boolean {
  switch (c.field) {
    case 'narration':
      return textPredicate('narration', c.op, c.value);
    case 'counterparty_key':
      return textPredicate('counterpartyKey', c.op, c.value);
    case 'vpa':
      return textPredicate('vpa', c.op, c.value);
    case 'amount':
      switch (c.op) {
        case 'eq':
          return (s) => s.amountPaise === c.value;
        case 'gte':
          return (s) => s.amountPaise >= c.value;
        case 'lte':
          return (s) => s.amountPaise <= c.value;
        case 'between':
          return (s) => s.amountPaise >= c.value[0] && s.amountPaise <= c.value[1];
      }
      break;
    case 'direction':
      return (s) => s.direction === c.value;
    case 'account_id': {
      const set = new Set(c.value);
      return (s) => set.has(s.accountId);
    }
    case 'channel': {
      const set = new Set<string>(c.value);
      return (s) => s.channel !== null && set.has(s.channel);
    }
  }
}

/** Compiles conditions once (regexes included) into a single predicate. */
export function compileConditions(conditions: RuleConditions): RulePredicate {
  const preds = conditions.all.map(conditionPredicate);
  return (s) => {
    const prepared = prepareSubject(s);
    return preds.every((p) => p(prepared));
  };
}

/** Parses stored JSON; returns null for anything invalid so one bad row can't break categorization. */
export function parseStoredConditions(json: string): RuleConditions | null {
  try {
    const parsed = ruleConditionsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
