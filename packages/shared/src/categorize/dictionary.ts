import { z } from 'zod';
import { accountTypeSchema, channelSchema, directionSchema } from '../schemas/enums';
import type { Direction } from '../money/money';
import type { AccountType, Channel } from '../schemas/enums';
import rawDictionary from './dictionary.json';
import { keywordWords } from './normalize';

/** Shape of `dictionary.json` (versioned data, not code). Validated at load and in tests. */
export const keywordDictionarySchema = z.object({
  version: z.number().int().positive(),
  notes: z.string().optional(),
  entries: z
    .array(
      z
        .object({
          category: z.string().regex(/^[a-z0-9_]+$/),
          keywords: z.array(z.string().min(2).max(60)).optional(),
          channels: z.array(channelSchema).optional(),
          direction: directionSchema.optional(),
          accountTypes: z.array(accountTypeSchema).optional(),
          confidence: z.number().min(0).max(1).optional(),
        })
        .refine((e) => (e.keywords?.length ?? 0) > 0 || (e.channels?.length ?? 0) > 0, {
          message: 'An entry needs keywords or channels',
        }),
    )
    .min(1),
});
export type KeywordDictionary = z.infer<typeof keywordDictionarySchema>;

export interface KeywordMatchInput {
  words: readonly string[];
  direction: Direction;
  channel: Channel | null;
  accountType: AccountType | null;
}

export interface KeywordMatch {
  /** Category slug. */
  category: string;
  /** The matched keyword, or `channel:<name>` for channel fallbacks. */
  keyword: string;
  confidence: number;
}

interface CompiledEntry {
  category: string;
  direction?: Direction;
  accountTypes?: ReadonlySet<AccountType>;
  channels?: ReadonlySet<Channel>;
  confidence: number;
  order: number;
}
interface CompiledKeyword {
  words: string[];
  keyword: string;
  score: number; // word count * 1000 + characters: longer, more specific keywords win
  entry: CompiledEntry;
}

export interface CompiledDictionary {
  version: number;
  match(input: KeywordMatchInput): KeywordMatch | null;
}

const DEFAULT_CONFIDENCE = 0.8;

const allowed = (e: CompiledEntry, input: KeywordMatchInput) =>
  (!e.direction || e.direction === input.direction) &&
  (!e.accountTypes || (input.accountType !== null && e.accountTypes.has(input.accountType)));

/**
 * Indexes keywords by their first word so a row costs O(words), not O(keywords).
 * Longest keyword wins (word count, then length); ties go to the earlier entry.
 */
export function compileDictionary(dict: KeywordDictionary): CompiledDictionary {
  const index = new Map<string, CompiledKeyword[]>();
  const channelEntries: CompiledEntry[] = [];
  dict.entries.forEach((e, order) => {
    const entry: CompiledEntry = {
      category: e.category,
      direction: e.direction,
      accountTypes: e.accountTypes ? new Set(e.accountTypes) : undefined,
      channels: e.channels ? new Set(e.channels) : undefined,
      confidence: e.confidence ?? DEFAULT_CONFIDENCE,
      order,
    };
    if (!e.keywords?.length) {
      channelEntries.push(entry);
      return;
    }
    for (const keyword of e.keywords) {
      const words = keywordWords(keyword);
      const first = words[0];
      if (!first) continue;
      const list = index.get(first) ?? [];
      list.push({ words, keyword, score: words.length * 1000 + words.join(' ').length, entry });
      index.set(first, list);
    }
  });

  return {
    version: dict.version,
    match(input) {
      const { words } = input;
      let best: CompiledKeyword | null = null;
      for (let i = 0; i < words.length; i++) {
        const candidates = index.get(words[i] as string);
        if (!candidates) continue;
        for (const c of candidates) {
          if (
            best &&
            (c.score < best.score || (c.score === best.score && c.entry.order >= best.entry.order))
          )
            continue;
          let ok = i + c.words.length <= words.length;
          for (let k = 1; ok && k < c.words.length; k++) ok = words[i + k] === c.words[k];
          if (ok && allowed(c.entry, input)) best = c;
        }
      }
      if (best) {
        return {
          category: best.entry.category,
          keyword: best.keyword,
          confidence: best.entry.confidence,
        };
      }
      if (input.channel) {
        const fallback = channelEntries.find(
          (e) => e.channels?.has(input.channel as Channel) && allowed(e, input),
        );
        if (fallback) {
          return {
            category: fallback.category,
            keyword: `channel:${input.channel}`,
            confidence: fallback.confidence,
          };
        }
      }
      return null;
    },
  };
}

export const KEYWORD_DICTIONARY: KeywordDictionary = keywordDictionarySchema.parse(rawDictionary);

let compiled: CompiledDictionary | null = null;
/** The built-in dictionary, compiled once per isolate. */
export function builtinDictionary(): CompiledDictionary {
  compiled ??= compileDictionary(KEYWORD_DICTIONARY);
  return compiled;
}
