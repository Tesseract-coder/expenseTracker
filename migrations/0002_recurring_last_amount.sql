ALTER TABLE `recurring_series` ADD `last_amount_paise` integer;--> statement-breakpoint
CREATE INDEX `recurring_series_counterparty_idx` ON `recurring_series` (`counterparty_id`);