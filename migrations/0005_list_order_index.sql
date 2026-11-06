CREATE INDEX `transactions_user_date_created_idx` ON `transactions` (`user_id`,`txn_date`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `transactions_user_date_idx`;
