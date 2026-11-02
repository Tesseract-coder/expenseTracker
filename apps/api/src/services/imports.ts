import { and, desc, eq, sql } from 'drizzle-orm';
import {
  IMPORT_FILE_EXTENSIONS,
  MAX_IMPORT_FILE_BYTES,
  addDays,
  type DupCandidate,
  fingerprintAll,
  createNearDuplicateMatcher,
  findTransferPairs,
  type ImportCommitRequest,
  type ImportDto,
  type ImportPreviewRequest,
  type ImportPreviewResponse,
  importCommitRequestSchema,
  isoDayOfWeek,
  categorize,
  type CategorizeResult,
  normalizeNarration,
  type PreviewRow,
  type PreviewTransferKind,
  singleLegHint,
  type TransferCandidate,
  weekStart,
} from '@kharcha/shared';
import type { Env } from '../env';
import type { Db } from '../db/client';
import { inJson } from '../db/batch';
import { accounts, categories, imports, transactions } from '../db/schema';
import { ApiException, notFound } from '../lib/errors';
import { newId } from '../lib/ids';
import { getAccount } from './accounts';
import { getUncategorizedId } from './categories';
import {
  COUNTERPARTY_ID_BY_KEY,
  hitStatements,
  loadCategorizer,
  REFRESH_COUNTERPARTIES_BY_KEYS_SQL,
  resolveCounterpartyKeys,
  UPSERT_COUNTERPARTIES_SQL,
} from './categorization';

type ImportRow = typeof imports.$inferSelect;

const conflict = (code: string, message: string) => new ApiException(409, code, message);
const badRequest = (code: string, message: string) => new ApiException(400, code, message);

/** Rows per bulk INSERT statement. One JSON parameter per statement keeps D1 bound params at a handful. */
const INSERT_CHUNK = 500;

const r2Base = (userId: string, importId: string) => `u/${userId}/imports/${importId}`;

/** Normalized fields and engine result kept server-side between preview and commit. */
interface StoredRowExtra {
  fingerprint: string;
  channel: string;
  vpa: string | null;
  ifscPrefix: string | null;
  narrationRef: string | null;
  cpKey: string | null;
  cat: CategorizeResult | null;
}

interface StoredPreview {
  version: 2;
  accountId: string;
  cashAccountId: string | null;
  rows: (PreviewRow & StoredRowExtra)[];
}

function toDto(r: ImportRow): ImportDto {
  return {
    id: r.id,
    accountId: r.accountId,
    fileName: r.fileName,
    fileSize: r.fileSize,
    parserProfileId: r.parserProfileId,
    status: r.status,
    rowsParsed: r.rowsParsed,
    rowsNew: r.rowsNew,
    rowsDuplicate: r.rowsDuplicate,
    rowsNearDuplicate: r.rowsNearDuplicate,
    rowsFailed: r.rowsFailed,
    statementFrom: r.statementFrom,
    statementTo: r.statementTo,
    createdAt: r.createdAt,
    committedAt: r.committedAt,
  };
}

async function getImportRow(db: Db, userId: string, id: string): Promise<ImportRow> {
  const row = await db
    .select()
    .from(imports)
    .where(and(eq(imports.userId, userId), eq(imports.id, id)))
    .get();
  if (!row) throw notFound('Import not found');
  return row;
}

export async function listImports(db: Db, userId: string): Promise<ImportDto[]> {
  const rows = await db
    .select()
    .from(imports)
    .where(eq(imports.userId, userId))
    .orderBy(desc(imports.createdAt))
    .limit(200);
  return rows.map(toDto);
}

// ---------------------------------------------------------------------------- upload

export async function uploadStatement(
  db: Db,
  env: Env,
  userId: string,
  accountId: string,
  file: File,
) {
  await getAccount(db, userId, accountId);
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (!(IMPORT_FILE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw badRequest('unsupported_file', 'Upload a CSV, TXT, XLS or XLSX statement');
  }
  if (file.size === 0) throw badRequest('empty_file', 'The file is empty');
  if (file.size > MAX_IMPORT_FILE_BYTES)
    throw new ApiException(413, 'file_too_large', 'Statements must be under 5 MB');

  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const previous = await db
    .select({ id: imports.id, fileName: imports.fileName, committedAt: imports.committedAt })
    .from(imports)
    .where(
      and(
        eq(imports.userId, userId),
        eq(imports.accountId, accountId),
        eq(imports.fileSha256, sha),
        eq(imports.status, 'committed'),
      ),
    )
    .get();

  const id = newId();
  const r2Key = `${r2Base(userId, id)}/${sha}.${ext}`;
  await env.STATEMENTS.put(r2Key, bytes, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
    sha256: sha,
  });
  await db.insert(imports).values({
    id,
    userId,
    accountId,
    source: 'file',
    r2Key,
    fileName: file.name.slice(0, 200),
    fileSha256: sha,
    fileSize: file.size,
    status: 'uploaded',
  });
  return {
    importId: id,
    duplicateOf: previous
      ? { importId: previous.id, fileName: previous.fileName, committedAt: previous.committedAt }
      : null,
  };
}

// ---------------------------------------------------------------------------- preview

export async function previewImport(
  db: Db,
  env: Env,
  userId: string,
  importId: string,
  req: ImportPreviewRequest,
): Promise<ImportPreviewResponse> {
  const imp = await getImportRow(db, userId, importId);
  if (imp.status !== 'uploaded' && imp.status !== 'previewed') {
    throw conflict('import_not_editable', `This import is already ${imp.status}`);
  }
  const account = await getAccount(db, userId, imp.accountId);
  const rows = req.rows;
  const fingerprints = fingerprintAll(account.id, rows);

  // Exact duplicates: one query, fingerprints passed as a single JSON parameter.
  const existingFps = new Set(
    (
      await db
        .select({ fp: transactions.fingerprint })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), inJson(transactions.fingerprint, fingerprints)))
    ).map((r) => r.fp),
  );

  const dates = rows.map((r) => r.txnDate).sort();
  const from = addDays(dates[0] as string, -3);
  const to = addDays(dates.at(-1) as string, 3);

  // Window of existing transactions for near-duplicate and transfer matching.
  const windowRows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      accountType: accounts.type,
      txnDate: transactions.txnDate,
      amountPaise: transactions.amountPaise,
      direction: transactions.direction,
      narration: transactions.rawNarration,
      note: transactions.note,
      refNo: transactions.refNo,
      transferGroupId: transactions.transferGroupId,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(eq(transactions.userId, userId), sql`${transactions.txnDate} between ${from} and ${to}`),
    );

  // Match on the bank narration only: a manual entry's free-text note is not comparable with a
  // bank narration, so manual rows (narration null) match on amount + date ('no_narration').
  const matchNearDuplicate = createNearDuplicateMatcher(
    windowRows.filter((w) => w.accountId === account.id) satisfies DupCandidate[],
  );

  const blank = {
    channel: 'other',
    vpa: null,
    ifscPrefix: null,
    narrationRef: null,
    cpKey: null,
    cat: null,
    payee: null,
    proposal: null,
  } satisfies Omit<StoredRowExtra, 'fingerprint'> & Pick<PreviewRow, 'payee' | 'proposal'>;
  const previewRows: StoredPreview['rows'] = rows.map((r, index) => {
    const fp = fingerprints[index] as string;
    if (existingFps.has(fp))
      return {
        ...r,
        ...blank,
        index,
        fingerprint: fp,
        status: 'duplicate',
        match: null,
        transfer: null,
      };
    const near = matchNearDuplicate({ id: `new:${index}`, ...r });
    const matched = near ? windowRows.find((w) => w.id === near.id) : undefined;
    return {
      ...r,
      ...blank,
      index,
      fingerprint: fp,
      status: near ? 'near_duplicate' : 'new',
      match:
        near && matched
          ? {
              txnId: matched.id,
              txnDate: matched.txnDate,
              amountPaise: matched.amountPaise,
              narration: matched.narration ?? matched.note,
              reason: near.reason,
            }
          : null,
      transfer: null,
    };
  });

  // Transfers: pair new rows with other accounts' unpaired transactions; else single-leg hints.
  const allAccounts = await db
    .select({ id: accounts.id, last4: accounts.last4, accountType: accounts.type })
    .from(accounts)
    .where(eq(accounts.userId, userId));
  const last4ByAccount = Object.fromEntries(allAccounts.map((a) => [a.id, a.last4]));
  const otherAccounts = allAccounts.filter((a) => a.id !== account.id && a.last4);

  const newCandidates: TransferCandidate[] = previewRows
    .filter((r) => r.status !== 'duplicate')
    .map((r) => ({
      key: `new:${r.index}`,
      accountId: account.id,
      accountType: account.type,
      ...r,
    }));
  const existingCandidates: TransferCandidate[] = windowRows
    .filter((w) => w.accountId !== account.id && !w.transferGroupId)
    .map((w) => ({ key: w.id, ...w, narration: w.narration ?? w.note }));
  const pairs = findTransferPairs([...newCandidates, ...existingCandidates], last4ByAccount);

  for (const p of pairs) {
    const newKey = p.outKey.startsWith('new:')
      ? p.outKey
      : p.inKey.startsWith('new:')
        ? p.inKey
        : null;
    const otherKey = newKey === p.outKey ? p.inKey : p.outKey;
    if (!newKey || otherKey.startsWith('new:')) continue;
    const row = previewRows[Number(newKey.slice(4))];
    const other = windowRows.find((w) => w.id === otherKey);
    if (row) {
      row.transfer = {
        kind: p.kind,
        confidence: p.confidence,
        reason: p.reason,
        counterpartTxnId: otherKey,
        counterpartAccountId: other?.accountId ?? null,
      };
    }
  }
  for (const c of newCandidates) {
    const row = previewRows[Number(c.key.slice(4))];
    if (!row || row.transfer) continue;
    const hint = singleLegHint(c, otherAccounts);
    if (hint) row.transfer = { ...hint, counterpartTxnId: null, counterpartAccountId: null };
  }

  // Categorization (Phase 3): normalize narrations, then rules → learned labels → keywords.
  const pending = previewRows.filter((r) => r.status !== 'duplicate');
  const normalized = pending.map((r) => normalizeNarration(r.narration, account.type));
  const keyIds = await resolveCounterpartyKeys(
    db,
    userId,
    normalized.flatMap((n) => (n.counterpartyKey ? [n.counterpartyKey] : [])),
  );
  const { ctx } = await loadCategorizer(db, userId);
  const cashAccount =
    account.type === 'cash' || account.type === 'credit_card'
      ? null
      : await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(
            and(eq(accounts.userId, userId), eq(accounts.type, 'cash'), eq(accounts.active, 1)),
          )
          .orderBy(accounts.sortOrder, accounts.createdAt)
          .get();
  pending.forEach((row, i) => {
    const n = normalized[i] as (typeof normalized)[number];
    row.channel = n.channel;
    row.vpa = n.vpa;
    row.ifscPrefix = n.ifscPrefix;
    row.narrationRef = n.refNo;
    row.cpKey = n.counterpartyKey;
    row.payee = n.payee;
    row.cat = categorize(
      {
        narration: row.narration,
        counterpartyKey: n.counterpartyKey,
        counterpartyId: n.counterpartyKey ? (keyIds.get(n.counterpartyKey) ?? null) : null,
        vpa: n.vpa,
        amountPaise: row.amountPaise,
        direction: row.direction,
        accountId: account.id,
        accountType: account.type,
        channel: n.channel,
      },
      ctx,
    );
    row.proposal = row.cat
      ? {
          categoryId: row.cat.categoryId,
          categorizedBy: row.cat.categorizedBy,
          reason: row.cat.reason,
          confidence: row.cat.confidence,
        }
      : null;
    // ATM withdrawal = transfer to Cash (decision 2026-11-01): suggest moving it to the Cash account.
    if (cashAccount && !row.transfer && n.channel === 'atm' && row.direction === 'out') {
      row.transfer = {
        kind: 'atm_cash',
        confidence: 'high',
        reason: 'ATM withdrawal → Cash account',
        counterpartTxnId: null,
        counterpartAccountId: cashAccount.id,
      };
    }
  });

  // Reconciliation: compare the statement's closing balance with what Kharcha will show.
  let reconciliation: ImportPreviewResponse['reconciliation'] = null;
  if (req.closingBalancePaise !== null && req.statementTo) {
    const latest = await db
      .select({ max: sql<string | null>`max(${transactions.txnDate})` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.accountId, account.id)))
      .get();
    if (!latest?.max || latest.max <= req.statementTo) {
      const delta = previewRows
        .filter((r) => r.status === 'new' && r.txnDate >= account.openingBalanceDate)
        .reduce((acc, r) => acc + (r.direction === 'in' ? r.amountPaise : -r.amountPaise), 0);
      const projected = account.balancePaise + delta;
      reconciliation = {
        statementClosingPaise: req.closingBalancePaise,
        projectedBalancePaise: projected,
        matches: projected === req.closingBalancePaise,
      };
    }
  }

  const summary = {
    total: previewRows.length,
    new: previewRows.filter((r) => r.status === 'new').length,
    duplicate: previewRows.filter((r) => r.status === 'duplicate').length,
    nearDuplicate: previewRows.filter((r) => r.status === 'near_duplicate').length,
    transfers: previewRows.filter((r) => r.transfer).length,
  };

  const stored: StoredPreview = {
    version: 2,
    accountId: account.id,
    cashAccountId: cashAccount?.id ?? null,
    rows: previewRows,
  };
  await env.STATEMENTS.put(`${r2Base(userId, importId)}/preview.json`, JSON.stringify(stored), {
    httpMetadata: { contentType: 'application/json' },
  });
  await db
    .update(imports)
    .set({
      status: 'previewed',
      parserProfileId: req.profileId,
      rowsParsed: summary.total,
      rowsDuplicate: summary.duplicate,
      rowsNearDuplicate: summary.nearDuplicate,
      rowsFailed: req.parseErrors,
      statementFrom: req.statementFrom,
      statementTo: req.statementTo,
      statementClosingBalancePaise: req.closingBalancePaise,
    })
    .where(and(eq(imports.userId, userId), eq(imports.id, importId)));

  return {
    importId,
    rows: previewRows.map(
      ({
        fingerprint: _fp,
        channel: _c,
        vpa: _v,
        ifscPrefix: _i,
        narrationRef: _n,
        cpKey: _k,
        cat: _cat,
        ...r
      }) => r,
    ),
    summary,
    reconciliation,
  };
}

// ---------------------------------------------------------------------------- commit

async function systemCategoryIds(
  db: Db,
  userId: string,
): Promise<Record<PreviewTransferKind, string>> {
  const rows = await db
    .select({ id: categories.id, key: categories.systemKey })
    .from(categories)
    .where(
      and(
        eq(categories.userId, userId),
        inJson(categories.systemKey, ['self_transfer', 'cc_bill_payment', 'atm_cash']),
      ),
    );
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.id]));
  if (!byKey.self_transfer || !byKey.cc_bill_payment || !byKey.atm_cash)
    throw new Error('system categories missing');
  return byKey as Record<PreviewTransferKind, string>;
}

const INSERT_SQL = `insert or ignore into transactions (
    id, user_id, account_id, txn_date, posted_date, week_start, dow, amount_paise, direction,
    raw_narration, channel, counterparty_id, vpa, ifsc_prefix, ref_no, category_id, categorized_by,
    rule_id, learned_label_id, confidence, categorization_reason, is_split, note, status, source,
    fingerprint, import_id, transfer_group_id, is_reimbursable, balance_after_paise, created_at, updated_at)
  select
    json_extract(value, '$.id'), ?1, coalesce(json_extract(value, '$.accountId'), ?2),
    json_extract(value, '$.txnDate'), json_extract(value, '$.valueDate'),
    json_extract(value, '$.weekStart'), json_extract(value, '$.dow'), json_extract(value, '$.amountPaise'),
    json_extract(value, '$.direction'), json_extract(value, '$.narration'), json_extract(value, '$.channel'),
    ${COUNTERPARTY_ID_BY_KEY("json_extract(value, '$.cpKey')", '?1')},
    json_extract(value, '$.vpa'), json_extract(value, '$.ifscPrefix'), json_extract(value, '$.refNo'),
    json_extract(value, '$.categoryId'), json_extract(value, '$.categorizedBy'),
    (select r.id from rules r where r.user_id = ?1 and r.id = json_extract(value, '$.ruleId')),
    (select l.id from learned_labels l where l.user_id = ?1 and l.id = json_extract(value, '$.learnedLabelId')),
    json_extract(value, '$.confidence'), json_extract(value, '$.reason'), 0, json_extract(value, '$.note'),
    'confirmed', 'import', json_extract(value, '$.fingerprint'), ?3, json_extract(value, '$.groupId'), 0,
    json_extract(value, '$.balancePaise'), ?4, ?4
  from json_each(?5)`;

/** Rule-assigned tags for inserted rows; skips rows that collided at insert and deleted tags. */
const INSERT_RULE_TAGS_SQL = `insert or ignore into transaction_tags (transaction_id, tag_id)
  select json_extract(value, '$.t'), json_extract(value, '$.g') from json_each(?1)
  where json_extract(value, '$.t') in (select id from transactions where user_id = ?2 and import_id = ?3)
    and json_extract(value, '$.g') in (select id from tags where user_id = ?2)`;

export async function commitImport(
  db: Db,
  env: Env,
  userId: string,
  importId: string,
  raw: ImportCommitRequest,
) {
  const decisions = importCommitRequestSchema.parse(raw);
  // Claim the import atomically so a double-tap can't commit twice.
  const claim = await env.DB.prepare(
    "update imports set status = 'committing' where id = ? and user_id = ? and status = 'previewed'",
  )
    .bind(importId, userId)
    .run();
  if (claim.meta.changes !== 1) {
    await getImportRow(db, userId, importId); // 404 if missing
    throw conflict(
      'import_not_ready',
      'This import is not ready to commit (preview it first, or it was already committed)',
    );
  }

  try {
    const obj = await env.STATEMENTS.get(`${r2Base(userId, importId)}/preview.json`);
    if (!obj) throw conflict('preview_missing', 'Preview expired; upload the statement again');
    const preview = (await obj.json()) as StoredPreview;
    if (preview.version !== 2) {
      throw conflict('preview_missing', 'This preview is out of date; preview the statement again');
    }

    const includeNear = new Set(decisions.includeNearDuplicates);
    const acceptTransfers = new Set(decisions.acceptTransfers);
    const uncategorizedId = await getUncategorizedId(db, userId);
    const systemIds = await systemCategoryIds(db, userId);
    const now = Date.now();

    const counterpartUpdates: { id: string; groupId: string; categoryId: string }[] = [];
    const tagLinks: { t: string; g: string }[] = [];
    const counterpartiesToUpsert = new Map<
      string,
      { id: string; key: string; name: string; vpa: string | null }
    >();
    const applied: (CategorizeResult | null)[] = [];
    const toInsert: Record<string, unknown>[] = [];
    const cashLegs: Record<string, unknown>[] = [];
    for (const r of preview.rows) {
      if (!(r.status === 'new' || (r.status === 'near_duplicate' && includeNear.has(r.index))))
        continue;
      const transfer = r.transfer && acceptTransfers.has(r.index) ? r.transfer : null;
      const atmLeg =
        transfer?.kind === 'atm_cash' && preview.cashAccountId ? preview.cashAccountId : null;
      const groupId = transfer?.counterpartTxnId || atmLeg ? newId() : null;
      if (transfer?.counterpartTxnId && groupId) {
        counterpartUpdates.push({
          id: transfer.counterpartTxnId,
          groupId,
          categoryId: systemIds[transfer.kind],
        });
      }
      const cat = transfer ? null : r.cat;
      if (cat) applied.push(cat);
      if (r.cpKey && r.payee) {
        counterpartiesToUpsert.set(r.cpKey, {
          id: newId(),
          key: r.cpKey,
          name: r.payee,
          vpa: r.vpa,
        });
      }
      const id = newId();
      for (const g of cat?.setTagIds ?? []) tagLinks.push({ t: id, g });
      const base = {
        txnDate: r.txnDate,
        valueDate: r.valueDate,
        weekStart: weekStart(r.txnDate),
        dow: isoDayOfWeek(r.txnDate),
        amountPaise: r.amountPaise,
        narration: r.narration,
        channel: r.channel,
        balancePaise: r.balancePaise,
      };
      toInsert.push({
        ...base,
        id,
        direction: r.direction,
        cpKey: r.cpKey,
        vpa: r.vpa,
        ifscPrefix: r.ifscPrefix,
        refNo: r.refNo ?? r.narrationRef,
        categoryId: transfer ? systemIds[transfer.kind] : (cat?.categoryId ?? uncategorizedId),
        categorizedBy: transfer ? 'manual' : (cat?.categorizedBy ?? 'none'),
        ruleId: cat?.ruleId ?? null,
        learnedLabelId: cat?.learnedLabelId ?? null,
        confidence: cat?.confidence ?? null,
        reason: transfer ? `transfer:${transfer.kind}` : (cat?.reason ?? null),
        note: cat?.setNote ?? null,
        fingerprint: r.fingerprint,
        groupId,
      });
      if (atmLeg) {
        // The Cash side of the withdrawal: money moves into the wallet, it isn't spent yet.
        cashLegs.push({
          ...base,
          id: newId(),
          accountId: atmLeg,
          direction: 'in',
          channel: 'cash',
          refNo: null,
          categoryId: systemIds.atm_cash,
          categorizedBy: 'manual',
          reason: 'transfer:atm_cash',
          fingerprint: `atm:${r.fingerprint}`,
          groupId,
          balancePaise: null,
        });
      }
    }

    const stmts: D1PreparedStatement[] = [];
    if (counterpartiesToUpsert.size) {
      stmts.push(
        env.DB.prepare(UPSERT_COUNTERPARTIES_SQL).bind(
          userId,
          now,
          JSON.stringify([...counterpartiesToUpsert.values()]),
        ),
      );
    }
    const insertStart = stmts.length;
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      stmts.push(
        env.DB.prepare(INSERT_SQL).bind(
          userId,
          preview.accountId,
          importId,
          now,
          JSON.stringify(toInsert.slice(i, i + INSERT_CHUNK)),
        ),
      );
    }
    const insertEnd = stmts.length;
    for (let i = 0; i < cashLegs.length; i += INSERT_CHUNK) {
      stmts.push(
        env.DB.prepare(INSERT_SQL).bind(
          userId,
          preview.accountId,
          importId,
          now,
          JSON.stringify(cashLegs.slice(i, i + INSERT_CHUNK)),
        ),
      );
    }
    if (counterpartUpdates.length) {
      stmts.push(
        env.DB.prepare(
          `update transactions set
             transfer_group_id = (select json_extract(value, '$.groupId') from json_each(?1) where json_extract(value, '$.id') = transactions.id),
             category_id = (select json_extract(value, '$.categoryId') from json_each(?1) where json_extract(value, '$.id') = transactions.id),
             categorized_by = 'manual', is_split = 0, updated_at = ?3
           where user_id = ?2 and transfer_group_id is null
             and id in (select json_extract(value, '$.id') from json_each(?1))`,
        ).bind(JSON.stringify(counterpartUpdates), userId, now),
      );
      // Remove splits on counterparts that just became transfers.
      stmts.push(
        env.DB.prepare(
          `delete from transaction_splits where user_id = ?2
             and transaction_id in (select json_extract(value, '$.id') from json_each(?1))`,
        ).bind(JSON.stringify(counterpartUpdates), userId),
      );
    }
    if (tagLinks.length) {
      stmts.push(
        env.DB.prepare(INSERT_RULE_TAGS_SQL).bind(JSON.stringify(tagLinks), userId, importId),
      );
    }
    if (counterpartiesToUpsert.size) {
      stmts.push(
        env.DB.prepare(REFRESH_COUNTERPARTIES_BY_KEYS_SQL).bind(
          userId,
          JSON.stringify([...counterpartiesToUpsert.keys()]),
        ),
      );
    }
    stmts.push(...hitStatements(env.DB, userId, applied));
    const results = stmts.length ? await env.DB.batch(stmts) : [];
    const inserted = results
      .slice(insertStart, insertEnd)
      .reduce((acc, r) => acc + (r.meta.changes ?? 0), 0);
    const transfersLinked = toInsert.filter((r) =>
      String(r.reason ?? '').startsWith('transfer:'),
    ).length;

    await db
      .update(imports)
      .set({ status: 'committed', committedAt: Date.now(), rowsNew: inserted })
      .where(and(eq(imports.userId, userId), eq(imports.id, importId)));

    return {
      inserted,
      // Exact duplicates + rows that collided at insert time (imported concurrently by another statement).
      skippedDuplicates:
        preview.rows.filter((r) => r.status === 'duplicate').length + (toInsert.length - inserted),
      transfersLinked,
      categorized: applied.length,
    };
  } catch (err) {
    await db
      .update(imports)
      .set({ status: 'previewed' })
      .where(
        and(eq(imports.userId, userId), eq(imports.id, importId), eq(imports.status, 'committing')),
      );
    throw err;
  }
}

// ---------------------------------------------------------------------------- revert & file

/** Deletes every transaction from a committed import; transfer counterparts revert to Uncategorized. */
export async function revertImport(
  db: Db,
  env: Env,
  userId: string,
  importId: string,
): Promise<number> {
  const imp = await getImportRow(db, userId, importId);
  if (imp.status !== 'committed')
    throw conflict('import_not_committed', 'Only committed imports can be reverted');
  const uncategorizedId = await getUncategorizedId(db, userId);
  const count = await db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.importId, importId)))
    .get();

  const groupsOfImport = `select transfer_group_id from transactions
    where user_id = ?1 and import_id = ?2 and transfer_group_id is not null`;
  await env.DB.batch([
    env.DB.prepare(
      `update transactions set transfer_group_id = null, category_id = ?3, categorized_by = 'none', updated_at = ?4
       where user_id = ?1 and (import_id is null or import_id != ?2) and transfer_group_id in (${groupsOfImport})`,
    ).bind(userId, importId, uncategorizedId, Date.now()),
    env.DB.prepare('delete from transactions where user_id = ?1 and import_id = ?2').bind(
      userId,
      importId,
    ),
    env.DB.prepare("update imports set status = 'reverted' where user_id = ?1 and id = ?2").bind(
      userId,
      importId,
    ),
    env.DB.prepare(
      `insert into audit_log (id, user_id, batch_id, action, entity, entity_id, before, after, created_at)
       values (?1, ?2, ?3, 'revert_import', 'import', ?4, ?5, null, ?6)`,
    ).bind(
      newId(),
      userId,
      newId(),
      importId,
      JSON.stringify({ transactions: Number(count?.n ?? 0) }),
      Date.now(),
    ),
  ]);
  return Number(count?.n ?? 0);
}

export async function getImportFile(db: Db, env: Env, userId: string, importId: string) {
  const imp = await getImportRow(db, userId, importId);
  if (!imp.r2Key) throw notFound('No file stored for this import');
  const obj = await env.STATEMENTS.get(imp.r2Key);
  if (!obj) throw notFound('Stored file not found');
  return { obj, fileName: imp.fileName ?? 'statement' };
}
