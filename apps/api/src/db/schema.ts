import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
  ACCOUNT_TYPES,
  BANKS,
  CATEGORIZED_BY,
  CATEGORY_TYPES,
  CHANNELS,
  DIRECTIONS,
  IMPORT_SOURCES,
  IMPORT_STATUSES,
  RECURRING_CADENCES,
  RECURRING_STATUSES,
  SYSTEM_CATEGORY_KEYS,
  TXN_SOURCES,
  TXN_STATUSES,
} from '@kharcha/shared';

// See docs/DATA_MODEL.md. Money = INTEGER paise; dates = 'YYYY-MM-DD' IST; timestamps = epoch ms UTC.
//
// drizzle-kit mis-renders expression indexes (e.g. ifnull(col, '*')) for SQLite, so those live in
// hand-written migrations (migrations/0001_expression_indexes.sql). Keep that file in sync:
//   categories_user_parent_name_uq, learned_labels_scope_uq, budgets_scope_uq

/** CHECK (col IN (...)) built from the shared enum arrays. Values are compile-time constants. */
const inList = (column: string, values: readonly string[], nullable = false) =>
  sql.raw(
    `"${column}" in (${values.map((v) => `'${v}'`).join(', ')})${nullable ? ` or "${column}" is null` : ''}`,
  );
const bool = (column: string) => sql.raw(`"${column}" in (0, 1)`);

const now = () => Date.now();
const timestamps = {
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
};

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at').notNull().$defaultFn(now),
});

const userId = () =>
  text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const parserProfiles = sqliteTable('parser_profiles', {
  id: text('id').primaryKey(),
  userId: userId(),
  name: text('name').notNull(),
  builtinKey: text('builtin_key'),
  mapping: text('mapping').notNull(), // JSON, validated by zod
  ...timestamps,
});

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    name: text('name').notNull(),
    bank: text('bank', { enum: BANKS }),
    type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
    last4: text('last4'),
    openingBalancePaise: integer('opening_balance_paise').notNull().default(0), // signed
    openingBalanceDate: text('opening_balance_date').notNull(),
    color: text('color'),
    parserProfileId: text('parser_profile_id').references(() => parserProfiles.id, {
      onDelete: 'set null',
    }),
    active: integer('active').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('accounts_user_name_uq').on(t.userId, t.name),
    check('accounts_type_ck', inList('type', ACCOUNT_TYPES)),
    check('accounts_bank_ck', inList('bank', BANKS, true)),
    check('accounts_last4_ck', sql.raw(`"last4" is null or length("last4") = 4`)),
    check('accounts_active_ck', bool('active')),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    parentId: text('parent_id').references((): AnySQLiteColumn => categories.id, {
      onDelete: 'restrict',
    }),
    slug: text('slug'), // stable seed identity
    name: text('name').notNull(),
    type: text('type', { enum: CATEGORY_TYPES }).notNull(),
    systemKey: text('system_key', { enum: SYSTEM_CATEGORY_KEYS }),
    icon: text('icon'),
    color: text('color'),
    archived: integer('archived').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('categories_user_slug_uq').on(t.userId, t.slug),
    uniqueIndex('categories_user_system_key_uq').on(t.userId, t.systemKey),
    check('categories_type_ck', inList('type', CATEGORY_TYPES)),
    check('categories_system_key_ck', inList('system_key', SYSTEM_CATEGORY_KEYS, true)),
    check('categories_archived_ck', bool('archived')),
  ],
);

export const counterparties = sqliteTable(
  'counterparties',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    key: text('key').notNull(),
    displayName: text('display_name').notNull(),
    vpa: text('vpa'),
    defaultCategoryId: text('default_category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    mergedIntoId: text('merged_into_id').references((): AnySQLiteColumn => counterparties.id, {
      onDelete: 'set null',
    }),
    txnCount: integer('txn_count').notNull().default(0),
    lastSeenDate: text('last_seen_date'),
    ...timestamps,
  },
  (t) => [uniqueIndex('counterparties_user_key_uq').on(t.userId, t.key)],
);

export const rules = sqliteTable(
  'rules',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    name: text('name').notNull(),
    priority: integer('priority').notNull(),
    enabled: integer('enabled').notNull().default(1),
    conditions: text('conditions').notNull(), // JSON
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    setTags: text('set_tags'), // JSON array of tag ids
    setNote: text('set_note'),
    hitCount: integer('hit_count').notNull().default(0),
    lastHitAt: integer('last_hit_at'),
    ...timestamps,
  },
  (t) => [
    index('rules_user_priority_idx').on(t.userId, t.priority),
    check('rules_enabled_ck', bool('enabled')),
  ],
);

export const learnedLabels = sqliteTable(
  'learned_labels',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    counterpartyId: text('counterparty_id')
      .notNull()
      .references(() => counterparties.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: DIRECTIONS }),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    enabled: integer('enabled').notNull().default(1),
    hitCount: integer('hit_count').notNull().default(0),
    lastHitAt: integer('last_hit_at'),
    ...timestamps,
  },
  () => [
    check('learned_labels_direction_ck', inList('direction', DIRECTIONS, true)),
    check('learned_labels_enabled_ck', bool('enabled')),
  ],
);

export const imports = sqliteTable(
  'imports',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    source: text('source', { enum: IMPORT_SOURCES }).notNull(),
    r2Key: text('r2_key'),
    fileName: text('file_name'),
    fileSha256: text('file_sha256'),
    fileSize: integer('file_size'),
    parserProfileId: text('parser_profile_id'),
    status: text('status', { enum: IMPORT_STATUSES }).notNull(),
    rowsParsed: integer('rows_parsed').notNull().default(0),
    rowsNew: integer('rows_new').notNull().default(0),
    rowsDuplicate: integer('rows_duplicate').notNull().default(0),
    rowsNearDuplicate: integer('rows_near_duplicate').notNull().default(0),
    rowsFailed: integer('rows_failed').notNull().default(0),
    statementFrom: text('statement_from'),
    statementTo: text('statement_to'),
    statementClosingBalancePaise: integer('statement_closing_balance_paise'),
    error: text('error'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    committedAt: integer('committed_at'),
  },
  (t) => [
    index('imports_user_created_idx').on(t.userId, t.createdAt),
    index('imports_user_account_sha_idx').on(t.userId, t.accountId, t.fileSha256),
    check('imports_source_ck', inList('source', IMPORT_SOURCES)),
    check('imports_status_ck', inList('status', IMPORT_STATUSES)),
  ],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    txnDate: text('txn_date').notNull(),
    postedDate: text('posted_date'),
    weekStart: text('week_start').notNull(),
    dow: integer('dow').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    direction: text('direction', { enum: DIRECTIONS }).notNull(),
    rawNarration: text('raw_narration'),
    channel: text('channel', { enum: CHANNELS }),
    counterpartyId: text('counterparty_id').references(() => counterparties.id, {
      onDelete: 'set null',
    }),
    vpa: text('vpa'),
    ifscPrefix: text('ifsc_prefix'),
    refNo: text('ref_no'),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    categorizedBy: text('categorized_by', { enum: CATEGORIZED_BY }).notNull().default('none'),
    ruleId: text('rule_id').references(() => rules.id, { onDelete: 'set null' }),
    learnedLabelId: text('learned_label_id').references(() => learnedLabels.id, {
      onDelete: 'set null',
    }),
    confidence: real('confidence'),
    categorizationReason: text('categorization_reason'),
    aiSuggestedCategoryId: text('ai_suggested_category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    /** Model confidence (0–1) for ai_suggested_category_id; set with it, cleared on labelling. */
    aiConfidence: real('ai_confidence'),
    isSplit: integer('is_split').notNull().default(0),
    note: text('note'),
    status: text('status', { enum: TXN_STATUSES }).notNull().default('confirmed'),
    source: text('source', { enum: TXN_SOURCES }).notNull(),
    fingerprint: text('fingerprint').notNull(),
    importId: text('import_id').references(() => imports.id, { onDelete: 'set null' }),
    transferGroupId: text('transfer_group_id'),
    isReimbursable: integer('is_reimbursable').notNull().default(0),
    reimbursedByTxnId: text('reimbursed_by_txn_id').references(
      (): AnySQLiteColumn => transactions.id,
      { onDelete: 'set null' },
    ),
    balanceAfterPaise: integer('balance_after_paise'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('transactions_user_fingerprint_uq').on(t.userId, t.fingerprint),
    index('transactions_user_account_date_idx').on(t.userId, t.accountId, t.txnDate),
    index('transactions_user_category_date_idx').on(t.userId, t.categoryId, t.txnDate),
    // Matches the list's keyset order (txn_date, created_at, id) so a page stops after `limit`
    // rows instead of sorting every row (Phase 6 perf pass). Also serves date-range reports.
    index('transactions_user_date_created_idx').on(t.userId, t.txnDate, t.createdAt, t.id),
    index('transactions_user_counterparty_date_idx').on(t.userId, t.counterpartyId, t.txnDate),
    index('transactions_needs_review_idx')
      .on(t.userId, t.txnDate)
      .where(sql.raw(`"status" = 'needs_review'`)),
    index('transactions_uncategorized_idx')
      .on(t.userId, t.txnDate)
      .where(sql.raw(`"categorized_by" = 'none'`)),
    index('transactions_transfer_group_idx')
      .on(t.userId, t.transferGroupId)
      .where(sql.raw(`"transfer_group_id" is not null`)),
    index('transactions_import_idx').on(t.importId),
    check('transactions_amount_ck', sql.raw(`"amount_paise" > 0`)),
    check('transactions_direction_ck', inList('direction', DIRECTIONS)),
    check('transactions_channel_ck', inList('channel', CHANNELS, true)),
    check('transactions_categorized_by_ck', inList('categorized_by', CATEGORIZED_BY)),
    check('transactions_status_ck', inList('status', TXN_STATUSES)),
    check('transactions_source_ck', inList('source', TXN_SOURCES)),
    check('transactions_dow_ck', sql.raw(`"dow" between 1 and 7`)),
    check('transactions_is_split_ck', bool('is_split')),
    check('transactions_is_reimbursable_ck', bool('is_reimbursable')),
    check(
      'transactions_category_or_split_ck',
      sql.raw(`"category_id" is not null or "is_split" = 1`),
    ),
  ],
);

export const transactionSplits = sqliteTable(
  'transaction_splits',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    amountPaise: integer('amount_paise').notNull(),
    note: text('note'),
  },
  (t) => [
    index('transaction_splits_txn_idx').on(t.transactionId),
    index('transaction_splits_user_category_idx').on(t.userId, t.categoryId),
    check('transaction_splits_amount_ck', sql.raw(`"amount_paise" > 0`)),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex('tags_user_name_uq').on(t.userId, t.name)],
);

export const transactionTags = sqliteTable(
  'transaction_tags',
  {
    transactionId: text('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.tagId] }),
    index('transaction_tags_tag_idx').on(t.tagId),
  ],
);

export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    month: text('month'), // 'YYYY-MM'; null = default for every month
    amountPaise: integer('amount_paise').notNull(),
    ...timestamps,
  },
  () => [check('budgets_amount_ck', sql.raw(`"amount_paise" > 0`))],
);

export const recurringSeries = sqliteTable(
  'recurring_series',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    counterpartyId: text('counterparty_id')
      .notNull()
      .references(() => counterparties.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    cadence: text('cadence', { enum: RECURRING_CADENCES }).notNull(),
    typicalAmountPaise: integer('typical_amount_paise').notNull(),
    lastAmountPaise: integer('last_amount_paise'),
    amountTolerancePct: integer('amount_tolerance_pct').notNull().default(10),
    lastDate: text('last_date').notNull(),
    nextExpectedDate: text('next_expected_date'),
    occurrences: integer('occurrences').notNull(),
    status: text('status', { enum: RECURRING_STATUSES }).notNull(),
    dismissed: integer('dismissed').notNull().default(0),
    updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [
    index('recurring_series_user_next_idx').on(t.userId, t.nextExpectedDate),
    index('recurring_series_counterparty_idx').on(t.counterpartyId),
    check('recurring_series_cadence_ck', inList('cadence', RECURRING_CADENCES)),
    check('recurring_series_status_ck', inList('status', RECURRING_STATUSES)),
    check('recurring_series_dismissed_ck', bool('dismissed')),
  ],
);

export const settings = sqliteTable(
  'settings',
  {
    userId: userId(),
    key: text('key').notNull(),
    value: text('value').notNull(), // JSON
    updatedAt: integer('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    userId: userId(),
    batchId: text('batch_id').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    before: text('before'), // JSON
    after: text('after'), // JSON
    undoneAt: integer('undone_at'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (t) => [
    index('audit_log_user_batch_idx').on(t.userId, t.batchId),
    index('audit_log_user_created_idx').on(t.userId, t.createdAt),
  ],
);
