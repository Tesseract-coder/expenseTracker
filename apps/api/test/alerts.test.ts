import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { alertToRow, parseAlerts } from '@kharcha/shared';
import { handleAlertEmail } from '../src/email';
import { categoryIdBySlug, getJson, importRows, postJson } from './helpers';

async function account(name: string, extra: Record<string, unknown> = {}) {
  const res = await postJson('/api/accounts', {
    name,
    type: 'savings',
    openingBalanceDate: '2026-09-30',
    ...extra,
  });
  return res.body.account.id as string;
}

const SMS = [
  'Sent Rs.420.00 From HDFC Bank A/C *1234 To SWIGGY On 01/10/26 Ref 427512340001 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808',
  'Spent Rs.1,299.00 On HDFC Bank Card 5678 At AMAZON PAY IN On 2026-10-02:10:15:22.Not You? To Block+Reissue Call 18002586161',
].join('\n');

let hdfc: string;
let card: string;
beforeEach(async () => {
  hdfc = await account('HDFC Salary', { bank: 'hdfc', last4: '1234' });
  card = await account('HDFC Card', { bank: 'hdfc', last4: '5678', type: 'credit_card' });
});

/** What the web app does: parse in the browser, assign accounts, send rows. */
function rowsFor(text: string, accountByLast4: Record<string, string>) {
  return parseAlerts(text, { fallbackDate: '2026-10-05' }).alerts.map((a) => ({
    ...alertToRow(a),
    accountId: accountByLast4[a.last4 ?? ''] as string,
  }));
}

async function pasteAndCommit(text: string, decisions: Record<string, unknown> = {}) {
  const preview = await postJson('/api/alerts/preview', {
    rows: rowsFor(text, { '1234': hdfc, '5678': card }),
  });
  expect(preview.status).toBe(200);
  const groups = preview.body.groups.map((g: any) => ({ importId: g.importId, ...decisions }));
  const commit = await postJson('/api/alerts/commit', { groups });
  return { preview: preview.body, commit };
}

describe('SMS paste', () => {
  it('previews one import per account and commits categorized sms transactions', async () => {
    const { preview, commit } = await pasteAndCommit(SMS);
    expect(preview.groups.map((g: any) => g.accountId).sort()).toEqual([hdfc, card].sort());
    for (const g of preview.groups) expect(g.preview.summary).toMatchObject({ new: 1 });
    expect(commit.status).toBe(200);
    expect(commit.body).toMatchObject({ inserted: 2, skippedDuplicates: 0, categorized: 2 });

    const slugs = await categoryIdBySlug();
    const txns = (await getJson('/api/transactions')).body.transactions;
    const swiggy = txns.find((t: any) => t.accountId === hdfc);
    expect(swiggy).toMatchObject({
      source: 'sms',
      status: 'confirmed',
      amountPaise: 42000,
      txnDate: '2026-10-01',
      channel: 'upi',
      categoryId: slugs.food_delivery,
      counterparty: { name: 'Swiggy' },
    });
    expect(txns.find((t: any) => t.accountId === card)).toMatchObject({
      channel: 'pos',
      source: 'sms',
    });

    const history = (await getJson('/api/imports')).body.imports;
    expect(history.map((i: any) => [i.source, i.status, i.fileName])).toEqual([
      ['sms', 'committed', 'Pasted SMS alerts'],
      ['sms', 'committed', 'Pasted SMS alerts'],
    ]);
  });

  it('skips alerts pasted twice', async () => {
    await pasteAndCommit(SMS);
    const { preview, commit } = await pasteAndCommit(SMS);
    expect(preview.groups.every((g: any) => g.preview.summary.duplicate === 1)).toBe(true);
    expect(commit.body).toMatchObject({ inserted: 0, skippedDuplicates: 2 });
  });

  it('rejects accounts that are not yours and empty pastes', async () => {
    const bad = await postJson('/api/alerts/preview', {
      rows: rowsFor(SMS, { '1234': 'not-mine', '5678': card }),
    });
    expect(bad.status).toBe(404);
    expect((await postJson('/api/alerts/preview', { rows: [] })).status).toBe(400);
  });

  it('a later statement row confirms and enriches the SMS entry instead of duplicating it', async () => {
    await pasteAndCommit(SMS.split('\n')[0] as string);
    const stmt = await importRows(hdfc, [
      {
        txnDate: '2026-10-01',
        valueDate: '2026-10-01',
        narration: 'UPI-SWIGGY LIMITED-SWIGGY@YBL-YESB0YBLUPI-427512340001-PAYMENT',
        refNo: '0000427512340001',
        amountPaise: 42000,
        direction: 'out',
        balancePaise: 958000,
        sourceRow: 1,
      },
    ]);
    const row = stmt.preview.rows[0];
    expect(row.status).toBe('near_duplicate');
    expect(row.match).toMatchObject({ source: 'sms', reason: 'no_narration' });
    expect(stmt.commit).toMatchObject({ inserted: 0, alertsConfirmed: 1 });

    const txns = (await getJson(`/api/transactions?accountIds=${hdfc}`)).body.transactions;
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({
      source: 'sms',
      rawNarration: 'UPI-SWIGGY LIMITED-SWIGGY@YBL-YESB0YBLUPI-427512340001-PAYMENT',
      vpa: 'swiggy@ybl',
    });
  });

  it('two same-amount statement rows cannot both hide behind one SMS entry', async () => {
    await pasteAndCommit(SMS.split('\n')[0] as string);
    const base = {
      txnDate: '2026-10-01',
      valueDate: null,
      refNo: null,
      amountPaise: 42000,
      direction: 'out',
      balancePaise: null,
    };
    const stmt = await importRows(hdfc, [
      { ...base, narration: 'UPI-SWIGGY-SWIGGY@YBL', sourceRow: 1 },
      { ...base, narration: 'UPI-ZOMATO-ZOMATO@PTYBL', sourceRow: 2 },
    ]);
    expect(stmt.preview.rows.map((r: any) => r.status)).toEqual(['near_duplicate', 'new']);
    expect(stmt.commit).toMatchObject({ inserted: 1, alertsConfirmed: 1 });
  });
});

// ---------------------------------------------------------------------------- e-mail

function mail(body: string, opts: { from?: string; html?: boolean } = {}) {
  const raw = [
    `From: ${opts.from ?? 'Me <me@example.com>'}`,
    'To: txn@example.com',
    'Subject: Fwd: Alert',
    'Date: Sat, 03 Oct 2026 10:00:00 +0530',
    'MIME-Version: 1.0',
    `Content-Type: ${opts.html ? 'text/html' : 'text/plain'}; charset=utf-8`,
    '',
    body,
  ].join('\r\n');
  return {
    from: 'me@example.com',
    raw: new Response(raw).body as ReadableStream<Uint8Array>,
    rawSize: raw.length,
    setReject: vi.fn(),
  };
}

const emailEnv = (extra: Record<string, unknown> = {}) =>
  ({
    ...env,
    ALLOWED_EMAILS: 'dev@kharcha.local',
    ALERT_SENDERS: 'me@example.com',
    ...extra,
  }) as any;

describe('email alerts', () => {
  it('rejects senders not on the allow-list (and everything when unset)', async () => {
    const m = { ...mail('x'), from: 'attacker@evil.test' };
    expect(await handleAlertEmail(m, emailEnv())).toBeNull();
    expect(m.setReject).toHaveBeenCalledWith('Sender not allowed');

    const off = mail('x');
    expect(await handleAlertEmail(off, emailEnv({ ALERT_SENDERS: undefined }))).toBeNull();
    expect(off.setReject).toHaveBeenCalled();
  });

  it('rejects oversized mail and a missing owner', async () => {
    const big = { ...mail('x'), rawSize: 300 * 1024 };
    expect(await handleAlertEmail(big, emailEnv())).toBeNull();
    expect(big.setReject).toHaveBeenCalledWith('Message too large');
    const noOwner = mail('x');
    expect(await handleAlertEmail(noOwner, emailEnv({ ALLOWED_EMAILS: '' }))).toBeNull();
    expect(noOwner.setReject).toHaveBeenCalledWith('Not configured');
  });

  it('creates needs_review transactions, counts unmatched alerts, and can be confirmed', async () => {
    const m = mail(
      `<p>Dear Customer,</p><p>Rs.649.00 has been debited from account **1234 to VPA netflix.upi@hdfcbank NETFLIX on 30-09-26.</p><p>Your UPI transaction reference number is 427312345678.</p>`,
      { html: true },
    );
    const r = await handleAlertEmail(m, emailEnv());
    expect(m.setReject).not.toHaveBeenCalled();
    expect(r).toEqual({ alerts: 1, inserted: 1, unmatched: 0 });

    const unmatched = await handleAlertEmail(
      mail('Rs 99 debited from A/c XX9999 to SOMEONE on 01-10-26'),
      emailEnv(),
    );
    expect(unmatched).toEqual({ alerts: 1, inserted: 0, unmatched: 1 });

    expect((await getJson('/api/inbox/count')).body).toMatchObject({ review: 1 });
    const review = (await getJson('/api/transactions?status=needs_review')).body.transactions;
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({
      source: 'email',
      status: 'needs_review',
      amountPaise: 64900,
      txnDate: '2026-09-30',
      vpa: 'netflix.upi@hdfcbank',
    });
    expect((await getJson('/api/imports')).body.imports[0]).toMatchObject({
      source: 'email',
      fileName: 'E-mail alert',
    });

    const confirm = await postJson('/api/transactions/confirm', { ids: [review[0].id, 'nope'] });
    expect(confirm.body).toEqual({ confirmed: 1 });
    expect((await getJson('/api/inbox/count')).body.review).toBe(0);
  });

  it('the same alert e-mailed twice is stored once', async () => {
    const body = 'Rs 120 debited from A/c XX1234 to CHAI POINT on 01-10-26';
    await handleAlertEmail(mail(body), emailEnv());
    expect(await handleAlertEmail(mail(body), emailEnv())).toMatchObject({ inserted: 0 });
  });
});

describe('/me features', () => {
  it('reports flags off by default', async () => {
    expect((await getJson('/api/me')).body.features).toEqual({ ai: false, emailAlerts: false });
  });
});
