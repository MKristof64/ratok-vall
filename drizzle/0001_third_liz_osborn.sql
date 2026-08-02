CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_email` ON `accounts` (`email`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `share_code_ciphertext` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `owner_account_id` text;--> statement-breakpoint
CREATE INDEX `idx_rooms_owner_updated_at` ON `rooms` (`owner_account_id`,`updated_at`);