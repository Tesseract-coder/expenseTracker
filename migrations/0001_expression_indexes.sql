-- Hand-written: drizzle-kit cannot render expression indexes for SQLite (see src/db/schema.ts).
-- NULL-tolerant uniqueness: NULL parent/direction/account/month are treated as one value.
CREATE UNIQUE INDEX `categories_user_parent_name_uq` ON `categories` (`user_id`, ifnull(`parent_id`, ''), `name`);--> statement-breakpoint
CREATE UNIQUE INDEX `learned_labels_scope_uq` ON `learned_labels` (`user_id`, `counterparty_id`, ifnull(`direction`, '*'), ifnull(`account_id`, '*'));--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_scope_uq` ON `budgets` (`user_id`, `category_id`, ifnull(`month`, '*'));
