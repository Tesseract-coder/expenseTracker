CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`bank` text,
	`type` text NOT NULL,
	`last4` text,
	`opening_balance_paise` integer DEFAULT 0 NOT NULL,
	`opening_balance_date` text NOT NULL,
	`color` text,
	`parser_profile_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parser_profile_id`) REFERENCES `parser_profiles`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "accounts_type_ck" CHECK("type" in ('savings', 'current', 'credit_card', 'cash', 'wallet', 'investment')),
	CONSTRAINT "accounts_bank_ck" CHECK("bank" in ('hdfc', 'icici', 'sbi', 'axis', 'kotak', 'other') or "bank" is null),
	CONSTRAINT "accounts_last4_ck" CHECK("last4" is null or length("last4") = 4),
	CONSTRAINT "accounts_active_ck" CHECK("active" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_name_uq` ON `accounts` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`before` text,
	`after` text,
	`undone_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_log_user_batch_idx` ON `audit_log` (`user_id`,`batch_id`);--> statement-breakpoint
CREATE INDEX `audit_log_user_created_idx` ON `audit_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`month` text,
	`amount_paise` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budgets_amount_ck" CHECK("amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` text,
	`slug` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`system_key` text,
	`icon` text,
	`color` text,
	`archived` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "categories_type_ck" CHECK("type" in ('income', 'expense_need', 'expense_want', 'investment', 'transfer')),
	CONSTRAINT "categories_system_key_ck" CHECK("system_key" in ('self_transfer', 'cc_bill_payment', 'opening_adjustment', 'uncategorized', 'atm_cash') or "system_key" is null),
	CONSTRAINT "categories_archived_ck" CHECK("archived" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_slug_uq` ON `categories` (`user_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_system_key_uq` ON `categories` (`user_id`,`system_key`);--> statement-breakpoint
CREATE TABLE `counterparties` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`display_name` text NOT NULL,
	`vpa` text,
	`default_category_id` text,
	`merged_into_id` text,
	`txn_count` integer DEFAULT 0 NOT NULL,
	`last_seen_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`merged_into_id`) REFERENCES `counterparties`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `counterparties_user_key_uq` ON `counterparties` (`user_id`,`key`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`source` text NOT NULL,
	`r2_key` text,
	`file_name` text,
	`file_sha256` text,
	`file_size` integer,
	`parser_profile_id` text,
	`status` text NOT NULL,
	`rows_parsed` integer DEFAULT 0 NOT NULL,
	`rows_new` integer DEFAULT 0 NOT NULL,
	`rows_duplicate` integer DEFAULT 0 NOT NULL,
	`rows_near_duplicate` integer DEFAULT 0 NOT NULL,
	`rows_failed` integer DEFAULT 0 NOT NULL,
	`statement_from` text,
	`statement_to` text,
	`statement_closing_balance_paise` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`committed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "imports_source_ck" CHECK("source" in ('file', 'sms', 'email')),
	CONSTRAINT "imports_status_ck" CHECK("status" in ('uploaded', 'previewed', 'committing', 'committed', 'failed', 'reverted'))
);
--> statement-breakpoint
CREATE INDEX `imports_user_created_idx` ON `imports` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `imports_user_account_sha_idx` ON `imports` (`user_id`,`account_id`,`file_sha256`);--> statement-breakpoint
CREATE TABLE `learned_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`counterparty_id` text NOT NULL,
	`direction` text,
	`account_id` text,
	`category_id` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`last_hit_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`counterparty_id`) REFERENCES `counterparties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "learned_labels_direction_ck" CHECK("direction" in ('in', 'out') or "direction" is null),
	CONSTRAINT "learned_labels_enabled_ck" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE `parser_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`builtin_key` text,
	`mapping` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recurring_series` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`counterparty_id` text NOT NULL,
	`category_id` text,
	`cadence` text NOT NULL,
	`typical_amount_paise` integer NOT NULL,
	`amount_tolerance_pct` integer DEFAULT 10 NOT NULL,
	`last_date` text NOT NULL,
	`next_expected_date` text,
	`occurrences` integer NOT NULL,
	`status` text NOT NULL,
	`dismissed` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`counterparty_id`) REFERENCES `counterparties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_series_cadence_ck" CHECK("cadence" in ('weekly', 'monthly', 'quarterly', 'yearly')),
	CONSTRAINT "recurring_series_status_ck" CHECK("status" in ('active', 'new', 'price_changed', 'stopped')),
	CONSTRAINT "recurring_series_dismissed_ck" CHECK("dismissed" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `recurring_series_user_next_idx` ON `recurring_series` (`user_id`,`next_expected_date`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`priority` integer NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`conditions` text NOT NULL,
	`category_id` text NOT NULL,
	`set_tags` text,
	`set_note` text,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`last_hit_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rules_enabled_ck" CHECK("enabled" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `rules_user_priority_idx` ON `rules` (`user_id`,`priority`);--> statement-breakpoint
CREATE TABLE `settings` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_name_uq` ON `tags` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`category_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transaction_splits_amount_ck" CHECK("amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `transaction_splits_txn_idx` ON `transaction_splits` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `transaction_splits_user_category_idx` ON `transaction_splits` (`user_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `transaction_tags` (
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transaction_tags_tag_idx` ON `transaction_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`txn_date` text NOT NULL,
	`posted_date` text,
	`week_start` text NOT NULL,
	`dow` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`direction` text NOT NULL,
	`raw_narration` text,
	`channel` text,
	`counterparty_id` text,
	`vpa` text,
	`ifsc_prefix` text,
	`ref_no` text,
	`category_id` text,
	`categorized_by` text DEFAULT 'none' NOT NULL,
	`rule_id` text,
	`learned_label_id` text,
	`confidence` real,
	`categorization_reason` text,
	`ai_suggested_category_id` text,
	`is_split` integer DEFAULT 0 NOT NULL,
	`note` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`source` text NOT NULL,
	`fingerprint` text NOT NULL,
	`import_id` text,
	`transfer_group_id` text,
	`is_reimbursable` integer DEFAULT 0 NOT NULL,
	`reimbursed_by_txn_id` text,
	`balance_after_paise` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`counterparty_id`) REFERENCES `counterparties`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`learned_label_id`) REFERENCES `learned_labels`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ai_suggested_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reimbursed_by_txn_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transactions_amount_ck" CHECK("amount_paise" > 0),
	CONSTRAINT "transactions_direction_ck" CHECK("direction" in ('in', 'out')),
	CONSTRAINT "transactions_channel_ck" CHECK("channel" in ('upi', 'neft', 'imps', 'rtgs', 'pos', 'atm', 'ach', 'nach', 'ecs', 'card', 'interest', 'charges', 'cash', 'other') or "channel" is null),
	CONSTRAINT "transactions_categorized_by_ck" CHECK("categorized_by" in ('manual', 'rule', 'learned', 'keyword', 'ai', 'none')),
	CONSTRAINT "transactions_status_ck" CHECK("status" in ('confirmed', 'needs_review')),
	CONSTRAINT "transactions_source_ck" CHECK("source" in ('manual', 'import', 'sms', 'email', 'restore')),
	CONSTRAINT "transactions_dow_ck" CHECK("dow" between 1 and 7),
	CONSTRAINT "transactions_is_split_ck" CHECK("is_split" in (0, 1)),
	CONSTRAINT "transactions_is_reimbursable_ck" CHECK("is_reimbursable" in (0, 1)),
	CONSTRAINT "transactions_category_or_split_ck" CHECK("category_id" is not null or "is_split" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_user_fingerprint_uq` ON `transactions` (`user_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `transactions_user_account_date_idx` ON `transactions` (`user_id`,`account_id`,`txn_date`);--> statement-breakpoint
CREATE INDEX `transactions_user_category_date_idx` ON `transactions` (`user_id`,`category_id`,`txn_date`);--> statement-breakpoint
CREATE INDEX `transactions_user_date_idx` ON `transactions` (`user_id`,`txn_date`);--> statement-breakpoint
CREATE INDEX `transactions_user_counterparty_date_idx` ON `transactions` (`user_id`,`counterparty_id`,`txn_date`);--> statement-breakpoint
CREATE INDEX `transactions_needs_review_idx` ON `transactions` (`user_id`,`txn_date`) WHERE "status" = 'needs_review';--> statement-breakpoint
CREATE INDEX `transactions_uncategorized_idx` ON `transactions` (`user_id`,`txn_date`) WHERE "categorized_by" = 'none';--> statement-breakpoint
CREATE INDEX `transactions_transfer_group_idx` ON `transactions` (`user_id`,`transfer_group_id`) WHERE "transfer_group_id" is not null;--> statement-breakpoint
CREATE INDEX `transactions_import_idx` ON `transactions` (`import_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);