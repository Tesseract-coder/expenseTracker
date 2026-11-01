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
  type PreviewRow,
  singleLegHint,
  type TransferCandidate,
  type TransferKind,
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

type ImportRow = typeof imports.$inferSelect;

const conflict = (code: string, message: string) => new ApiException(409, code, message);
const badRequest = (code: string, message: string) => new ApiException(400, code, message);

/** Rows per bulk INSERT statement. One JSON parameter per statement keeps D1 bound params at a handful. */
const INSERT_CHUNK = 500;

const r2Base = (userId: string, importId: string) => `u/${userId}/imports/${importId}`;

interface StoredPreview {
  version: 1;
  accountId: string;
  rows: (PreviewRow & { fingerprint: string })[];
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

  const previewRows: StoredPreview['rows'] = rows.map((r, index) => {
    const fp = fingerprints[index] as string;
    if (existingFps.has(fp))
      return { ...r, index, fingerprint: fp, status: 'duplicate', match: null, transfer: null };
    const near = matchNearDuplicate({ id: `new:${index}`, ...r });
    const matched = near ? windowRows.find((w) => w.id === near.id) : undefined;
    return {
      ...r,
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

  const stored: StoredPreview = { version: 1, accountId: account.id, rows: previewRows };
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
    rows: previewRows.map(({ fingerprint: _fp, ...r }) => r),
    summary,
    reconciliation,
  };
}

// ---------------------------------------------------------------------------- commit

async function systemCategoryIds(db: Db, userId: string): Promise<Record<TransferKind, string>> {
  const rows = await db
    .select({ id: categories.id, key: categories.systemKey })
    .from(categories)
    .where(
      and(
        eq(categories.userId, userId),
        inJson(categories.systemKey, ['self_transfer', 'cc_bill_payment']),
      ),
    );
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.id]));
  if (!byKey.self_transfer || !byKey.cc_bill_payment) throw new Error('system categories missing');
  return byKey as Record<TransferKind, string>;
}

const INSERT_SQL = `insert or ignore into transactions (
    id, user_id, account_id, txn_date, posted_date, week_start, dow, amount_paise, direction,
    raw_narration, ref_no, category_id, categorized_by, categorization_reason, is_split, status,
    source, fingerprint, import_id, transfer_group_id, is_reimbursable, balance_after_paise,
    created_at, updated_at)
  select
    json_extract(value, '$.id'), ?1, ?2, json_extract(value, '$.txnDate'), json_extract(value, '$.valueDate'),
    json_extract(value, '$.weekStart'), json_extract(value, '$.dow'), json_extract(value, '$.amountPaise'),
    json_extract(value, '$.direction'), json_extract(value, '$.narration'), json_extract(value, '$.refNo'),
    json_extract(value, '$.categoryId'), json_extract(value, '$.categorizedBy'), json_extract(value, '$.reason'),
    0, 'confirmed', 'import', json_extract(value, '$.fingerprint'), ?3, json_extract(value, '$.groupId'), 0,
    json_extract(value, '$.balancePaise'), ?4, ?4
  from json_each(?5)`;

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

    const includeNear = new Set(decisions.includeNearDuplicates);
    const acceptTransfers = new Set(decisions.acceptTransfers);
    const uncategorizedId = await getUncategorizedId(db, userId);
    const systemIds = await systemCategoryIds(db, userId);
    const now = Date.now();

    const counterpartUpdates: { id: string; groupId: string; categoryId: string }[] = [];
    const toInsert = preview.rows
      .filter(
        (r) => r.status === 'new' || (r.status === 'near_duplicate' && includeNear.has(r.index)),
      )
      .map((r) => {
        const transfer = r.transfer && acceptTransfers.has(r.index) ? r.transfer : null;
        const groupId = transfer?.counterpartTxnId ? newId() : null;
        if (transfer?.counterpartTxnId && groupId) {
          counterpartUpdates.push({
            id: transfer.counterpartTxnId,
            groupId,
            categoryId: systemIds[transfer.kind],
          });
        }
        return {
          id: newId(),
          txnDate: r.txnDate,
          valueDate: r.valueDate,
          weekStart: weekStart(r.txnDate),
          dow: isoDayOfWeek(r.txnDate),
          amountPaise: r.amountPaise,
          direction: r.direction,
          narration: r.narration,
          refNo: r.refNo,
          categoryId: transfer ? systemIds[transfer.kind] : uncategorizedId,
          categorizedBy: transfer ? 'manual' : 'none',
          reason: transfer ? `transfer:${transfer.kind}` : null,
          fingerprint: r.fingerprint,
          groupId,
          balancePaise: r.balancePaise,
        };
      });

    const stmts: D1PreparedStatement[] = [];
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
    const insertCount = stmts.length;
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
    const results = stmts.length ? await env.DB.batch(stmts) : [];
    const inserted = results
      .slice(0, insertCount)
      .reduce((acc, r) => acc + (r.meta.changes ?? 0), 0);
    const transfersLinked = toInsert.filter((r) => r.reason).length;

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
