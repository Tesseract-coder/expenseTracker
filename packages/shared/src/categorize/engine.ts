import type { Direction } from '../money/money';
import type { AccountType, Channel } from '../schemas/enums';
import { builtinDictionary, type CompiledDictionary } from './dictionary';
import { keywordWords } from './normalize';
import { prepareSubject, type RulePredicate, type RuleSubject } from './rules';

/**
 * Categorization pipeline (spec §6.2): first match wins and records why.
 *
 *   manual override (caller skips these) → user rules (priority asc) → learned labels
 *   → keyword dictionary → (AI suggestion, Phase 5) → null = Uncategorized
 */
export interface CategorizeInput extends RuleSubject {
  accountType: AccountType | null;
  /** Effective counterparty id (after merges), used for learned labels. */
  counterpartyId: string | null;
  /** Extra text for keyword matching, e.g. the payee name and note of a manual entry. */
  extraText?: string | null;
}

export interface CompiledRuleRef {
  id: string;
  name: string;
  categoryId: string;
  setTagIds: string[];
  setNote: string | null;
  test: RulePredicate;
}

export interface LearnedLabelRef {
  id: string;
  counterpartyId: string;
  direction: Direction | null;
  accountId: string | null;
  categoryId: string;
}

export interface CategorizeContext {
  /** Enabled rules, sorted by priority ascending. */
  rules: readonly CompiledRuleRef[];
  /** Enabled learned labels grouped by counterparty id. */
  learned: ReadonlyMap<string, readonly LearnedLabelRef[]>;
  dictionary?: CompiledDictionary;
  /** Resolves a seed slug to the user's active category id (undefined if archived/missing). */
  categoryIdBySlug: (slug: string) => string | undefined;
}

export type AutoCategorizedBy = 'rule' | 'learned' | 'keyword';

export interface CategorizeResult {
  categoryId: string;
  categorizedBy: AutoCategorizedBy;
  ruleId: string | null;
  learnedLabelId: string | null;
  confidence: number;
  /** Machine-readable why: `rule:<name>`, `learned:<counterparty key>`, `keyword:<kw>`, `keyword:channel:atm`. */
  reason: string;
  setTagIds: string[];
  setNote: string | null;
}

const LEARNED_CONFIDENCE = 0.95;

/** Most specific label wins: account + direction, then account, then direction, then any. */
export function pickLearnedLabel(
  labels: readonly LearnedLabelRef[] | undefined,
  direction: Direction,
  accountId: string,
): LearnedLabelRef | null {
  if (!labels) return null;
  let best: LearnedLabelRef | null = null;
  let bestScore = -1;
  for (const l of labels) {
    if (l.direction !== null && l.direction !== direction) continue;
    if (l.accountId !== null && l.accountId !== accountId) continue;
    const score = (l.accountId ? 2 : 0) + (l.direction ? 1 : 0);
    if (score > bestScore) {
      best = l;
      bestScore = score;
    }
  }
  return best;
}

export function categorize(
  input: CategorizeInput,
  ctx: CategorizeContext,
): CategorizeResult | null {
  const subject = ctx.rules.length ? prepareSubject(input) : input;
  for (const rule of ctx.rules) {
    if (rule.test(subject)) {
      return {
        categoryId: rule.categoryId,
        categorizedBy: 'rule',
        ruleId: rule.id,
        learnedLabelId: null,
        confidence: 1,
        reason: `rule:${rule.name}`,
        setTagIds: rule.setTagIds,
        setNote: rule.setNote,
      };
    }
  }

  if (input.counterpartyId) {
    const label = pickLearnedLabel(
      ctx.learned.get(input.counterpartyId),
      input.direction,
      input.accountId,
    );
    if (label) {
      return {
        categoryId: label.categoryId,
        categorizedBy: 'learned',
        ruleId: null,
        learnedLabelId: label.id,
        confidence: LEARNED_CONFIDENCE,
        reason: `learned:${input.counterpartyKey ?? input.counterpartyId}`,
        setTagIds: [],
        setNote: null,
      };
    }
  }

  const dictionary = ctx.dictionary ?? builtinDictionary();
  const match = dictionary.match({
    words: keywordWords(input.narration, input.vpa, input.extraText),
    direction: input.direction,
    channel: input.channel as Channel | null,
    accountType: input.accountType,
  });
  if (match) {
    const categoryId = ctx.categoryIdBySlug(match.category);
    if (categoryId) {
      return {
        categoryId,
        categorizedBy: 'keyword',
        ruleId: null,
        learnedLabelId: null,
        confidence: match.confidence,
        reason: `keyword:${match.keyword}`,
        setTagIds: [],
        setNote: null,
      };
    }
  }
  return null;
}
