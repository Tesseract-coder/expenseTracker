import {
  AI_AUTO_APPLY_MIN,
  AI_RESPONSE_JSON_SCHEMA,
  type AiCategory,
  type AiSuggestResponse,
  type AiTransaction,
  buildAiMessages,
  parseAiResponse,
} from '@kharcha/shared';
import type { Env } from '../env';
import { ApiException } from '../lib/errors';
import { log } from '../lib/logger';
import { newId } from '../lib/ids';
import { AUDIT_FROM_JSON_SQL, type CategoryState } from './categorization';
import { getSettings } from './settings';

/** Small, cheap instruction model with JSON mode; override with the AI_MODEL var. */
export const DEFAULT_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

export const aiEnabled = (env: Env): boolean => env.AI_ENABLED === 'true' && !!env.AI;

interface Row {
  id: string;
  direction: 'in' | 'out';
  amount_paise: number;
  channel: string | null;
  vpa: string | null;
  raw_narration: string | null;
  payee: string | null;
  category_id: string;
}

/**
 * Asks Workers AI for categories of uncategorized transactions (spec §6.2 step 5). Suggestions
 * are stored on the row (`ai_suggested_category_id`, `ai_confidence`) and shown as "AI suggested";
 * they're applied only when you accept one, or, with the auto-apply setting on, at ≥ 90%
 * confidence (categorized_by = 'ai', undoable). The narration, payee, UPI handle and rounded
 * amount are sent to Workers AI (it runs on Cloudflare, in the same account), nothing else.
 */
export async function suggestCategories(
  env: Env,
  userId: string,
  ids: string[],
): Promise<AiSuggestResponse> {
  if (!aiEnabled(env) || !env.AI)
    throw new ApiException(403, 'ai_disabled', 'AI suggestions are turned off');
  const d1 = env.DB;
  const [{ results: rows }, { results: cats }] = (await d1.batch([
    d1
      .prepare(
        `select t.id, t.direction, t.amount_paise, t.channel, t.vpa, t.raw_narration, t.category_id,
           coalesce(cp.display_name, t.note) as payee
         from transactions t left join counterparties cp on cp.id = t.counterparty_id
         where t.user_id = ?1 and t.categorized_by = 'none' and t.is_split = 0
           and t.transfer_group_id is null and t.id in (select value from json_each(?2))`,
      )
      .bind(userId, JSON.stringify(ids)),
    d1
      .prepare(
        `select c.id, c.name, c.type, p.name as group_name from categories c
         join categories p on p.id = c.parent_id
         where c.user_id = ?1 and c.archived = 0 and c.system_key is null and c.type != 'transfer'
         order by p.sort_order, c.sort_order, c.name`,
      )
      .bind(userId),
  ])) as [D1Result<Row>, D1Result<{ id: string; name: string; type: string; group_name: string }>];
  if (rows.length === 0) return { suggestions: [], applied: 0, undoToken: null };

  const categories: AiCategory[] = cats.map((c) => ({
    id: c.id,
    name: c.name,
    groupName: c.group_name,
    type: c.type as AiCategory['type'],
  }));
  const txns: AiTransaction[] = rows.map((r) => ({
    id: r.id,
    direction: r.direction,
    amountPaise: r.amount_paise,
    channel: r.channel,
    payee: r.payee,
    vpa: r.vpa,
    narration: r.raw_narration,
  }));

  let raw: unknown;
  try {
    const out = (await env.AI.run(
      (env.AI_MODEL || DEFAULT_AI_MODEL) as never,
      {
        messages: buildAiMessages(categories, txns),
        response_format: { type: 'json_schema', json_schema: AI_RESPONSE_JSON_SCHEMA },
        max_tokens: 64 * txns.length + 64,
        temperature: 0,
      } as never,
    )) as { response?: unknown };
    raw = out?.response;
  } catch (err) {
    log.error('ai suggest failed', { errorName: err instanceof Error ? err.name : 'unknown' });
    throw new ApiException(502, 'ai_unavailable', 'AI suggestions are unavailable right now');
  }
  const suggestions = parseAiResponse(raw, categories, txns);

  const { aiAutoApply } = await getSettings(d1, userId);
  const now = Date.now();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const toApply = aiAutoApply ? suggestions.filter((s) => s.confidence >= AI_AUTO_APPLY_MIN) : [];
  const batchId = newId();
  const stmts: D1PreparedStatement[] = [];
  if (suggestions.length) {
    stmts.push(
      d1
        .prepare(
          `update transactions set ai_suggested_category_id = j.categoryId, ai_confidence = j.confidence,
             updated_at = ?3
           from (select json_extract(value, '$.transactionId') as id,
                   json_extract(value, '$.categoryId') as categoryId,
                   json_extract(value, '$.confidence') as confidence from json_each(?1)) as j
           where transactions.id = j.id and transactions.user_id = ?2
             and transactions.categorized_by = 'none'
             and j.categoryId in (select id from categories where user_id = ?2)`,
        )
        .bind(JSON.stringify(suggestions), userId, now),
    );
  }
  if (toApply.length) {
    const audits = toApply.map((s) => {
      const before: CategoryState = {
        categoryId: byId.get(s.transactionId)?.category_id ?? null,
        categorizedBy: 'none',
        ruleId: null,
        learnedLabelId: null,
        confidence: null,
        reason: null,
        isSplit: 0,
      };
      const after: CategoryState = {
        categoryId: s.categoryId,
        categorizedBy: 'ai',
        ruleId: null,
        learnedLabelId: null,
        confidence: s.confidence,
        reason: 'ai:suggested',
      };
      return { id: s.transactionId, before, after };
    });
    stmts.push(
      d1
        .prepare(AUDIT_FROM_JSON_SQL)
        .bind(userId, batchId, 'ai_categorize', now, JSON.stringify(audits)),
      d1
        .prepare(
          `update transactions set category_id = j.categoryId, categorized_by = 'ai',
             confidence = j.confidence, categorization_reason = 'ai:suggested', rule_id = null,
             learned_label_id = null, updated_at = ?3
           from (select json_extract(value, '$.transactionId') as id,
                   json_extract(value, '$.categoryId') as categoryId,
                   json_extract(value, '$.confidence') as confidence from json_each(?1)) as j
           where transactions.id = j.id and transactions.user_id = ?2
             and transactions.categorized_by = 'none'
             and j.categoryId in (select id from categories where user_id = ?2)`,
        )
        .bind(JSON.stringify(toApply), userId, now),
    );
  }
  const results = stmts.length ? await d1.batch(stmts) : [];
  const applied = toApply.length ? (results.at(-1)?.meta.changes ?? 0) : 0;
  log.info('ai suggest', { suggested: suggestions.length, inserted: applied });

  const appliedIds = new Set(toApply.map((s) => s.transactionId));
  return {
    suggestions: suggestions.map((s) => ({ ...s, applied: appliedIds.has(s.transactionId) })),
    applied,
    undoToken: applied > 0 ? batchId : null,
  };
}
