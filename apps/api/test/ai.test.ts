import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { categoryIdBySlug, devEnv, getJson, patchJson, postJson } from './helpers';

const app = createApp();

/** Fake Workers AI binding: answers with `reply(prompt)` and records the calls. */
function fakeAi(reply: (prompt: string) => unknown) {
  const run = vi.fn(async (_model: string, input: { messages: { content: string }[] }) => ({
    response: reply(input.messages[1]?.content ?? ''),
  }));
  return { run } as unknown as Ai & { run: typeof run };
}

async function req(
  method: string,
  path: string,
  body: unknown,
  ai: Ai | undefined,
  enabled = 'true',
) {
  const res = await app.request(
    `http://localhost${path}`,
    { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    devEnv({ AI_ENABLED: enabled, ...(ai ? { AI: ai } : {}) }),
  );
  return { status: res.status, body: await res.json<any>() };
}

/** Number of a category in the prompt's list ("12. Lifestyle > Food delivery [want]"). */
const catNo = (prompt: string, name: string) =>
  Number(new RegExp(`(\\d+)\\. [^\\n]*> ${name} \\[`).exec(prompt)?.[1]);

async function uncategorized(narration: string, amountPaise = 64900) {
  const acc = (await getJson('/api/accounts')).body.accounts[0].id;
  const res = await postJson('/api/transactions', {
    accountId: acc,
    txnDate: '2026-10-01',
    amountPaise,
    direction: 'out',
    note: narration,
  });
  return res.body.transaction.id as string;
}

describe('AI suggestions', () => {
  it('is off unless AI_ENABLED and the binding are both present', async () => {
    const id = await uncategorized('MYSTERY SHOP');
    expect(
      (await req('POST', '/api/categorization/ai-suggest', { transactionIds: [id] }, undefined))
        .status,
    ).toBe(403);
    const ai = fakeAi(() => ({ results: [] }));
    expect(
      (await req('POST', '/api/categorization/ai-suggest', { transactionIds: [id] }, ai, 'false'))
        .status,
    ).toBe(403);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('stores suggestions without applying them, and exposes them on the DTO', async () => {
    const id = await uncategorized('ZXQ STREAMING');
    const ai = fakeAi((p) => ({
      results: [{ t: 't1', c: catNo(p, 'Entertainment & OTT subscriptions'), confidence: 0.95 }],
    }));
    const r = await req('POST', '/api/categorization/ai-suggest', { transactionIds: [id] }, ai);
    expect(r.status).toBe(200);
    const slugs = await categoryIdBySlug();
    const ott = slugs.entertainment;
    expect(r.body).toEqual({
      suggestions: [{ transactionId: id, categoryId: ott, confidence: 0.95, applied: false }],
      applied: 0,
      undoToken: null,
    });
    const txn = (await getJson(`/api/transactions/${id}`)).body.transaction;
    expect(txn).toMatchObject({
      categorizedBy: 'none',
      aiSuggestion: { categoryId: ott, confidence: 0.95 },
    });
    // Prompt carries only the narration/payee and a rounded amount.
    expect(ai.run.mock.calls[0]?.[1].messages[1]?.content).toContain('Rs 649');
  });

  it('auto-applies high-confidence suggestions when enabled, undoably, and a re-run keeps them', async () => {
    const put = await patchJson('/api/settings', { aiAutoApply: true });
    expect(put.body.settings.aiAutoApply).toBe(true);

    const hi = await uncategorized('QWERTY FOODS');
    const lo = await uncategorized('OTHER THING', 12300);
    const ai = fakeAi((p) => ({
      results: [
        { t: 't1', c: catNo(p, 'Food delivery'), confidence: 0.92 },
        { t: 't2', c: catNo(p, 'Food delivery'), confidence: 0.6 },
      ],
    }));
    const ids = [hi, lo];
    const r = await req('POST', '/api/categorization/ai-suggest', { transactionIds: ids }, ai);
    expect(r.body.applied).toBe(1);
    expect(r.body.undoToken).toEqual(expect.any(String));
    const byId = async (id: string) => (await getJson(`/api/transactions/${id}`)).body.transaction;
    expect(
      (await byId(r.body.suggestions.find((s: any) => s.applied).transactionId)).categorizedBy,
    ).toBe('ai');
    expect(r.body.suggestions.filter((s: any) => !s.applied)).toHaveLength(1);

    const appliedId = r.body.suggestions.find((s: any) => s.applied).transactionId;
    const run = await postJson('/api/categorization/run', {});
    expect(run.status).toBe(200);
    expect((await byId(appliedId)).categorizedBy).toBe('ai');

    expect((await postJson(`/api/undo/${r.body.undoToken}`, {})).body).toEqual({ restored: 1 });
    expect((await byId(appliedId)).categorizedBy).toBe('none');
  });

  it('ignores invalid model output and maps model failures to 502', async () => {
    const id = await uncategorized('WHATEVER');
    const junk = await req(
      'POST',
      '/api/categorization/ai-suggest',
      { transactionIds: [id] },
      fakeAi(() => 'no idea'),
    );
    expect(junk.body).toEqual({ suggestions: [], applied: 0, undoToken: null });

    const broken = {
      run: vi.fn(async () => {
        throw new Error('capacity');
      }),
    } as unknown as Ai;
    const r = await req('POST', '/api/categorization/ai-suggest', { transactionIds: [id] }, broken);
    expect(r.status).toBe(502);
    expect(r.body.error.code).toBe('ai_unavailable');
  });

  it('only considers uncategorized rows and reports the feature on /me', async () => {
    const ai = fakeAi(() => ({ results: [] }));
    const r = await req('POST', '/api/categorization/ai-suggest', { transactionIds: ['nope'] }, ai);
    expect(r.body.suggestions).toEqual([]);
    expect(ai.run).not.toHaveBeenCalled();
    const me = await app.request(
      'http://localhost/api/me',
      {},
      devEnv({ AI_ENABLED: 'true', AI: ai }),
    );
    expect((await me.json<any>()).features.ai).toBe(true);
  });
});
